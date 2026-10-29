/**
 * 候选发现轮（步骤 1，V1.1 三级漏斗）：
 *   高精度首搜（strategy=primary，仅 Firecrawl）→ 通用清洗 + 人物相关性评分 + LLM 边界复核
 *   → 有效来源 ≤2 时受控扩搜一次（SearXNG 换引擎 + 线索变体）→ 持久化 ≤MAX_PERSISTED_DISCOVERY
 *   → 抓正文 → LLM 聚类候选 + 抽取首轮主张。
 * 搜索全挂不失败（空停靠等用户补线索）；只有 LLM 聚类连续解析失败才算步骤失败。
 * 噪声只留 filterStats 计数，不落盘。
 */
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { CONFIG } from "./config.js";
import { buildDiscoveryQueries, buildExpansionQueries } from "./queries.js";
import { searchWeb, scrape, mapLimit } from "./search-client.js";
import { canonicalUrl, domainOf, domainClass } from "./normalize.js";
import { phoneTail, savePrivate, normalizePhone } from "./privacy.js";
import { initResearch, updateResearch, allocSourceIds, allocClaimIds, saveSource, saveClaims, saveRound } from "./store.js";
import { buildClusterPrompt, validateClusterOutput } from "./prompts.js";
import { runRelevancePipeline } from "./relevance.js";

/** 缺省模板参数可能以字面量 "{xxx}" 传入（CLI 最小参数场景），统一清洗为空串 */
function cleanParam(v) {
  const s = String(v ?? "").trim();
  return s && !/^\{.+\}$/.test(s) ? s : "";
}

/** 聚合 search-service 返回的清洗统计 */
function mergeCleaning(agg, searchedArr) {
  for (const s of searchedArr) {
    const c = s?.cleaning;
    if (!c) continue;
    agg.rawResults += c.rawResults || 0;
    agg.droppedGarbage += c.droppedGarbage || 0;
    agg.droppedTitleDuplicate += c.droppedTitleDuplicate || 0;
    agg.mergedUrlDuplicates += c.mergedUrlDuplicates || 0;
  }
}

function mergePipeStats(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + v;
  return out;
}

