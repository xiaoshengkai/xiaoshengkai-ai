import {
  searxngSearch,
  normalizeResults,
  CATEGORY_ENGINES,
  categoryFetchesContent,
} from "./searxng.js";
import { scrapeUrl, searchWeb as firecrawlSearch } from "./firecrawl.js";

const MAX_RESULTS = 10;
const MAX_FETCH = 3;
const MAX_PAGE = 5;

// 去除常见追踪参数，保留业务必需参数
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    const strip = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "spm", "from"];
    for (const k of strip) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

// 垃圾页判定：空内容 / undefined 字典页 / 错误页 / 反爬拦截页
export function isGarbageResult(r) {
  const t = String(r.title || "").trim().toLowerCase();
  const u = String(r.url || "").toLowerCase();
  const s = String(r.snippet || "").slice(0, 200).toLowerCase();
  if (!t && !s) return true;
  if (/\/undefined([/?#]|$)/.test(u) || t === "undefined") return true;
  if (/^(403|404|forbidden|access denied)\b/.test(t)) return true;
  if (s.includes("unauthorized activity detected") || s.includes("当前暂时无法访问")) return true;
  return false;
}

function normTitle(t) {
  return String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * 通用清洗（provider 无关）：垃圾过滤 → canonical URL 去重（并引擎）
 * → 标题去重（同域同题；跨域同题+同摘要前缀=转载）。结果补 sourceDomain。
 */
export function cleanResults(results) {
  const stats = { rawResults: results.length, droppedGarbage: 0, droppedTitleDuplicate: 0, mergedUrlDuplicates: 0 };
  const byCanonical = new Map();
  const seenTitleDomain = new Set();
  const seenTitleSnippet = new Set();
  const out = [];
  for (const r of results) {
    if (isGarbageResult(r)) { stats.droppedGarbage++; continue; }
    const cu = normalizeUrl(r.url);
    const prev = byCanonical.get(cu);
    if (prev) {
      prev.engines = Array.from(new Set([...prev.engines, ...r.engines]));
      stats.mergedUrlDuplicates++;
      continue;
    }
    const title = normTitle(r.title);
    let host = "";
    try { host = new URL(r.url).hostname.toLowerCase(); } catch { /* keep */ }
    const tKey = `${host}|${title}`;
    const tsKey = `${title}|${String(r.snippet || "").slice(0, 80)}`;
    if (title && (seenTitleDomain.has(tKey) || seenTitleSnippet.has(tsKey))) {
      stats.droppedTitleDuplicate++;
      continue;
    }
    if (title) { seenTitleDomain.add(tKey); seenTitleSnippet.add(tsKey); }
    const rec = { ...r, url: cu, sourceDomain: host };
    byCanonical.set(cu, rec);
    out.push(rec);
  }
  return { results: out, stats };
}

export async function search({
  query,
  category = "general",
  language,
  timeRange,
  page,
  maxResults = 5,
  fetchContent = true,
  strategy = "auto",
  searxngBase,
  firecrawlApiKey,
}) {
  const engines = CATEGORY_ENGINES[category] || CATEGORY_ENGINES.general;
  const limit = Math.min(Math.max(1, maxResults), MAX_RESULTS);
  const pageno = Math.min(Math.max(1, page || 1), MAX_PAGE);
  // strategy: auto=现状（Firecrawl 主搜→SearXNG 兜底）；primary=仅 Firecrawl（0 结果即停，人物研究高精度首搜）；
  //           expand=仅 SearXNG（受控扩搜换引擎重查）
  const primary = strategy === "primary";
  const expand = strategy === "expand";

  let normalized = null;
  let perEngine = null;
  let provider = "searxng";
  let degraded = false;
  const errors = [];

  if (pageno === 1 && !expand) {
    try {
      const results = await firecrawlSearch(query, firecrawlApiKey, { category, timeRange, limit });
      if (results !== null && results.length > 0) {
        normalized = results;
        perEngine = { firecrawl: { status: "ok", resultCount: results.length } };
        provider = "firecrawl";
      } else if (results !== null) {
        errors.push("firecrawl: 0 结果");
        degraded = true;
        // primary 模式：0 结果即停（ok:true 空结果），由调用方决定是否扩搜
        if (primary) {
          normalized = [];
          perEngine = { firecrawl: { status: "ok", resultCount: 0 } };
          provider = "firecrawl";
        }
      }
      // results === null（类别不支持）→ 落 SearXNG（primary 也落：Firecrawl 根本不服务该类别）
    } catch (err) {
      errors.push(`firecrawl: ${err.message}`);
      degraded = true;
    }
  }

  if (!normalized && !primary) {
    try {
      const searxngJson = await searxngSearch(searxngBase, query, {
        category,
        language,
        timeRange,
        page: pageno,
      });
      const norm = normalizeResults(searxngJson, engines);
      perEngine = norm.perEngine;
      const allFailed = engines.every((e) => norm.perEngine[e].status === "failed");
      if (allFailed || norm.results.length === 0) {
        errors.push("searxng: 所有目标引擎均未返回结果");
      } else {
        normalized = norm.results;
        if (engines.some((e) => norm.perEngine[e].status === "failed")) degraded = true;
      }
    } catch (err) {
      errors.push(`searxng: ${err.message}`);
    }
  }

  if (!normalized) {
    return {
      ok: false,
      error: `search_failed: ${errors.join(" | ")}`,
      engines: perEngine,
    };
  }

  const cleaned = cleanResults(normalized);
  const results = cleaned.results.slice(0, limit).map((r, i) => ({
    rank: i + 1,
    ...r,
    content: null,
    contentFetched: false,
    contentError: null,
  }));

  const shouldFetch = fetchContent && categoryFetchesContent(category);
  const fetchCount = shouldFetch ? Math.min(MAX_FETCH, results.length) : 0;
  if (fetchCount > 0) {
    await Promise.all(
      results.slice(0, fetchCount).map(async (r) => {
        try {
          const { markdown } = await scrapeUrl(r.url, firecrawlApiKey);
          r.content = markdown;
          r.contentFetched = true;
        } catch (err) {
          r.contentError = err.message;
        }
      }),
    );
  }

  return {
    ok: true,
    query,
    category,
    page: pageno,
    provider,
    strategy,
    results,
    degraded,
    engines: perEngine,
    cleaning: { ...cleaned.stats, finalCount: results.length },
  };
}
