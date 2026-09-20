import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger } from "../logger.js";

test("createLogger 追加写（时间正序），行不互相覆盖", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  try {
    createLogger("A", dir, { stdout: false });
    console.log("line-A");
    console.log("line-B");
  } finally {
    Object.assign(console, orig);
  }
  const file = fs.readdirSync(dir).find((f) => f.endsWith(".log"));
  const content = fs.readFileSync(path.join(dir, file), "utf-8");
  assert.ok(content.includes("line-A"), "line-A 应落盘");
  assert.ok(content.includes("line-B"), "line-B 应落盘");
  assert.ok(content.indexOf("line-A") < content.indexOf("line-B"), "应为时间正序（A 在 B 前）");
  fs.rmSync(dir, { recursive: true, force: true });
});