import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrapeUrl, mapWebsite, crawlWebsite, parseDocument } from "../lib/firecrawl.js";
import { search } from "../lib/search.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// test/ 目录 → 项目根 (上 4 层)
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..", "..");

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

const API_KEY = readEnv("FIRECRAWL_API_KEY");

test("live: Firecrawl 真实抓取 example.com", async () => {
  assert.ok(API_KEY, "缺少 FIRECRAWL_API_KEY，无法运行 live 测试");
  const { markdown, metadata } = await scrapeUrl("https://example.com", API_KEY);
  assert.ok(markdown.length > 10, "markdown 正文应非空");
  assert.ok(metadata.sourceURL, "metadata 应包含 sourceURL");
});

test("live: Firecrawl map 发现站点 URL", async () => {
  assert.ok(API_KEY, "缺少 FIRECRAWL_API_KEY");
  const links = await mapWebsite("https://example.com", API_KEY);
  assert.ok(Array.isArray(links), "map 应返回数组");
});

test("live: Firecrawl parse 解析在线 PDF", async () => {
  assert.ok(API_KEY, "缺少 FIRECRAWL_API_KEY");
  const { markdown, metadata } = await parseDocument(
    "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    API_KEY,
  );
  assert.ok(markdown.length > 0, "PDF 解析应返回 markdown");
  assert.equal(metadata.contentType, "application/pdf");
});

test("live: Firecrawl crawl 小规模抓取", async () => {
  assert.ok(API_KEY, "缺少 FIRECRAWL_API_KEY");
  const result = await crawlWebsite("https://example.com", API_KEY, { limit: 2 });
  assert.equal(result.status, "completed");
  assert.ok(result.pages.length > 0, "crawl 应返回页面");
});

test("live: search 编排（SearXNG 不可用时返回明确错误，不抛异常）", async () => {
  const network = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "config", "network.json"), "utf-8"));
  const searxngBase = `http://${network.hosts.local}:${network.ports.searxng}`;
  const result = await search({ query: "测试", maxResults: 5, fetchContent: true, searxngBase, firecrawlApiKey: API_KEY });
  assert.ok(typeof result.ok === "boolean");
  if (!result.ok) {
    assert.ok(result.error.startsWith("searxng_search_failed"), `错误信息应明确: ${result.error}`);
  }
});
