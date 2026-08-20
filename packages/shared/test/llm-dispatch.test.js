import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ponytail: LLM_SETTINGS_DIR 测试缝隙，隔离真实 data/settings
const dir = mkdtempSync(path.join(tmpdir(), "llm-dispatch-"));
process.env.LLM_SETTINGS_DIR = dir;

function writeSettings(providers, selection) {
  writeFileSync(path.join(dir, "providers.json"), JSON.stringify(providers));
  writeFileSync(path.join(dir, "selection.json"), JSON.stringify(selection));
}

const { callLLM } = await import("../llm/index.js");

test.after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("callLLM 使用 selection.workflow.model，且同进程配置修改后生效", async () => {
  let capturedUrl = "";
  let capturedModel = "";
  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedModel = JSON.parse(opts.body).model;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }], usage: {} }) };
  };

  writeSettings(
    { deepseek: { enabled: true, baseURL: "https://a.example/v1", apiKey: "k", models: { chat: "model-a" } } },
    { workflow: { provider: "deepseek", model: "model-a" } },
  );
  await callLLM({ system: "s", user: "u", format: "" });
  assert.equal(capturedUrl, "https://a.example/v1/chat/completions");
  assert.equal(capturedModel, "model-a");

  writeSettings(
    { deepseek: { enabled: true, baseURL: "https://b.example/v1", apiKey: "k", models: { chat: "model-a" } } },
    { workflow: { provider: "deepseek", model: "model-b" } },
  );
  await callLLM({ system: "s", user: "u", format: "" });
  assert.equal(capturedUrl, "https://b.example/v1/chat/completions");
  assert.equal(capturedModel, "model-b");
});

test("未知 workflow provider 抛错，不再静默回退", async () => {
  writeSettings({}, { workflow: { provider: "bogus", model: "m" } });
  await assert.rejects(() => callLLM({ system: "s", user: "u" }), /Unsupported workflow provider/);
});

test("禁用 provider 抛错", async () => {
  writeSettings(
    { deepseek: { enabled: false, baseURL: "https://a.example/v1", apiKey: "k", models: { chat: "m" } } },
    { workflow: { provider: "deepseek", model: "m" } },
  );
  await assert.rejects(() => callLLM({ system: "s", user: "u" }), /is disabled/);
});
