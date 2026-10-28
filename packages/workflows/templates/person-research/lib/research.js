/**
 * 定向研究轮（步骤 2，由 continue/select 动作重臂触发）：
 * pendingRound 用户输入 → LLM 生成定向查询 → 搜索（对既有来源去重）
 * → 抓新来源正文 → LLM 抽取并归并证据 → 落盘轮次记录。
 * 空查询/零新来源都算成功轮（信息增量枯竭由用户决定是否继续深挖）。
 */
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { CONFIG } from "./config.js";
import { searchWeb, scrape, mapLimit } from "./search-client.js";
import { canonicalUrl, domainOf, domainClass } from "./normalize.js";
import { readPrivate } from "./privacy.js";
import { getResearch, updateResearch, allocSourceIds, allocClaimIds, saveSource, loadSources, saveClaims, loadClaims, saveRound, loadRounds, loadBusiness, saveBusiness } from "./store.js";
import { buildIntentPrompt, validateIntentOutput, buildExtractPrompt, validateExtractOutput, buildBusinessExtractPrompt, validateBusinessOutput, buildUserAssertionPrompt, validateCorrectionOutput } from "./prompts.js";
import { applyExtract, mergeBusinessRelations, recomputeBusinessStatus, collectAggregatorAssociations, companyNameFromTitle, applyCorrection } from "./evidence.js";
import { buildBusinessQueries } from "./queries.js";

const CLASS_ORDER = { A: 0, B: 1, C: 2, D: 3 };
const BUSINESS_DOMAIN_RE = /aiqicha|qcc\.com|tianyancha|gsxt\.gov\.cn|qixin|11467\.com|shuidi\.cn/;
const BUSINESS_ROUND_MAX_QUERIES = 10;
const BUSINESS_HOP_COMPANIES = 3;

