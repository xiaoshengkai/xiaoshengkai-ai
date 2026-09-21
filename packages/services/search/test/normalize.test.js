import { test } from "node:test";
import assert from "node:assert";
import { normalizeResults, CATEGORY_ENGINES, categoryFetchesContent } from "../lib/searxng.js";
import { normalizeFirecrawlSearch } from "../lib/firecrawl.js";

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
