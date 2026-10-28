/**
 * 候选发现轮（步骤 1）：多查询并发搜索 → URL 归一去重 → 高价值页面抓正文
 * → LLM 聚类候选 + 抽取首轮主张 → 落盘 sources/claims/rounds。
 * 搜索全挂不失败（返回空候选停靠，等用户补线索）；只有 LLM 连续解析失败才算步骤失败。
 */
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { CONFIG } from "./config.js";
import { buildDiscoveryQueries } from "./queries.js";
import { searchWeb, scrape, mapLimit } from "./search-client.js";
import { canonicalUrl, domainOf, domainClass } from "./normalize.js";
import { phoneTail, savePrivate, normalizePhone } from "./privacy.js";
import { initResearch, updateResearch, allocSourceIds, allocClaimIds, saveSource, saveClaims, saveRound } from "./store.js";
import { buildClusterPrompt, validateClusterOutput } from "./prompts.js";

const CLASS_ORDER = { A: 0, B: 1, C: 2, D: 3 };

/** 缺省模板参数可能以字面量 "{xxx}" 传入（CLI 最小参数场景），统一清洗为空串 */
function cleanParam(v) {
  const s = String(v ?? "").trim();
  return s && !/^\{.+\}$/.test(s) ? s : "";
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
  initResearch(executionDir, { name, clues });

  // 2. 查询规划 + 并发搜索
  const queries = buildDiscoveryQueries({ name, phone, city, school, company, focus });
  console.log(`[person-research] 发现轮查询 ${queries.length} 组: ${queries.map(q => q.query).join(" / ")}`);
  const searched = await mapLimit(queries, CONFIG.SEARCH_CONCURRENCY,
    q => searchWeb(q.query, { category: q.category }));

  // 3. URL 归一去重（跨查询合并引擎与发现原因）
  const merged = new Map();
  queries.forEach((q, qi) => {
    for (const r of searched[qi] || []) {
      const cu = canonicalUrl(r.url);
      if (!cu || !/^https?:\/\//.test(cu)) continue;
      const prev = merged.get(cu);
      if (prev) {
        prev.engines = [...new Set([...prev.engines, ...(r.engines || [])])];
        prev.foundBy.push(q.reason);
      } else {
        merged.set(cu, {
          url: r.url, canonicalUrl: cu,
          title: String(r.title || "").trim(),
          snippet: String(r.snippet || "").trim(),
          engines: r.engines || [],
          foundBy: [q.reason],
          rank: r.rank || 99,
          publishedAt: r.publishedDate || null,
        });
      }
    }
  });
  console.log(`[person-research] 去重后来源 ${merged.size} 条`);

  // 4. 全部落盘（未抓正文态）
  const domainClassOrder = d => CLASS_ORDER[domainClass(d)];
  const sources = [...merged.values()].map(r => ({
    id: null, // 稍后统一分配
    ...r,
    domain: domainOf(r.url),
    domainClass: domainClass(domainOf(r.url)),
    content: null, scraped: false, scrapeError: null,
    foundInRound: 1,
    observedAt: new Date().toISOString(),
  }));
  const sourceIds = allocSourceIds(executionDir, sources.length);
  sources.forEach((s, i) => { s.id = sourceIds[i]; saveSource(executionDir, s); });

  // 5. 无来源：空停靠（不算失败，用户补线索后可继续）
  if (sources.length === 0) {
    saveRound(executionDir, {
      id: "r-1", n: 1, kind: "discovery", input: null,
      queries, sourceIds: [], claimIds: [], at: new Date().toISOString(),
    });
    updateResearch(executionDir, { candidates: [], claimIds: [], rounds: [{ id: "r-1", n: 1, kind: "discovery", input: null, queryCount: queries.length, newSourceIds: [], newClaimIds: [], at: new Date().toISOString() }] });
    return { round: 1, sources: 0, claims: 0, candidates: [], summary: "未发现可用公开来源：可补充城市/学校/公司等线索后继续" };
  }

  // 6. 选高价值页面抓正文（A/B 级优先、同域名限额、总限额）
  const domainCount = new Map();
  const toScrape = [...sources]
    .sort((a, b) => (domainClassOrder(a.domain) - domainClassOrder(b.domain)) || (a.rank - b.rank))
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

  // 7. 组装 prompt 来源：有正文优先，其余带摘要，总量限额
  const promptSources = [...sources]
    .sort((a, b) => (Number(b.scraped) - Number(a.scraped)) || (domainClassOrder(a.domain) - domainClassOrder(b.domain)))
    .slice(0, CONFIG.PROMPT_SOURCES_MAX)
    .map(s => ({ ...s, content: s.scraped ? s.content : s.snippet }));

  // 8. LLM 聚类 + 抽取（storyboard 式解析重试）
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

  // 9. 分配 claim id + 候选统一补 unconfirmed 状态，落盘
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
    queries, sourceIds, claimIds,
    irrelevantSourceIds: validated.irrelevantSourceIds,
    at: new Date().toISOString(),
  };
  saveRound(executionDir, round);

  updateResearch(executionDir, {
    candidates,
    claimIds,
    rounds: [{
      id: "r-1", n: 1, kind: "discovery", input: null,
      queryCount: queries.length, newSourceIds: sourceIds, newClaimIds: claimIds,
      at: round.at,
    }],
  });

  console.log(`[person-research] 发现轮完成: 候选 ${candidates.length} / 主张 ${claims.length} / 来源 ${sources.length}（正文 ${toScrape.length}）`);
  return {
    round: 1,
    sources: sources.length,
    scraped: toScrape.filter(s => s.scraped).length,
    claims: claims.length,
    candidates: candidates.map(c => ({ id: c.id, displayName: c.displayName, confidence: c.confidence })),
    summary: candidates.length > 0
      ? `发现 ${candidates.length} 个候选人物，${claims.length} 条待核查主张`
      : "未聚类出候选人物：可补充线索后继续",
  };
}
