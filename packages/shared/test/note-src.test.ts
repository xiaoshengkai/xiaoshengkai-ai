import test from "node:test";
import assert from "node:assert/strict";
import { parseNoteIframeSrc } from "../../ai-chat/src/lib/utils/note-src";

test("parseNoteIframeSrc: 相对 / basePath / 绝对 / 带端口 / 尾斜杠 / query", () => {
  assert.equal(parseNoteIframeSrc("/note/abc123"), "abc123");
  assert.equal(parseNoteIframeSrc("/ai/note/abc123"), "abc123");
  assert.equal(parseNoteIframeSrc("http://example.com:4321/note/abc123"), "abc123");
  assert.equal(parseNoteIframeSrc("https://example.com/note/abc123"), "abc123");
  assert.equal(parseNoteIframeSrc("/note/abc123/"), "abc123");
  assert.equal(parseNoteIframeSrc("/note/abc123?x=1"), "abc123");
});

test("parseNoteIframeSrc: 非笔记 iframe 返回 null（保持裸 iframe 渲染）", () => {
  assert.equal(parseNoteIframeSrc(undefined), null);
  assert.equal(parseNoteIframeSrc(null), null);
  assert.equal(parseNoteIframeSrc(""), null);
  assert.equal(parseNoteIframeSrc("/video/x.mp4"), null);
  assert.equal(parseNoteIframeSrc("/api/workflows/execution/1/file/a.html"), null);
});
