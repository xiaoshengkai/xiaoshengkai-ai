// 本地 SearXNG JSON API 适配
// 类别 → 引擎名映射（name 来自 settings.yml，非 engine 模块名）

export const CATEGORY_ENGINES = {
  general: ["baidu", "sogou", "bing"],
  images: ["baidu images", "sogou images", "bing images"],
  videos: ["sogou videos", "bing videos"],
  news: ["bing news"],
  wechat: ["sogou wechat"],
};

export const CATEGORIES = Object.keys(CATEGORY_ENGINES);

// 抓正文的类别（images/videos/wechat 只返回摘要，不消耗 Firecrawl 额度）
export function categoryFetchesContent(category) {
  return category === "general" || category === "news";
}

export async function searxngSearch(
  searxngBase,
  query,
  { category = "general", language, timeRange, page, timeout = 10000 } = {},
) {
  const engines = CATEGORY_ENGINES[category] || CATEGORY_ENGINES.general;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const url = new URL(`${searxngBase}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("engines", engines.join(","));
    if (language) url.searchParams.set("language", language);
    if (timeRange) url.searchParams.set("time_range", timeRange);
    if (page) url.searchParams.set("pageno", String(page));

    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SearXNG HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// SearXNG JSON 结果规范化
// 输入: { results: [{ title, url, content, engine, img_src, publishedDate, ... }], unresponsive_engines: [[name, err], ...] }
export function normalizeResults(searxngJson, engines) {
  const raw = Array.isArray(searxngJson?.results) ? searxngJson.results : [];

  const perEngine = Object.fromEntries(
    engines.map((e) => [e, { status: "ok", resultCount: 0 }]),
  );

  const results = [];
  for (const r of raw) {
    if (!r || !r.url || !r.title) continue;
    results.push({
      title: r.title,
      url: r.url,
      snippet: (r.content || "").slice(0, 500),
      engines: r.engine ? [r.engine] : [],
      thumbnail: r.img_src || r.thumbnail || null,
      publishedDate: r.publishedDate || r.pubdate || null,
    });
    const engine = r.engine;
    if (perEngine[engine]) perEngine[engine].resultCount++;
  }

  for (const [name, err] of searxngJson?.unresponsive_engines ?? []) {
    if (perEngine[name]) {
      perEngine[name] = { status: "failed", error: String(err).slice(0, 120) };
    }
  }

  return { results, perEngine };
}
