// DeepSeek Search/Fetch 适配（自研搜索引擎，OpenAI 兼容 Bearer 鉴权）
// - deepseekSearch: POST /tools/search（need_content=true 内联正文，省二次抓取）
// - deepseekFetch:  POST /tools/fetch（单 URL 抓 Markdown）
const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

async function deepseekRequest(path, apiKey, baseUrl, body, { timeout = 30000 } = {}) {
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY 未配置");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${baseUrl || DEEPSEEK_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`DeepSeek ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 拍平 DeepSeek Search results 为统一结果结构（与 normalizeResults/normalizeFirecrawlSearch 输出一致）
export function normalizeDeepSeekResults(data) {
  const out = [];
  for (const it of data?.results ?? []) {
    if (!it?.url || !it?.title) continue;
    out.push({
      title: it.title,
      url: it.url,
      snippet: (it.snippet || it.summary || "").slice(0, 500),
      engines: ["deepseek"],
      thumbnail: it.site_icon ?? null,
      publishedDate: it.date ?? null,
      // 内联正文（need_content=true 时非空），供 search() 跳过二次 Firecrawl scrape
      content: it.content ?? null,
      siteName: it.site_name ?? null,
      authority: it.authority ?? null,
    });
  }
  return out;
}

export async function deepseekSearch(query, apiKey, { baseUrl, count = 5, needContent = true, timeout = 30000 } = {}) {
  const json = await deepseekRequest("/tools/search", apiKey, baseUrl, {
    query,
    count,
    need_content: needContent,
  }, { timeout });
  return normalizeDeepSeekResults(json);
}

export async function deepseekFetch(url, apiKey, { baseUrl, timeout = 30000 } = {}) {
  const json = await deepseekRequest("/tools/fetch", apiKey, baseUrl, { url }, { timeout });
  return {
    markdown: json?.content ?? "",
    metadata: { title: json?.title ?? "" },
  };
}
