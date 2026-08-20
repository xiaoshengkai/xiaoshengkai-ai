import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "tts-timeout-"));
process.env.LLM_SETTINGS_DIR = dir;
writeFileSync(path.join(dir, "providers.json"), JSON.stringify({
  minimax: { enabled: true, apiKey: "sk-test", baseURL: "http://10.255.255.1/v1", models: { tts: "speech-2.8-hd" } },
}));
writeFileSync(path.join(dir, "selection.json"), JSON.stringify({ tts: { provider: "minimax", model: "speech-2.8-hd" } }));

const { generateTTS } = await import("../llm/providers/minimax.js");

test.after(() => rmSync(dir, { recursive: true, force: true }));

test("TTS create fetch 有 30s 超时上限，不 hang 死", async () => {
  const start = Date.now();
  await assert.rejects(() => generateTTS({ text: "测试", voiceId: "male-qn-qingse", outputPath: "/tmp/opencode/tts-timeout.mp3" }));
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 40000, `应 40s 内抛错，实际 ${elapsed}ms`);
});
