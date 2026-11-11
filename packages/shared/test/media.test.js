import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const root = mkdtempSync(path.join(tmpdir(), "media-test-"));
process.env.MEDIA_DIR = root;

const {
  generateToken,
  isValidToken,
  addMedia,
  getMedia,
  listMedia,
  deleteMedia,
} = await import("../media.js");

test("generateToken produces valid, unique, unguessable tokens", () => {
  const a = generateToken();
  const b = generateToken();
  assert.ok(isValidToken(a));
  assert.ok(isValidToken(b));
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{16,64}$/);
});

test("addMedia / getMedia / listMedia / deleteMedia round-trip", () => {
  const src = path.join(root, "src.mp4");
  writeFileSync(src, Buffer.from("fake-video-bytes"));

  const token = addMedia({ filePath: src, mime: "video/mp4", title: "测试视频", kind: "video" });

  const found = getMedia(token);
  assert.ok(found);
  assert.equal(found.meta.mime, "video/mp4");
  assert.equal(found.meta.title, "测试视频");
  assert.equal(found.meta.kind, "video");
  assert.equal(found.meta.size, 16);
  assert.ok(fs.existsSync(found.filePath));

  const list = listMedia();
  assert.equal(list.length, 1);
  assert.equal(list[0].token, token);

  assert.equal(deleteMedia(token), true);
  assert.equal(getMedia(token), null);
  assert.equal(deleteMedia(token), false);
  assert.equal(listMedia().length, 0);
});

test("invalid tokens are rejected (no path traversal / injection)", () => {
  assert.equal(getMedia("../etc/passwd"), null);
  assert.equal(getMedia("a/b"), null);
  assert.equal(getMedia("x".repeat(5)), null); // 太短
  assert.equal(getMedia("x".repeat(200)), null); // 太长
  assert.equal(getMedia(""), null);
  assert.equal(deleteMedia("..%2F..%2Fetc"), false);
});

test("missing token returns null, delete missing returns false", () => {
  const token = generateToken();
  assert.equal(getMedia(token), null);
  assert.equal(deleteMedia(token), false);
});

test("index.json persists across module calls (file-backed)", () => {
  const src = path.join(root, "img.png");
  writeFileSync(src, Buffer.from("png-bytes"));
  const token = addMedia({ filePath: src, mime: "image/png", kind: "image" });

  const idxPath = path.join(root, "index.json");
  assert.ok(fs.existsSync(idxPath));
  const raw = JSON.parse(fs.readFileSync(idxPath, "utf-8"));
  assert.ok(raw[token]);
  assert.equal(raw[token].kind, "image");
});

test("title is truncated to 100 chars", () => {
  const src = path.join(root, "long.mp4");
  writeFileSync(src, Buffer.from("x"));
  const token = addMedia({ filePath: src, mime: "video/mp4", title: "长".repeat(200) });
  assert.equal(getMedia(token).meta.title.length, 100);
  deleteMedia(token);
});

test.after(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.MEDIA_DIR;
});
