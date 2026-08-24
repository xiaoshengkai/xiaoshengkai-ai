import { z } from "zod";
import { loadNetworkConfig } from "@app/shared/network.js";

const CATEGORY_OPTIONS = ["general", "images", "videos", "news", "wechat"];
const TIME_RANGE_OPTIONS = ["day", "month", "year"];

function searchServiceBase() {
  const network = loadNetworkConfig();
  const host = network.hosts.local;
  const port = network.ports.searchService;
  return `http://${host}:${port}`;
}

function toolResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

// 调用 search service 的 GET 端点
async function callSearchService(path, params, { timeout = 45000 } = {}) {
  const base = searchServiceBase();
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    return await res.json().catch(() => null);
  } finally {
    clearTimeout(timer);
  }
}

export function register(server) {
  server.tool(
    "searchWeb",
    "联网搜索工具。根据关键词搜索网页（本地 SearXNG），支持分类：general(综合网页)/images(图片)/videos(视频)/news(新闻)/wechat(微信公众号)。general/news 默认抓前 3 条结果正文（Firecrawl Cloud），images/videos/wechat 只返回标题/URL/摘要/缩略图不抓正文。返回结构化结果（含标题/URL/摘要/来源引擎），回答时必须引用结果 URL。",
    {
      query: z.string().min(1).describe("搜索关键词"),
      category: z.enum(CATEGORY_OPTIONS).optional().describe("搜索分类，默认 general"),
      language: z.string().optional().describe("语言代码，如 zh-CN/en-US，默认 auto"),
      timeRange: z.enum(TIME_RANGE_OPTIONS).optional().describe("时间范围过滤（部分引擎支持）"),
      page: z.number().int().min(1).max(5).optional().describe("页码，默认 1"),
      maxResults: z.number().int().min(1).max(10).optional().describe("返回结果数，默认 5，最大 10"),
      fetchContent: z.boolean().optional().describe("是否抓取正文，默认 true（仅 general/news 生效，抓前 3 条）"),
    },
    async ({ query, category, language, timeRange, page, maxResults = 5, fetchContent = true }) => {
      try {
        const json = await callSearchService("/search", {
          query, category, language, timeRange, page, maxResults, fetchContent,
        });
        if (!json) return toolResult({ ok: false, error: "search_service_unavailable: 空响应" });
        return toolResult(json);
      } catch (err) {
        return toolResult({ ok: false, error: `search_service_unavailable: ${err.message}` });
      }
    },
  );

  server.tool(
    "scrapeWebPage",
    "抓取指定 URL 的网页正文为 Markdown（Firecrawl Cloud）。用于已知具体 URL 时直接读取页面内容。",
    {
      url: z.string().url().describe("要抓取的网页 URL（http/https）"),
    },
    async ({ url }) => {
      try {
        const json = await callSearchService("/scrape", { url }, { timeout: 60000 });
        if (!json) return toolResult({ ok: false, error: "search_service_unavailable: 空响应" });
        return toolResult(json);
      } catch (err) {
        return toolResult({ ok: false, error: `search_service_unavailable: ${err.message}` });
      }
    },
  );

  server.tool(
    "mapWebsite",
    "发现网站内所有 URL（Firecrawl Cloud /map）。用于找出站点结构或定位具体页面后再抓取。",
    {
      url: z.string().url().describe("起始网站 URL（http/https）"),
    },
    async ({ url }) => {
      try {
        const json = await callSearchService("/map", { url }, { timeout: 60000 });
        if (!json) return toolResult({ ok: false, error: "search_service_unavailable: 空响应" });
        return toolResult(json);
      } catch (err) {
        return toolResult({ ok: false, error: `search_service_unavailable: ${err.message}` });
      }
    },
  );

  server.tool(
    "crawlWebsite",
    "抓取网站多个页面的正文（Firecrawl Cloud /crawl，服务内部等待完成）。用于整站或栏目级内容提取。最多 20 页。",
    {
      url: z.string().url().describe("起始网站 URL（http/https）"),
      limit: z.number().int().min(1).max(20).optional().describe("最大页面数，默认 10，最大 20"),
    },
    async ({ url, limit = 10 }) => {
      try {
        const json = await callSearchService("/crawl", { url, limit }, { timeout: 120000 });
        if (!json) return toolResult({ ok: false, error: "search_service_unavailable: 空响应" });
        return toolResult(json);
      } catch (err) {
        return toolResult({ ok: false, error: `search_service_unavailable: ${err.message}` });
      }
    },
  );

  server.tool(
    "parseDocument",
    "解析在线 PDF 为 Markdown（Firecrawl Cloud）。用于读取线上 PDF 文档内容。",
    {
      url: z.string().url().describe("在线 PDF 文件 URL（http/https）"),
    },
    async ({ url }) => {
      try {
        const json = await callSearchService("/parse", { url }, { timeout: 60000 });
        if (!json) return toolResult({ ok: false, error: "search_service_unavailable: 空响应" });
        return toolResult(json);
      } catch (err) {
        return toolResult({ ok: false, error: `search_service_unavailable: ${err.message}` });
      }
    },
  );
}
