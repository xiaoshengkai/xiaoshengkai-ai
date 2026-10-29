/**
 * 定向研究轮（步骤 2，由 continue/select 动作重臂触发，V1.1 相关性漏斗）：
 *   用户断言解析（更正/补充）→ LLM 生成定向查询 → 搜索（对既有来源去重）
 *   → 相关性漏斗（商业轮聚合站页走 lead_only；其余评分 + 边界复核；深挖放宽为 lead）
 *   → 只持久化过门槛来源 → 抓 evidence 正文 → LLM 抽取并归并证据 → 落盘轮次记录。
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
import { runRelevancePipeline, markLead } from "./relevance.js";

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
  const isDeepRound = Boolean(pending.deep);

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
  console.log(`[person-research] 第 ${roundN} 轮${isBusinessRound ? "（商业调查）" : ""}${isDeepRound ? "（深挖）" : ""}定向查询 ${queries.length} 组: ${queries.map(q => q.query).join(" / ")}`);

  // 2. 搜索（波次化）→ 对既有来源去重
  const existingSources = loadSources(executionDir);
  const knownCanonical = new Set(existingSources.map(s => s.canonicalUrl || canonicalUrl(s.url)));
  const cleaningAgg = { rawResults: 0, droppedGarbage: 0, droppedTitleDuplicate: 0, mergedUrlDuplicates: 0 };

  const searchWave = async waveQueries => {
    const searched = await mapLimit(waveQueries, CONFIG.SEARCH_CONCURRENCY,
      q => searchWeb(q.query, { category: q.category || "general", strategy: "auto" }));
    for (const s of searched) {
      const c = s?.cleaning;
      if (!c) continue;
      cleaningAgg.rawResults += c.rawResults || 0;
      cleaningAgg.droppedGarbage += c.droppedGarbage || 0;
      cleaningAgg.droppedTitleDuplicate += c.droppedTitleDuplicate || 0;
      cleaningAgg.mergedUrlDuplicates += c.mergedUrlDuplicates || 0;
    }
    const merged = new Map();
    waveQueries.forEach((q, qi) => {
      for (const r of (searched[qi]?.results) || []) {
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

  // 3. 相关性漏斗（V1.1）：
  //    商业轮：聚合站公司页（人名商业查询的全文匹配）→ lead_only（线索，不进事实抽取）
  //    其余：评分 + 边界 LLM 复核 → evidence；深挖轮低分降 lead_only
  const ctx = buildRelevanceCtx(name, executionDir, research, selected);
  const isAggregatorLead = r => isBusinessRound
    && BUSINESS_DOMAIN_RE.test(domainOf(r.url))
    && (r.foundBy || []).some(f => f?.reason === "business" || f?.reason === "business-hop");

  const allRaws = [...wave1, ...wave2];
  const aggregatorLeads = allRaws.filter(isAggregatorLead).slice(0, CONFIG.BUSINESS_LEADS_MAX);
  const rest = allRaws.filter(r => !isAggregatorLead(r));
  const pipeline = rest.length > 0
    ? await runRelevancePipeline(rest, { ctx, deep: isDeepRound })
    : { accepted: [], leads: [], stats: { scored: 0, direct: 0, boundary: 0, lowRelevance: 0, llmReviewed: 0, otherPerson: 0, llmIrrelevant: 0, reviewFailed: 0, accepted: 0, leadOnly: 0 } };

  const evidence = [...pipeline.accepted]
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
    .slice(0, CONFIG.MAX_PERSISTED_ROUND);
  const leads = [...pipeline.leads, ...aggregatorLeads.map(markLead)]
    .slice(0, CONFIG.MAX_PERSISTED_DEEP);
  const filterStats = {
    ...cleaningAgg,
    ...pipeline.stats,
    persistedEvidence: evidence.length,
    leadOnly: leads.length,
    deep: isDeepRound,
  };
  console.log(`[person-research] 漏斗: 原始 ${filterStats.rawResults} → 评分 ${filterStats.scored}（直接 ${filterStats.direct} / 边界 ${filterStats.boundary}）+ 聚合 lead ${aggregatorLeads.length} → evidence ${evidence.length} / lead ${leads.length}`);

  // 4. 新来源落盘（evidence + lead_only，含相关性字段）+ 抓 evidence 正文
  const newRecords = [...evidence, ...leads].map(r => ({
    ...r,
    domain: domainOf(r.url),
    domainClass: domainClass(domainOf(r.url)),
    scraped: Boolean(r.content),
    scrapeError: null,
    foundInRound: roundN,
    observedAt: new Date().toISOString(),
  }));
  let newSourceIds = [];
  if (newRecords.length > 0) {
    newSourceIds = allocSourceIds(executionDir, newRecords.length);
    newRecords.forEach((s, i) => { s.id = newSourceIds[i]; saveSource(executionDir, s); });
    console.log(`[person-research] 本轮持久化 ${newRecords.length} 条（evidence ${evidence.length} / lead ${leads.length}）`);

    const domainCount = new Map();
    const toScrape = newRecords
      .filter(s => s.evidenceUse !== "lead_only" && !s.content)
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

  // 5. 证据抽取与归并（只用 evidence 来源；lead_only 不进事实主张）
  let newClaimIds = [];
  const evidenceRecords = newRecords.filter(s => s.evidenceUse !== "lead_only");
  if (evidenceRecords.length > 0) {
    const factPromptSources = [...evidenceRecords]
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, CONFIG.PROMPT_SOURCES_MAX)
      .map(s => ({ ...s, content: s.scraped ? s.content : s.snippet }));

    const extract = await extractEvidence(profile, selected, factPromptSources, loadClaims(executionDir));
    if (extract.newClaims.length + extract.updates.length + extract.conflicts.length > 0) {
      const observedAt = new Date().toISOString();
      const claimIds = allocClaimIds(executionDir, extract.newClaims.length + extract.conflicts.length);
      const idAlloc = {
        newClaimIds: claimIds.slice(0, extract.newClaims.length),
        conflictClaimIds: claimIds.slice(extract.newClaims.length),
        candidateId: selected?.id || null,
        observedAt,
      };
      const sourceMap = new Map([...existingSources, ...newRecords].map(s => [s.id, s]));
      const applied = applyExtract(loadClaims(executionDir), extract, sourceMap, idAlloc);
      saveClaims(executionDir, applied.claims);
      newClaimIds = applied.newClaimIds;
      console.log(`[person-research] 证据归并: 新主张 ${extract.newClaims.length} / 更新 ${extract.updates.length} / 冲突 ${extract.conflicts.length}`);
    }

    // 商业轮：结构化商业关系 = LLM 抽取（有角色证据的） + 规则化关联（全文匹配但角色未证实）
    //   商业 prompt 池 = 本轮来源（聚合 lead 优先）+ 历史聚合站来源（稳定证据池）
    //   → 同公司同角色归并 → 独立域名升级状态
    if (isBusinessRound) {
      const bizPromptPool = [...newRecords, ...existingSources.filter(s => BUSINESS_DOMAIN_RE.test(s.domain || ""))];
      const promptOrder = s =>
        (BUSINESS_DOMAIN_RE.test(s.domain || "") ? 2 : 0) + Number(s.scraped);
      const seenCanonical = new Set();
      const bizPromptSources = bizPromptPool
        .filter(s => {
          const cu = s.canonicalUrl || canonicalUrl(s.url);
          if (seenCanonical.has(cu)) return false;
          seenCanonical.add(cu);
          return true;
        })
        .sort((a, b) => (promptOrder(b) - promptOrder(a)))
        .slice(0, CONFIG.PROMPT_SOURCES_MAX)
        .map(s => ({ ...s, content: s.scraped ? s.content : s.snippet }));

      const llmRelations = await extractBusinessRelations(profile, selected, bizPromptSources);
      const ruleAssociations = collectAggregatorAssociations([...existingSources, ...newRecords], BUSINESS_DOMAIN_RE);
      const all = [...llmRelations, ...ruleAssociations];
      if (all.length > 0) {
        const observedAt = new Date().toISOString();
        const stamped = all.map(r => ({ ...r, observedAt: observedAt.slice(0, 10) }));
        const sourceMap = new Map([...existingSources, ...newRecords].map(s => [s.id, s]));
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

  // 6. 轮次落盘 + 状态收尾（claimIds 含用户补充的更正主张）
  const roundClaimIds = [...correctedClaimIds, ...newClaimIds];
  const at = new Date().toISOString();
  saveRound(executionDir, {
    id: `r-${roundN}`, n: roundN, kind: "research", business: isBusinessRound, deep: isDeepRound, input: pending.input,
    queries, sourceIds: newSourceIds, claimIds: roundClaimIds, filterStats, at,
  });
  updateResearch(executionDir, {
    pendingRound: null,
    rounds: [...(research.rounds || []), {
      id: `r-${roundN}`, n: roundN, kind: "research", business: isBusinessRound, deep: isDeepRound, input: pending.input,
      queryCount: queries.length, newSourceIds, newClaimIds: roundClaimIds, filterStats, at,
    }],
  });

  console.log(`[person-research] 第 ${roundN} 轮完成: 查询 ${queries.length} / 新来源 ${newSourceIds.length} / 新主张 ${roundClaimIds.length}`);
  return {
    round: roundN,
    queries,
    newSources: newSourceIds.length,
    newClaims: roundClaimIds.length,
    filterStats,
    summary: newSourceIds.length > 0 || correctedClaimIds.length > 0
      ? `第 ${roundN} 轮：新来源 ${newSourceIds.length} 条（原始 ${filterStats.rawResults} → 采纳 ${filterStats.persistedEvidence}${leads.length > 0 ? ` + 线索 ${leads.length}` : ""}），主张变更 ${roundClaimIds.length} 条`
      : `第 ${roundN} 轮：无新增公开来源（可换个方向继续或深挖）`,
  };
}

/** 相关性评分上下文：用户线索优先，选定候选的信号补缺 */
function buildRelevanceCtx(name, executionDir, research, selected) {
  const phone = readPrivate(executionDir).phone || null;
  const userClues = {};
  for (const [k, v] of Object.entries(research.clues || {})) {
    if (v && k !== "phoneTail" && k !== "note") userClues[k] = v;
  }
  const signalClues = {};
  for (const [k, v] of Object.entries(selected?.signals || {})) {
    if (v && !userClues[k]) signalClues[k] = v;
  }
  return {
    name,
    phone,
    knownUrl: userClues.knownUrl || null,
    clues: { ...signalClues, ...userClues, occupation: userClues.occupation || signalClues.occupation || null },
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
