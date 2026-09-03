import test from "node:test";
import assert from "node:assert/strict";
import { contentToMarkdown, selectCandidate, summarizeImages, updateImageState } from "./note-utils.js";

test("selectCandidate prefers concrete curiosity over vague headlines", () => {
  const selected = selectCandidate([
    { title: "房贷利率解析", promise: "看懂房贷" },
    { title: "首付降到15%是福利？算完这笔账我沉默了", coverText: "首付越低风险越大", promise: "看完能自己算出真实杠杆" },
  ]);
  assert.equal(selected.title, "首付降到15%是福利？算完这笔账我沉默了");
});

test("contentToMarkdown replaces IMG markers", () => {
  const markdown = contentToMarkdown(["开头", "[IMG-1]", "结尾"], [
    { type: "cover", index: 0 },
    { type: "illustration", index: 1, url: "https://example.com/image.jpg" },
  ]);
  assert.equal(markdown, "开头\n\n![插图](./images/illustration-1.jpg)\n\n结尾");
});

test("updateImageState preserves fields written by polling", () => {
  const state = {
    checkCount: 16,
    status: "generating",
    images: [
      { index: 0, status: "done" },
      { index: 1, status: "pending" },
    ],
  };
  const updated = updateImageState(state, 1, { status: "failed", error: "timeout" });
  assert.equal(updated.checkCount, 16);
  assert.equal(updated.images[1].status, "failed");
  assert.equal(updated.images[0].status, "done");
});

test("summarizeImages exposes partial failure details", () => {
  assert.deepEqual(summarizeImages([
    { index: 0, status: "done" },
    { index: 1, status: "failed", error: "图片生成超时，请重试" },
  ]), {
    readyCount: 1,
    failedCount: 1,
    totalCount: 2,
    failedImages: [{ index: 1, error: "图片生成超时，请重试" }],
  });
});