export async function runResearch(name, executionDir) {
  const research = getResearch(executionDir);
  if (!research) throw new Error("research 未初始化（先跑 discovery）");
  const pending = research.pendingRound;
  if (!pending || !pending.input) throw new Error("无待执行研究轮：请通过「继续研究」提交输入后触发");

  const profile = { name, phone: readPrivate(executionDir).phone || null, clues: research.clues };
  const selected = research.candidates?.find(c => c.status === "selected") || null;
  const roundN = (research.rounds?.length || 0) + 1;
  const isBusinessRound = Boolean(pending.business);

  // 0. 用户断言解析（更正/补充）：纯研究方向消息返回空、无副作用；命中则
  //    否定既有主张（rejected）+ 追加 user_provided 主张 + 更新候选信号与一句话身份
  let correctedClaimIds = [];
  if (pending.source !== "selection") {
    const existingClaims = loadClaims(executionDir);
    const assertion = await parseUserAssertion(profile, selected, pending.input, existingClaims);
    const hasAssertion = assertion.negate.length > 0 || assertion.facts.length > 0
      || Object.keys(assertion.signals).length > 0 || assertion.candidateSummary;
    if (hasAssertion) {
      const observedAt = new Date().toISOString();
      const newIds = allocClaimIds(executionDir, assertion.facts.length);
      const applied = applyCorrection(existingClaims, assertion, {
        newClaimIds: newIds, candidateId: selected?.id || null, observedAt,
      });
      saveClaims(executionDir, applied.claims);
      correctedClaimIds = newIds;

      const target = selected || research.candidates?.[0];
      if (target) {
        const nextCandidates = research.candidates.map(c => c.id === target.id
          ? {
              ...c,
              signals: { ...(c.signals || {}), ...assertion.signals },
              identitySummary: assertion.candidateSummary || c.identitySummary,
            }
          : c);
        updateResearch(executionDir, { candidates: nextCandidates });
      }
      console.log(`[person-research] 用户断言: 否定 ${assertion.negate.length} 条 / 补充 ${assertion.facts.length} 条`);
    }
  }

  // 1. 查询规划：商业轮用固定查询集（选定时不再走意图 LLM；用户消息触发时合并意图查询）
  const doneQueries = loadRounds(executionDir)
    .flatMap(r => (r.queries || []).map(q => typeof q === "string" ? q : q.query));
  const intentQueries = msg => planQueries(profile, msg, doneQueries)
    .then(qs => qs.map(q => ({ query: q, category: "general", reason: "intent" })));
  let queries;
  if (isBusinessRound) {
    const fixed = buildBusinessQueries(name);
    const extra = pending.source === "continue" ? await intentQueries(pending.input) : [];
    queries = [...fixed, ...extra]
      .filter(q => !doneQueries.includes(q.query))
      .slice(0, BUSINESS_ROUND_MAX_QUERIES);
  } else {
    queries = await intentQueries(pending.input);
  }
  console.log(`[person-research] 第 ${roundN} 轮${isBusinessRound ? "（商业调查）" : ""}定向查询 ${queries.length} 组: ${queries.map(q => q.query).join(" / ")}`);

  // 2. 搜索（波次化）→ 对既有来源去重
  const existingSources = loadSources(executionDir);
  const knownCanonical = new Set(existingSources.map(s => s.canonicalUrl || canonicalUrl(s.url)));

  const searchWave = async waveQueries => {
    const searched = await mapLimit(waveQueries, CONFIG.SEARCH_CONCURRENCY,
      q => searchWeb(q.query, { category: q.category || "general" }));
    const merged = new Map();
    waveQueries.forEach((q, qi) => {
      for (const r of searched[qi] || []) {
        const cu = canonicalUrl(r.url);
        if (!cu || !/^https?:\/\//.test(cu) || knownCanonical.has(cu) || merged.has(cu)) continue;
        merged.set(cu, {
          url: r.url, canonicalUrl: cu,
          title: String(r.title || "").trim(),
          snippet: String(r.snippet || "").trim(),
          engines: r.engines || [],
          foundBy: [q],
          rank: r.rank || 99,
          publishedAt: r.publishedDate || null,
        });
      }
    });
    return [...merged.values()];
  };

  const wave1 = await searchWave(queries);

  // 商业二跳：聚合站公司页 title 即公司名 → 「公司+股东 / 公司+人名」再搜（聚合站正文被反爬/JS 墙，摘要即证据）
  // 公司名池 = 本轮 wave1 + 历史来源里的聚合站页（固定查询可能已被去重，历史公司线索仍可发起二跳）
  let hopQueries = [];
  if (isBusinessRound) {
    const aggrPool = [
      ...wave1,
      ...existingSources.filter(s => BUSINESS_DOMAIN_RE.test(s.domain || "")),
    ];
    const hopQuerySet = new Set();
    const companies = [...new Set(aggrPool
      .map(r => companyNameFromTitle(r.title))
      .filter(Boolean))]
      .slice(0, BUSINESS_HOP_COMPANIES);
    if (companies.length > 0) {
      console.log(`[person-research] 商业二跳公司: ${companies.join(" / ")}`);
      for (const c of companies) {
        for (const q of [`${c} 股东`, `${c} ${name}`]) {
          if (!doneQueries.includes(q) && !hopQuerySet.has(q)) {
            hopQuerySet.add(q);
            hopQueries.push({ query: q, category: "general", reason: "business-hop" });
          }
        }
      }
    }
  }
  const wave2 = hopQueries.length > 0 ? await searchWave(hopQueries) : [];
  queries = [...queries, ...hopQueries];

  // 3. 新来源落盘 + 抓正文
  const newSources = [...wave1, ...wave2].map(r => ({
    id: null,
    ...r,
    domain: domainOf(r.url),
    domainClass: domainClass(domainOf(r.url)),
    content: null, scraped: false, scrapeError: null,
    foundInRound: roundN,
    observedAt: new Date().toISOString(),
  }));
  let newSourceIds = [];
  if (newSources.length > 0) {
    newSourceIds = allocSourceIds(executionDir, newSources.length);
    newSources.forEach((s, i) => { s.id = newSourceIds[i]; saveSource(executionDir, s); });
    console.log(`[person-research] 本轮新来源 ${newSources.length} 条（二跳 ${wave2.length}）`);

    const domainCount = new Map();
    // 商业轮：工商聚合域绝对优先（-5 主导分级；聚合站正文常被反爬，但值得先试）
    const scrapeOrder = s =>
      (isBusinessRound && BUSINESS_DOMAIN_RE.test(s.domain) ? -5 : 0) + CLASS_ORDER[s.domainClass];
    const toScrape = [...newSources]
      .sort((a, b) => (scrapeOrder(a) - scrapeOrder(b)) || (a.rank - b.rank))
      .filter(s => {
        const n = domainCount.get(s.domain) || 0;
        if (n >= CONFIG.DOMAIN_SCRAPE_CAP) return false;
        domainCount.set(s.domain, n + 1);
        return true;
      })
      .slice(0, CONFIG.RESEARCH_SCRAPE_PER_ROUND);

    await Promise.all(toScrape.map(async s => {
      const markdown = await scrape(s.url);
      if (markdown) {
        s.content = markdown.slice(0, CONFIG.CONTENT_TRUNCATE);
        s.scraped = true;
      } else {
        s.scrapeError = "scrape_failed";
      }
      saveSource(executionDir, s);
    }));
  }

  // 4. 证据抽取与归并（有可用新来源才调 LLM）
  let newClaimIds = [];
  if (newSources.length > 0) {
    // 商业轮：聚合站摘要（股东名单所在）必须先进 prompt——抓取失败的聚合页比抓取成功的无关页更有价值；
    // 且并入历史聚合站来源（全文匹配页是稳定证据池，只喂本轮新来源会丢失早轮关键线索）
    const promptPool = isBusinessRound
      ? [...newSources, ...existingSources.filter(s => BUSINESS_DOMAIN_RE.test(s.domain || ""))]
      : newSources;
    const promptOrder = s =>
      (isBusinessRound && BUSINESS_DOMAIN_RE.test(s.domain) ? 2 : 0) + Number(s.scraped);
    const seenCanonical = new Set();
    const promptSources = promptPool
      .filter(s => {
        const cu = s.canonicalUrl || canonicalUrl(s.url);
        if (seenCanonical.has(cu)) return false;
        seenCanonical.add(cu);
        return true;
      })
      .sort((a, b) => (promptOrder(b) - promptOrder(a)))
      .slice(0, CONFIG.PROMPT_SOURCES_MAX)
      .map(s => ({ ...s, content: s.scraped ? s.content : s.snippet }));

    const extract = await extractEvidence(profile, selected, promptSources, loadClaims(executionDir));
    if (extract.newClaims.length + extract.updates.length + extract.conflicts.length > 0) {
      const observedAt = new Date().toISOString();
      const claimIds = allocClaimIds(executionDir, extract.newClaims.length + extract.conflicts.length);
      const idAlloc = {
        newClaimIds: claimIds.slice(0, extract.newClaims.length),
        conflictClaimIds: claimIds.slice(extract.newClaims.length),
        candidateId: selected?.id || null,
        observedAt,
      };
      const sourceMap = new Map([...existingSources, ...newSources].map(s => [s.id, s]));
      const applied = applyExtract(loadClaims(executionDir), extract, sourceMap, idAlloc);
      saveClaims(executionDir, applied.claims);
      newClaimIds = applied.newClaimIds;
      console.log(`[person-research] 证据归并: 新主张 ${extract.newClaims.length} / 更新 ${extract.updates.length} / 冲突 ${extract.conflicts.length}`);
    }

    // 商业轮：结构化商业关系 = LLM 抽取（有角色证据的） + 规则化关联（全文匹配但角色未证实）
    //   → 同公司同角色归并 → 独立域名升级状态
    if (isBusinessRound) {
      const llmRelations = await extractBusinessRelations(profile, selected, promptSources);
      const ruleAssociations = collectAggregatorAssociations([...existingSources, ...newSources], BUSINESS_DOMAIN_RE);
      const all = [...llmRelations, ...ruleAssociations];
      if (all.length > 0) {
        const observedAt = new Date().toISOString();
        const stamped = all.map(r => ({ ...r, observedAt: observedAt.slice(0, 10) }));
        const sourceMap = new Map([...existingSources, ...newSources].map(s => [s.id, s]));
        const merged = recomputeBusinessStatus(
          mergeBusinessRelations(loadBusiness(executionDir), stamped),
          sourceMap,
        );
        saveBusiness(executionDir, merged);
        console.log(`[person-research] 商业关系: LLM ${llmRelations.length} 条 + 规则关联 ${ruleAssociations.length} 条，归并后共 ${merged.length} 条`);
      } else {
        console.log("[person-research] 商业关系: 本轮未抽取到结构化关系（claims 里可能仍有文本线索）");
      }
    }
  }

  // 5. 轮次落盘 + 状态收尾（claimIds 含用户补充的更正主张）
  const roundClaimIds = [...correctedClaimIds, ...newClaimIds];
  const at = new Date().toISOString();
  saveRound(executionDir, {
    id: `r-${roundN}`, n: roundN, kind: "research", business: isBusinessRound, input: pending.input,
    queries, sourceIds: newSourceIds, claimIds: roundClaimIds, at,
  });
  updateResearch(executionDir, {
    pendingRound: null,
    rounds: [...(research.rounds || []), {
      id: `r-${roundN}`, n: roundN, kind: "research", business: isBusinessRound, input: pending.input,
      queryCount: queries.length, newSourceIds, newClaimIds: roundClaimIds, at,
    }],
  });

  console.log(`[person-research] 第 ${roundN} 轮完成: 查询 ${queries.length} / 新来源 ${newSourceIds.length} / 新主张 ${roundClaimIds.length}`);
  return {
    round: roundN,
    queries,
    newSources: newSourceIds.length,
    newClaims: roundClaimIds.length,
    summary: newSourceIds.length > 0 || correctedClaimIds.length > 0
      ? `第 ${roundN} 轮：新来源 ${newSourceIds.length} 条，主张变更 ${roundClaimIds.length} 条`
      : `第 ${roundN} 轮：无新增公开来源（可换个方向继续或结束研究）`,
  };
}

async function parseUserAssertion(profile, candidate, message, existingClaims) {
  let parsed = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 5 && !parsed; attempt++) {
    const { system, user } = buildUserAssertionPrompt(profile, candidate, message, existingClaims);
    const finalUser = lastErr ? `${user}\n\n上次输出无法解析（${lastErr}），请严格只输出 JSON。` : user;
    const { text } = await callLLM({ system, user: finalUser });
    try {
      parsed = parseJSON(text);
    } catch (err) {
      lastErr = err.message;
    }
  }
  if (!parsed) {
    console.warn(`[person-research] 用户断言解析失败（跳过，不影响研究轮）: ${lastErr}`);
    return { negate: [], facts: [], signals: {}, candidateSummary: null };
  }
  return validateCorrectionOutput(parsed, existingClaims);
}

