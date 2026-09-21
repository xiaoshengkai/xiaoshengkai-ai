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

// 合并同 URL 结果的引擎名，并去重
function dedupe(results) {
  const map = new Map();
  for (const r of results) {
    const key = normalizeUrl(r.url);
    if (map.has(key)) {
      const prev = map.get(key);
      prev.engines = Array.from(new Set([...prev.engines, ...r.engines]));
    } else {
      map.set(key, { ...r, url: key, engines: [...r.engines] });
    }
  }
  return [...map.values()];
}

export async function search({
  query,
  category = "general",
  language,
  timeRange,
  page,
  maxResults = 5,
  fetchContent = true,
  searxngBase,
  firecrawlApiKey,
}) {
  const engines = CATEGORY_ENGINES[category] || CATEGORY_ENGINES.general;
  const limit = Math.min(Math.max(1, maxResults), MAX_RESULTS);
  const pageno = Math.min(Math.max(1, page || 1), MAX_PAGE);

  let normalized = null;
  let perEngine = null;
  let provider = "searxng";
  let degraded = false;
  const errors = [];

  // Firecrawl 主搜（general/news/images；无分页，page>1 直接走 SearXNG）
  // ponytail: language 参数 Firecrawl 不支持，静默忽略（结果按 query 语言排序）
  if (pageno === 1) {
    try {
      const results = await firecrawlSearch(query, firecrawlApiKey, { category, timeRange, limit });
      if (results === null) {
        // 类别不支持（videos/wechat），走 SearXNG
      } else if (results.length > 0) {
        normalized = results;
        perEngine = { firecrawl: { status: "ok", resultCount: results.length } };
        provider = "firecrawl";
      } else {
        errors.push("firecrawl: 0 结果");
        degraded = true;
      }
    } catch (err) {
      errors.push(`firecrawl: ${err.message}`);
      degraded = true;
    }
  }

  // SearXNG：videos/wechat 唯一通道，其余类别兜底
  if (!normalized) {
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

  const deduped = dedupe(normalized).slice(0, limit);

  const results = deduped.map((r, i) => ({
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
    results,
    degraded,
    engines: perEngine,
  };
}
