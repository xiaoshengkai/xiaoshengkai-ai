import { test } from "node:test";
import assert from "node:assert";
import { normalizeResults, CATEGORY_ENGINES, categoryFetchesContent } from "../lib/searxng.js";
import { normalizeFirecrawlSearch } from "../lib/firecrawl.js";
import { cleanResults, isGarbageResult } from "../lib/search.js";

const GENERAL_ENGINES = CATEGORY_ENGINES.general;

test("normalizeResults: 空输入返回引擎 ok=0", () => {
  const { results, perEngine } = normalizeResults({}, GENERAL_ENGINES);
  assert.equal(results.length, 0);
  for (const e of GENERAL_ENGINES) {
    assert.equal(perEngine[e].status, "ok");
    assert.equal(perEngine[e].resultCount, 0);
  }
});

test("normalizeResults: 正常结果 + 引擎计数", () => {
  const json = {
    results: [
      { title: "A", url: "https://a.com", content: "snippet A", engine: "baidu" },
      { title: "B", url: "https://b.com", content: "snippet B", engine: "bing" },
      { title: "", url: "", engine: "baidu" }, // 缺 title/url，应被过滤
    ],
  };
  const { results, perEngine } = normalizeResults(json, GENERAL_ENGINES);
  assert.equal(results.length, 2);
  assert.equal(perEngine.baidu.resultCount, 1);
  assert.equal(perEngine.bing.resultCount, 1);
  assert.ok(results[0].snippet.includes("snippet"));
  assert.deepEqual(results[0].engines, ["baidu"]);
});

test("normalizeResults: 失败引擎标记 failed", () => {
  const json = {
    results: [],
    unresponsive_engines: [["sogou", "timeout"]],
  };
  const { perEngine } = normalizeResults(json, GENERAL_ENGINES);
  assert.equal(perEngine.sogou.status, "failed");
  assert.ok(perEngine.sogou.error.includes("timeout"));
});

test("normalizeResults: 保留缩略图与发布时间", () => {
  const json = {
    results: [
      {
        title: "img",
        url: "https://img.example.com/1.png",
        content: "snippet",
        engine: "baidu images",
        img_src: "https://thumb.example.com/1.jpg",
        publishedDate: "2026-08-24",
      },
    ],
  };
  const { results } = normalizeResults(json, CATEGORY_ENGINES.images);
  assert.equal(results[0].thumbnail, "https://thumb.example.com/1.jpg");
  assert.equal(results[0].publishedDate, "2026-08-24");
});

test("categoryFetchesContent: general/news 抓正文，其余不抓", () => {
  assert.equal(categoryFetchesContent("general"), true);
  assert.equal(categoryFetchesContent("news"), true);
  assert.equal(categoryFetchesContent("images"), false);
  assert.equal(categoryFetchesContent("videos"), false);
  assert.equal(categoryFetchesContent("wechat"), false);
});

test("normalizeFirecrawlSearch: 拍平 web/news/images + 字段映射", () => {
  const data = {
    web: [
      { url: "https://a.com", title: "A", description: "web 摘要", position: 1 },
      { url: "", title: "缺 url 应过滤" },
    ],
    news: [
      { url: "https://n.com", title: "N", snippet: "news 摘要", date: "2 hours ago", imageUrl: "https://img/1.jpg" },
    ],
    images: [{ url: "https://i.com", title: "I", imageUrl: "https://img/2.jpg", imageWidth: 100 }],
  };
  const results = normalizeFirecrawlSearch(data);
  assert.equal(results.length, 3);
  assert.equal(results[0].snippet, "web 摘要");
  assert.deepEqual(results[0].engines, ["firecrawl"]);
  assert.equal(results[1].snippet, "news 摘要");
  assert.equal(results[1].publishedDate, "2 hours ago");
  assert.equal(results[1].thumbnail, "https://img/1.jpg");
  assert.equal(results[2].thumbnail, "https://img/2.jpg");
  assert.deepEqual(normalizeFirecrawlSearch(null), []);
});

// ─── 通用清洗（V1.1） ──────────────────────────────────────────────

test("isGarbageResult: 空内容/undefined 页/错误页/反爬拦截页", () => {
  assert.equal(isGarbageResult({ title: "", url: "https://a.com", snippet: "" }), true);
  assert.equal(isGarbageResult({ title: "UNDEFINED Definition & Meaning - Merriam-Webster", url: "https://www.m-w.com/dictionary/undefined" }), true);
  assert.equal(isGarbageResult({ title: "403 Forbidden", url: "https://a.com/x" }), true);
  assert.equal(isGarbageResult({ title: "正常页", url: "https://a.com/x", snippet: "Unauthorized Activity Detected" }), true);
  assert.equal(isGarbageResult({ title: "正常页", url: "https://a.com/x", snippet: "当前暂时无法访问" }), true);
  assert.equal(isGarbageResult({ title: "正常页", url: "https://a.com/x", snippet: "正常摘要" }), false);
});

test("cleanResults: 垃圾过滤 + URL 去重并引擎 + 标题去重 + sourceDomain", () => {
  const { results, stats } = cleanResults([
    { title: "张三的页面", url: "https://a.com/x?utm_source=g", snippet: "摘要一", engines: ["firecrawl"] },
    { title: "张三的页面", url: "https://a.com/x", snippet: "摘要一", engines: ["baidu"] },            // canonical 同 URL → 并引擎
    { title: "张三的页面", url: "https://b.com/y", snippet: "摘要一", engines: ["firecrawl"] },        // 跨域同题+同摘要前缀 → 转载剔除
    { title: "张三的页面", url: "https://a.com/z", snippet: "另一摘要", engines: ["firecrawl"] },      // 同域同题 → 剔除
    { title: "张三的简历", url: "https://a.com/z2", snippet: "另一摘要", engines: ["firecrawl"] },     // 同域不同题 → 保留
    { title: "", url: "https://c.com/1", snippet: "", engines: ["bing"] },                            // 垃圾
    { title: "UNDEFINED", url: "https://c.com/undefined", snippet: "x", engines: ["bing"] },          // 垃圾
  ]);
  assert.equal(stats.rawResults, 7);
  assert.equal(stats.droppedGarbage, 2);
  assert.equal(stats.mergedUrlDuplicates, 1);
  assert.equal(stats.droppedTitleDuplicate, 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].url, "https://a.com/x");
  assert.ok(results[0].url.includes("utm_source") === false);
  assert.deepEqual(results[0].engines.sort(), ["baidu", "firecrawl"]);
  assert.equal(results[0].sourceDomain, "a.com");
  assert.equal(results[1].title, "张三的简历");
});
