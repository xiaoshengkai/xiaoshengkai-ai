import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { search } from "./lib/search.js";
import { scrapeUrl, mapWebsite, crawlWebsite, parseDocument } from "./lib/firecrawl.js";
import { CATEGORIES } from "./lib/searxng.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// packages/services/search → 项目根 (上 3 层)
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");

// 读取根 .env 中指定变量（零依赖，优先用已注入的环境变量）
function readEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, ".env"), "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
  return "";
}

const network = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "config", "network.json"), "utf-8"));
const SEARXNG_PORT = network.ports.searxng;
const SERVICE_PORT = network.ports.searchService;
const HOST = network.hosts.local;

const searxngBase = `http://${HOST}:${SEARXNG_PORT}`;
const firecrawlApiKey = readEnv("FIRECRAWL_API_KEY");

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function requiredUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function handleSearch(url, res) {
  const query = url.searchParams.get("query");
  if (!query) return json(res, 400, { ok: false, error: "缺少 query 参数" });

  const category = url.searchParams.get("category") || "general";
  const maxResults = Number(url.searchParams.get("maxResults")) || 5;
  const fetchContent = url.searchParams.get("fetchContent") !== "false";
  const language = url.searchParams.get("language") || undefined;
  const timeRange = url.searchParams.get("timeRange") || undefined;
  const page = Number(url.searchParams.get("page")) || 1;

  const result = await search({
    query, category, language, timeRange, page,
    maxResults, fetchContent, searxngBase, firecrawlApiKey,
  });
  json(res, result.ok ? 200 : 502, result);
}

async function handleScrape(url, res) {
  const target = requiredUrl(url.searchParams.get("url"));
  if (!target) return json(res, 400, { ok: false, error: "缺少合法的 http/https url 参数" });
  try {
    const { markdown, metadata } = await scrapeUrl(target, firecrawlApiKey);
    json(res, 200, { ok: true, url: target, markdown, metadata });
  } catch (err) {
    json(res, 502, { ok: false, error: err.message });
  }
}

async function handleMap(url, res) {
  const target = requiredUrl(url.searchParams.get("url"));
  if (!target) return json(res, 400, { ok: false, error: "缺少合法的 http/https url 参数" });
  try {
    const links = await mapWebsite(target, firecrawlApiKey);
    json(res, 200, { ok: true, url: target, links, count: links.length });
  } catch (err) {
    json(res, 502, { ok: false, error: err.message });
  }
}

async function handleCrawl(url, res) {
  const target = requiredUrl(url.searchParams.get("url"));
  if (!target) return json(res, 400, { ok: false, error: "缺少合法的 http/https url 参数" });
  const limit = Number(url.searchParams.get("limit")) || 10;
  try {
    const result = await crawlWebsite(target, firecrawlApiKey, { limit });
    json(res, 200, { ok: true, url: target, ...result });
  } catch (err) {
    json(res, 502, { ok: false, error: err.message });
  }
}

async function handleParse(url, res) {
  const target = requiredUrl(url.searchParams.get("url"));
  if (!target) return json(res, 400, { ok: false, error: "缺少合法的 http/https url 参数" });
  try {
    const { markdown, metadata } = await parseDocument(target, firecrawlApiKey);
    json(res, 200, { ok: true, url: target, markdown, metadata });
  } catch (err) {
    json(res, 502, { ok: false, error: err.message });
  }
}

async function checkSearxng() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${searxngBase}/healthz`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /health") {
    return json(res, 200, { ok: true });
  }

  if (route === "GET /ready") {
    const searxngReady = await checkSearxng();
    return json(res, 200, {
      ok: true,
      searxngReady,
      firecrawlConfigured: !!firecrawlApiKey,
      categories: CATEGORIES,
    });
  }

  if (route === "GET /search") return handleSearch(url, res);
  if (route === "GET /scrape") return handleScrape(url, res);
  if (route === "GET /map") return handleMap(url, res);
  if (route === "GET /crawl") return handleCrawl(url, res);
  if (route === "GET /parse") return handleParse(url, res);

  json(res, 404, { ok: false, error: "not found" });
});

server.listen(SERVICE_PORT, HOST, () => {
  console.log(`[search-service] listening on http://${HOST}:${SERVICE_PORT}`);
  console.log(`[search-service] searxng=${searxngBase} firecrawl=${firecrawlApiKey ? "configured" : "MISSING"}`);
});