export async function runDiscovery(name, phone, note, city, school, company, knownUrl, focus, executionDir) {
  name = cleanParam(name);
  phone = normalizePhone(phone);
  note = cleanParam(note);
  city = cleanParam(city);
  school = cleanParam(school);
  company = cleanParam(company);
  knownUrl = cleanParam(knownUrl);
  focus = cleanParam(focus);
  if (!name) throw new Error("缺少姓名（name 参数必填）");

  // 1. 私密输入隔离 + research 状态初始化（原始手机号只进 private.json）
  if (phone) savePrivate(executionDir, { phone });
  const clues = { note, city, school, company, knownUrl, focus, phoneTail: phoneTail(phone) || null };
  const profile = { name, phone: phone || null, clues };
  const ctx = { name, phone: phone || null, knownUrl: knownUrl || null, clues };
  initResearch(executionDir, { name, clues });

  const cleaningAgg = { rawResults: 0, droppedGarbage: 0, droppedTitleDuplicate: 0, mergedUrlDuplicates: 0 };

  // 2. 高精度首搜（primary：仅 Firecrawl，0 结果即停由扩搜决定下一步）
  const queries = buildDiscoveryQueries({ name, phone, city, school, company, focus });
  console.log(`[person-research] 发现轮高精度首搜 ${queries.length} 组: ${queries.map(q => q.query).join(" / ")}`);
  const searched = await mapLimit(queries, CONFIG.SEARCH_CONCURRENCY,
    q => searchWeb(q.query, { category: q.category, strategy: "primary" }));
  mergeCleaning(cleaningAgg, searched);

  const mergeWave = (waveQueries, searchedArr, into, seen) => {
    waveQueries.forEach((q, qi) => {
      for (const r of (searchedArr[qi]?.results) || []) {
        const cu = canonicalUrl(r.url);
        if (!cu || !/^https?:\/\//.test(cu) || seen.has(cu) || into.has(cu)) continue;
        into.set(cu, {
          url: r.url, canonicalUrl: cu,
          title: String(r.title || "").trim(),
          snippet: String(r.snippet || "").trim(),
          engines: r.engines || [],
          foundBy: [q.reason],
          rank: r.rank || 99,
          publishedAt: r.publishedDate || null,
        });
        seen.add(cu);
      }
    });
  };

  const seenCanonical = new Set();
  const wave1 = new Map();
  mergeWave(queries, searched, wave1, seenCanonical);

  // 3. 相关性漏斗：规则评分 → 边界 LLM 批量复核 → 只留 evidence
  let pipeStats = null;
  let accepted = [];
  if (wave1.size > 0) {
    const pipeline = await runRelevancePipeline([...wave1.values()], { ctx });
    pipeStats = pipeline.stats;
    accepted = pipeline.accepted;
  }

  // 4. 受控扩搜（每任务最多一次）：有效来源 ≤2 → SearXNG 换引擎 + 线索变体重查
  let expanded = false;
  if (accepted.length <= 2) {
    const expansionQueries = buildExpansionQueries({ name, school, company, city, focus });
    if (expansionQueries.length > 0) {
      console.log(`[person-research] 首搜有效来源 ${accepted.length} 条 → 受控扩搜一次（SearXNG）: ${expansionQueries.map(q => q.query).join(" / ")}`);
      const expSearched = await mapLimit(expansionQueries, CONFIG.SEARCH_CONCURRENCY,
        q => searchWeb(q.query, { strategy: "expand" }));
      mergeCleaning(cleaningAgg, expSearched);
      const expWave = new Map();
      mergeWave(expansionQueries, expSearched, expWave, seenCanonical);
      if (expWave.size > 0) {
        const expPipeline = await runRelevancePipeline([...expWave.values()], { ctx });
        accepted = [...accepted, ...expPipeline.accepted];
        pipeStats = pipeStats ? mergePipeStats(pipeStats, expPipeline.stats) : expPipeline.stats;
        expanded = true;
      }
    } else {
      console.log("[person-research] 无可用线索变体，跳过扩搜");
    }
  }

  // 5. 持久化上限（分数优先）+ 落盘（含相关性字段）
  accepted.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  const persisted = accepted.slice(0, CONFIG.MAX_PERSISTED_DISCOVERY);
  const filterStats = {
    ...cleaningAgg,
    ...(pipeStats || { scored: 0, direct: 0, boundary: 0, lowRelevance: 0, llmReviewed: 0, otherPerson: 0, llmIrrelevant: 0, reviewFailed: 0, accepted: 0, leadOnly: 0 }),
    persisted: persisted.length,
    expanded,
  };
  console.log(`[person-research] 漏斗: 原始 ${filterStats.rawResults} → 清洗后 ${filterStats.scored} → 直接 ${filterStats.direct} / 边界 ${filterStats.boundary}（复核 ${filterStats.llmReviewed}，同名他人 ${filterStats.otherPerson}）→ 采纳 ${filterStats.accepted} → 持久化 ${persisted.length}${expanded ? "（含扩搜）" : ""}`);

  const sources = persisted.map(r => ({
    ...r,
    domain: domainOf(r.url),
    domainClass: domainClass(domainOf(r.url)),
    scraped: Boolean(r.content),
    scrapeError: null,
    foundInRound: 1,
    observedAt: new Date().toISOString(),
  }));
  const sourceIds = allocSourceIds(executionDir, sources.length);
  sources.forEach((s, i) => { s.id = sourceIds[i]; saveSource(executionDir, s); });

  // 6. 无有效来源：空停靠（不算失败，用户补线索后可继续）
  if (sources.length === 0) {
    saveRound(executionDir, {
      id: "r-1", n: 1, kind: "discovery", input: null,
      queries, sourceIds: [], claimIds: [], filterStats, at: new Date().toISOString(),
    });
    updateResearch(executionDir, { candidates: [], claimIds: [], rounds: [{ id: "r-1", n: 1, kind: "discovery", input: null, queryCount: queries.length, newSourceIds: [], newClaimIds: [], filterStats, at: new Date().toISOString() }] });
    return { round: 1, sources: 0, claims: 0, candidates: [], filterStats, summary: "未发现可用公开来源：可补充城市/学校/公司等线索后继续" };
  }

  // 7. 抓正文（分数序、同域名限额；边界复核已抓的不重抓）
  const domainCount = new Map();
  const toScrape = sources
    .filter(s => !s.content)
    .filter(s => {
      const n = domainCount.get(s.domain) || 0;
      if (n >= CONFIG.DOMAIN_SCRAPE_CAP) return false;
      domainCount.set(s.domain, n + 1);
      return true;
    })
    .slice(0, CONFIG.SCRAPE_PER_ROUND);

  console.log(`[person-research] 抓取正文 ${toScrape.length} 页: ${toScrape.map(s => s.domain).join(", ")}`);
  await Promise.all(toScrape.map(async s => {
    const markdown = await scrape(s.url);
    if (markdown) {
      s.content = markdown.slice(0, CONFIG.CONTENT_TRUNCATE);
      s.scraped = true;
    } else {
      s.scraped = false;
      s.scrapeError = "scrape_failed";
    }
    saveSource(executionDir, s);
  }));

  // 8. prompt 来源：分数序（sources 已按分数排序），有正文用正文
  const promptSources = sources
    .slice(0, CONFIG.PROMPT_SOURCES_MAX)
    .map(s => ({ ...s, content: s.scraped ? s.content : s.snippet }));

  // 9. LLM 聚类 + 抽取（storyboard 式解析重试）
  let parsed = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 5 && !parsed; attempt++) {
    const { system, user } = buildClusterPrompt(profile, promptSources);
    const finalUser = lastErr ? `${user}\n\n上次输出无法解析（${lastErr}），请严格只输出 JSON。` : user;
    console.log(`[person-research] 聚类第 ${attempt + 1}/5 次尝试`);
    const { text } = await callLLM({ system, user: finalUser });
    try {
      parsed = parseJSON(text);
    } catch (err) {
      lastErr = err.message;
    }
  }
  if (!parsed) throw new Error("候选聚类失败: LLM 输出连续 5 次无法解析为 JSON");

  const validated = validateClusterOutput(parsed, promptSources);
  if (validated.candidates.length === 0 && validated.claims.length > 0) {
    console.warn("[person-research] 有主张但无候选（主张引用的候选全被剔除），一并丢弃");
    validated.claims = [];
  }

  // 10. 分配 claim id + 候选统一补 unconfirmed 状态，落盘
  const claimIds = allocClaimIds(executionDir, validated.claims.length);
  const claims = validated.claims.map((cl, i) => ({
    id: claimIds[i], claim: cl.claim, quote: cl.quote, sourceIds: cl.sourceIds,
    candidateId: cl.candidateId, publishedAt: cl.publishedAt,
    observedAt: new Date().toISOString(), status: "single_source", conflicts: [],
  }));
  saveClaims(executionDir, claims);

  const candidates = validated.candidates.map(c => ({ ...c, status: "unconfirmed" }));
  const round = {
    id: "r-1", n: 1, kind: "discovery", input: null,
    queries, sourceIds, claimIds, filterStats,
    irrelevantSourceIds: validated.irrelevantSourceIds,
    at: new Date().toISOString(),
  };
  saveRound(executionDir, round);

  updateResearch(executionDir, {
    candidates,
    claimIds,
    rounds: [{
      id: "r-1", n: 1, kind: "discovery", input: null,
      queryCount: queries.length, newSourceIds: sourceIds, newClaimIds: claimIds, filterStats,
      at: round.at,
    }],
  });

  console.log(`[person-research] 发现轮完成: 候选 ${candidates.length} / 主张 ${claims.length} / 来源 ${sources.length}（正文 ${sources.filter(s => s.scraped).length}）`);
  return {
    round: 1,
    sources: sources.length,
    scraped: sources.filter(s => s.scraped).length,
    claims: claims.length,
    candidates: candidates.map(c => ({ id: c.id, displayName: c.displayName, confidence: c.confidence })),
    filterStats,
    summary: candidates.length > 0
      ? `发现 ${candidates.length} 个候选人物，${claims.length} 条待核查主张（原始 ${filterStats.rawResults} → 采纳 ${filterStats.accepted}）`
      : "未聚类出候选人物：可补充线索后继续",
  };
}
