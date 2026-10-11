import { test } from "node:test";
import assert from "node:assert/strict";
import { toModelMessages } from "../src/app/api/chat/to-model-messages";

type AnyMsg = Parameters<typeof toModelMessages>[0];

test("assistant: 保留 reasoning + text + tool-call，并补 role:tool 结果", () => {
  const msgs = [
    { role: "user", parts: [{ type: "text", text: "q1" }] },
    {
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "reasoning", text: "我在想…" },
        { type: "text", text: "答案" },
        { type: "dynamic-tool", toolCallId: "c1", toolName: "yapiApi", state: "output-available", input: { url: "x" }, output: { ok: true } },
      ],
    },
  ];
  const out = toModelMessages(msgs as AnyMsg);
  assert.equal(out.length, 3); // user, assistant, tool
  const assistant = out[1] as { content: { type: string; toolCallId?: string }[] };
  assert.deepEqual(assistant.content.map((p) => p.type), ["reasoning", "text", "tool-call"]);
  assert.equal(assistant.content[2].toolCallId, "c1");
  const tool = out[2] as { role: string; content: { type: string; output: unknown }[] };
  assert.equal(tool.role, "tool");
  assert.equal(tool.content[0].type, "tool-result");
  assert.deepEqual(tool.content[0].output, { type: "json", value: { ok: true } });
});

test("未完成 tool 态跳过（不留悬空 tool-call）", () => {
  const out = toModelMessages([
    { role: "assistant", parts: [
      { type: "text", text: "x" },
      { type: "dynamic-tool", toolCallId: "c1", toolName: "t", state: "input-streaming", input: {} },
    ] },
  ] as AnyMsg);
  assert.equal(out.length, 1);
  assert.deepEqual((out[0] as { content: { type: string }[] }).content.map((p) => p.type), ["text"]);
});

test("output-error → error-text 结果", () => {
  const out = toModelMessages([
    { role: "assistant", parts: [
      { type: "dynamic-tool", toolCallId: "c1", toolName: "t", state: "output-error", input: {}, errorText: "boom" },
    ] },
  ] as AnyMsg);
  const tool = out[1] as { content: { output: { type: string; value: string } }[] };
  assert.equal(tool.content[0].output.type, "error-text");
  assert.equal(tool.content[0].output.value, "boom");
});

test("不截断：大 output 完整保留", () => {
  const big = "x".repeat(50000);
  const out = toModelMessages([
    { role: "assistant", parts: [
      { type: "dynamic-tool", toolCallId: "c1", toolName: "t", state: "output-available", input: {}, output: big },
    ] },
  ] as AnyMsg);
  const tool = out[1] as { content: { output: { value: string } }[] };
  assert.equal(tool.content[0].output.value.length, 50000);
});

test("user: text + file 保留", () => {
  const out = toModelMessages([
    { role: "user", parts: [
      { type: "text", text: "hi" },
      { type: "file", mediaType: "image/png", data: "AAA" },
    ] },
  ] as AnyMsg);
  assert.deepEqual((out[0] as { content: { type: string }[] }).content.map((p) => p.type), ["text", "file"]);
});
