/**
 * search-service 薄客户端：搜索（不抓正文）+ 单页抓取 + 并发限制。
 * 失败一律降级为空结果/None（正文抓取失败不丢弃搜索结果），由调用方决定预算。
 */
import { loadNetworkConfig } from "@app/shared/network.js";
import { withTimeout } from "@app/shared/utils.js";
import { CONFIG } from "./config.js";

function searchServiceBase() {
  const network = loadNetworkConfig();
  return `http://${network.hosts.local}:${network.ports.searchService}`;
}

export async function searchWeb(query, { category = "general", maxResults = 8, strategy = "auto" } = {}) {
  try {
    const url = new URL(`${searchServiceBase()}/search`);
    url.searchParams.set("query", query);
    url.searchParams.set("category", category);
    url.searchParams.set("maxResults", String(maxResults));
    url.searchParams.set("fetchContent", "false");
    url.searchParams.set("strategy", strategy);
    const res = await withTimeout(fetch(url), CONFIG.SEARCH_TIMEOUT_MS, `searchWeb ${query}`);
    const json = await res.json();
    if (!json.ok) return { results: [], cleaning: null };
    return { results: json.results || [], cleaning: json.cleaning || null };
  } catch (err) {
    console.warn(`[person-research] 搜索失败: ${query}: ${err.message}`);
    return { results: [], cleaning: null };
  }
}

export async function scrape(url) {
  try {
    const target = new URL(`${searchServiceBase()}/scrape`);
    target.searchParams.set("url", url);
    const res = await withTimeout(fetch(target), CONFIG.SCRAPE_TIMEOUT_MS, `scrape ${url}`);
    const json = await res.json();
    return json.ok ? json.markdown : null;
  } catch (err) {
    console.warn(`[person-research] 抓取失败: ${url}: ${err.message}`);
    return null;
  }
}

export async function mapLimit(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return out;
}
