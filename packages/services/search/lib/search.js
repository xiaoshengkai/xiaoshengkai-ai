import {
  searxngSearch,
  normalizeResults,
  CATEGORY_ENGINES,
  categoryFetchesContent,
} from "./searxng.js";
import { scrapeUrl } from "./firecrawl.js";

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

  let searxngJson;
  try {
    searxngJson = await searxngSearch(searxngBase, query, {
      category,
      language,
      timeRange,
      page: pageno,
    });
  } catch (err) {
    return { ok: false, error: `searxng_search_failed: ${err.message}` };
  }

  const { results: normalized, perEngine } = normalizeResults(searxngJson, engines);
  const deduped = dedupe(normalized).slice(0, limit);

  const allFailed = engines.every((e) => perEngine[e].status === "failed");
  if (allFailed || deduped.length === 0) {
    return {
      ok: false,
      error: "searxng_search_failed: 所有目标引擎均未返回结果",
      engines: perEngine,
    };
  }

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

  const degraded = engines.some((e) => perEngine[e].status === "failed");

  return {
    ok: true,
    query,
    category,
    page: pageno,
    results,
    degraded,
    engines: perEngine,
  };
}
