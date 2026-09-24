import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { isPreviewImage, previewPathFor, isPreviewRequest, getPreview } from "../image-preview.js";

test("isPreviewImage: 只认 png/jpg/jpeg/webp", () => {
  assert.equal(isPreviewImage(".png"), true);
  assert.equal(isPreviewImage(".JPG"), true);
  assert.equal(isPreviewImage(".jpeg"), true);
  assert.equal(isPreviewImage(".webp"), true);
  assert.equal(isPreviewImage(".gif"), false);
  assert.equal(isPreviewImage(".svg"), false);
  assert.equal(isPreviewImage(""), false);
  assert.equal(isPreviewImage(undefined), false);
});

test("previewPathFor: 伴生 <file>.preview.jpg", () => {
  assert.equal(previewPathFor("/x/page-01.png"), "/x/page-01.png.preview.jpg");
});

test("isPreviewRequest: 仅图片 + ?preview=1", () => {
  assert.equal(isPreviewRequest("http://h/f/p.png?preview=1", ".png"), true);
  assert.equal(isPreviewRequest("http://h/f/p.png", ".png"), false);
  assert.equal(isPreviewRequest("http://h/f/p.png?preview=1", ".gif"), false);
  assert.equal(isPreviewRequest("http://h/f/p.mp4?preview=1", ".mp4"), false);
  assert.equal(isPreviewRequest("not a url", ".png"), false);
});

test("getPreview: 生成更小的预览且二次命中缓存", async () => {
  const sharp = (await import("sharp")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prev-"));
  try {
    const file = path.join(dir, "big.png");
    const w = 1200, h = 1200;
    const noise = crypto.randomBytes(w * h * 3);
    await sharp(noise, { raw: { width: w, height: h, channels: 3 } }).png().toFile(file);
    const origSize = fs.statSync(file).size;

    const p1 = await getPreview(file);
    assert.ok(fs.existsSync(p1), "预览文件应生成");
    const pvSize = fs.statSync(p1).size;
    assert.ok(pvSize < origSize, `预览 ${pvSize}B 应小于原图 ${origSize}B`);

    const m1 = fs.statSync(p1).mtimeMs;
    const p2 = await getPreview(file);
    assert.equal(p2, p1);
    assert.equal(fs.statSync(p1).mtimeMs, m1, "二次调用应命中缓存（mtime 不变）");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