async function planQueries(profile, message, doneQueries) {
  let lastErr = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const { system, user } = buildIntentPrompt(profile, message, doneQueries);
    const finalUser = lastErr ? `${user}\n\n上次输出问题（${lastErr}），请严格按 JSON 格式重新输出。` : user;
    const { text } = await callLLM({ system, user: finalUser });
    try {
      const parsed = parseJSON(text);
      const { value, errors } = validateIntentOutput(parsed);
      if (errors.length === 0) return value.queries;
      lastErr = errors.join(";");
    } catch (err) {
      lastErr = err.message;
    }
  }
  console.warn(`[person-research] 查询规划连续失败，本轮降级为空查询: ${lastErr}`);
  return [];
}

async function extractEvidence(profile, selected, newSources, existingClaims) {
  let parsed = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 5 && !parsed; attempt++) {
    const { system, user } = buildExtractPrompt(profile, selected, newSources, existingClaims);
    const finalUser = lastErr ? `${user}\n\n上次输出无法解析（${lastErr}），请严格只输出 JSON。` : user;
    const { text } = await callLLM({ system, user: finalUser });
    try {
      parsed = parseJSON(text);
    } catch (err) {
      lastErr = err.message;
    }
  }
  if (!parsed) throw new Error(`证据抽取失败: LLM 输出连续 5 次无法解析为 JSON（${lastErr}）`);
  return validateExtractOutput(parsed, newSources, existingClaims);
}

async function extractBusinessRelations(profile, selected, sources) {
  let parsed = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 5 && !parsed; attempt++) {
    const { system, user } = buildBusinessExtractPrompt(profile, selected, sources);
    const finalUser = lastErr ? `${user}\n\n上次输出无法解析（${lastErr}），请严格只输出 JSON。` : user;
    const { text } = await callLLM({ system, user: finalUser });
    try {
      parsed = parseJSON(text);
    } catch (err) {
      lastErr = err.message;
    }
  }
  if (!parsed) {
    console.warn(`[person-research] 商业关系抽取连续解析失败，本轮跳过: ${lastErr}`);
    return [];
  }
  return validateBusinessOutput(parsed, sources);
}
