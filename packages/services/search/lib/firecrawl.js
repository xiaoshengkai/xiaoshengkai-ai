// Firecrawl Cloud 适配
// - scrapeUrl:    POST /v2/scrape（含 parsers 解析 PDF/DOCX）
// - mapWebsite:   POST /v2/map
// - crawlWebsite: POST /v2/crawl + GET /v2/crawl/{id}（内部轮询）
const FIRECRAWL_BASE = "https://api.firecrawl.dev";

async function firecrawl(path, apiKey, body, { timeout = 30000, method = "POST" } = {}) {
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY 未配置");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${FIRECRAWL_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Firecrawl HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function scrapeUrl(url, apiKey, { timeout = 30000 } = {}) {
  const json = await firecrawl("/v2/scrape", apiKey, { url, formats: ["markdown"] }, { timeout });
  if (!json.success) {
    throw new Error(`Firecrawl 抓取失败: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return {
    markdown: json.data?.markdown ?? "",
    metadata: json.data?.metadata ?? {},
  };
}

// 解析在线 PDF 为 Markdown，复用 scrape 的 parsers（当前仅支持 pdf）
export async function parseDocument(url, apiKey, { timeout = 60000 } = {}) {
  const json = await firecrawl(
    "/v2/scrape",
    apiKey,
    { url, formats: ["markdown"], parsers: ["pdf"] },
    { timeout },
  );
  if (!json.success) {
    throw new Error(`Firecrawl 解析失败: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return {
    markdown: json.data?.markdown ?? "",
    metadata: json.data?.metadata ?? {},
  };
}

// 发现站点内 URL
export async function mapWebsite(url, apiKey, { timeout = 30000 } = {}) {
  const json = await firecrawl("/v2/map", apiKey, { url }, { timeout });
  if (!json.success) {
    throw new Error(`Firecrawl map 失败: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return (json.links ?? []).map((l) => ({
    url: l.url,
    title: l.title ?? null,
    description: l.description ?? null,
  }));
}

// 抓取网站多页（内部轮询直到完成，最多 20 页）
export async function crawlWebsite(url, apiKey, { limit = 10, timeout = 120000, pollMs = 3000 } = {}) {
  const pageLimit = Math.min(Math.max(1, limit), 20);
  const start = await firecrawl(
    "/v2/crawl",
    apiKey,
    { url, limit: pageLimit, scrapeOptions: { formats: ["markdown"], onlyMainContent: true } },
    { timeout: 60000 },
  );
  if (!start.success) {
    throw new Error(`Firecrawl crawl 启动失败: ${JSON.stringify(start).slice(0, 300)}`);
  }
  const id = start.id;
  if (!id) throw new Error("Firecrawl crawl 未返回 id");

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const status = await firecrawl(`/v2/crawl/${id}`, apiKey, {}, { method: "GET", timeout: 30000 });
    if (status.status === "completed") {
      return {
        status: "completed",
        total: status.total ?? 0,
        creditsUsed: status.creditsUsed ?? 0,
        pages: (status.data ?? []).map((d) => ({
          markdown: d.markdown ?? "",
          title: d.metadata?.title ?? null,
          sourceURL: d.metadata?.sourceURL ?? d.metadata?.url ?? null,
        })),
      };
    }
    if (status.status === "failed" || status.status === "cancelled") {
      throw new Error(`Firecrawl crawl 状态: ${status.status}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Firecrawl crawl 超时（${timeout}ms）`);
}
