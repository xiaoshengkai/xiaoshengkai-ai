import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { processAttachments } from "../../ai-chat/src/lib/multimodal/pipeline";
import { IMAGE_MISSING_NOTE } from "../../ai-chat/src/lib/multimodal/attachment";
import type { Message } from "../../ai-chat/src/lib/utils/types";

const root = path.resolve(process.cwd(), "..", "..");
const image = "test-multimodal.png";
const largeImage = "test-multimodal-large.png";
const imagePath = path.join(root, "data", "static", "images", image);
const largeImagePath = path.join(root, "data", "static", "images", largeImage);

test.before(() => {
  mkdirSync(path.dirname(imagePath), { recursive: true });
  writeFileSync(imagePath, Buffer.from("image fixture"));
});

test.after(() => {
  rmSync(imagePath, { force: true });
  rmSync(largeImagePath, { force: true });
});

function message(text: string): Message[] {
  return [{ id: "1", role: "user", parts: [{ type: "text", text }] }];
}

function textOf(result: { messages: Message[] }, index = 0): string {
  return result.messages[index].parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

/** vision mock：按调用序号返回 desc-N，并记录每次请求体 */
function mockVision(bodies: unknown[] = []) {
  let n = 0;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    n++;
    return Response.json({ choices: [{ message: { content: `desc-${n}` } }] });
  };
  return () => n;
}

test("MiniMax 仅图片走 direct，不调用 preprocess", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("不应调用 preprocess");
  };

  const result = await processAttachments({
    provider: "minimax",
    model: "MiniMax-M3",
    messages: message(`描述这张图 [图片:/api/uploads/${image}]`),
  });

  assert.equal(fetchCount, 0);
  assert.equal(result.messages[0].parts.some((part) =>
    part.type === "file" && typeof part.mediaType === "string" && part.mediaType.startsWith("image/")), true);
});

test("direct 路径不重复发送同一图片", async () => {
  globalThis.fetch = async () => { throw new Error("不应调用 preprocess"); };
  const messages: Message[] = [{
    id: "1",
    role: "user",
    parts: [
      { type: "file", mediaType: "image/png", name: image, data: "data:image/png;base64,aW1hZ2UgZml4dHVyZQ==" },
      { type: "text", text: `[图片:/api/uploads/${image}]` },
    ],
  }];

  const result = await processAttachments({ provider: "minimax", model: "MiniMax-M3", messages });
  const imageParts = result.messages[0].parts.filter((part) =>
    part.type === "file" && typeof part.mediaType === "string" && part.mediaType.startsWith("image/"));

  assert.equal(imageParts.length, 1);
});

test("拒绝超过 10MB 的内联图片 file part", async () => {
  const data = `data:image/png;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")}`;
  const messages: Message[] = [{ id: "1", role: "user", parts: [{ type: "file", mediaType: "image/png", data }] }];
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "不应调用" } }] });

  await assert.rejects(
    () => processAttachments({ provider: "deepseek", model: "deepseek-v4-pro", messages }),
    /图片过大/,
  );
});

test("缺失的本地图片降级注记，不 500 不静默剥离", async () => {
  const calls = mockVision();

  const result = await processAttachments({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    messages: message("描述 [图片:/api/uploads/not-found.png]"),
  });

  assert.equal(calls(), 0);
  assert.equal(textOf(result).includes(IMAGE_MISSING_NOTE), true);
  assert.equal(textOf(result).includes("[图片:/api/uploads/not-found.png]"), false);
});

test("历史 file part 与当前 marker 各自内联描述（逐图一调用）", async () => {
  const bodies: unknown[] = [];
  const calls = mockVision(bodies);
  const messages: Message[] = [
    { id: "1", role: "user", parts: [{ type: "file", mediaType: "image/png", data: "data:image/png;base64,b2xk" }] },
    { id: "2", role: "user", parts: [{ type: "text", text: `再看 [图片:/api/uploads/${image}]` }] },
  ];

  const result = await processAttachments({ provider: "deepseek", model: "deepseek-v4-pro", messages });

  assert.equal(calls(), 2);
  for (const body of bodies as { messages: { content: unknown }[] }[]) {
    assert.equal((JSON.stringify(body.messages[1].content).match(/"type":"image_url"/g) || []).length, 1);
  }
  assert.equal(textOf(result, 0).includes("desc-1"), true);
  assert.equal(result.messages[0].parts.every((p) => p.type !== "file"), true);
  assert.equal(textOf(result, 1).includes("desc-2"), true);
  assert.equal(textOf(result, 1).includes(`[图片:/api/uploads/${image}]`), false);
});

test("本地图片超 10MB 降级注记，不调 vision", async () => {
  writeFileSync(largeImagePath, Buffer.alloc(10 * 1024 * 1024 + 1));
  const calls = mockVision();

  const result = await processAttachments({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    messages: message(`描述 [图片:/api/uploads/${largeImage}]`),
  });

  assert.equal(calls(), 0);
  assert.equal(textOf(result).includes(IMAGE_MISSING_NOTE), true);
});

test("远程图片下载失败时降级注记，不调 vision（优雅降级）", async () => {
  let visionCalled = false;
  globalThis.fetch = async (_url, init) => {
    // downloadRemoteImage 的 GET 请求无 body → JSON.parse(undefined) 抛错 → 下载失败
    if (init?.body === undefined) throw new Error("download failed");
    visionCalled = true;
    return Response.json({ choices: [{ message: { content: "图片描述" } }] });
  };

  const result = await processAttachments({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    messages: message("描述 https://example.com/demo.png"),
  });

  assert.equal(visionCalled, false);
  assert.equal(textOf(result).includes(IMAGE_MISSING_NOTE), true);
});

test("同一图片多占位符只调一次 vision，描述复用内联", async () => {
  const bodies: { messages?: { role?: string; content?: unknown[] }[] }[] = [];
  const calls = mockVision(bodies);
  const messages: Message[] = [
    { id: "1", role: "user", parts: [{ type: "text", text: `[图片:/api/uploads/${image}]` }] },
    { id: "2", role: "assistant", parts: [{ type: "text", text: "上一轮回复" }] },
    { id: "3", role: "user", parts: [{ type: "text", text: `[图片:/api/uploads/${image}] 再看` }] },
  ];

  const result = await processAttachments({ provider: "deepseek", model: "deepseek-v4-pro", messages });
  const content = JSON.stringify(bodies[0]?.messages?.[1]?.content);

  assert.equal(calls(), 1);
  assert.deepEqual(bodies[0]?.messages?.map((m) => m.role), ["system", "user"]);
  assert.equal((content.match(/"type":"image_url"/g) || []).length, 1);
  assert.equal(content.includes("上一轮回复"), false);
  assert.equal(textOf(result, 0).includes("desc-1"), true);
  assert.equal(textOf(result, 2).includes("desc-1"), true);
  assert.equal(textOf(result, 2).includes("再看"), true);
});

test("vision 调用失败降级注记，不阻断对话", async () => {
  globalThis.fetch = async () => { throw new Error("vision provider down"); };

  const result = await processAttachments({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    messages: message(`描述 [图片:/api/uploads/${image}]`),
  });

  assert.equal(textOf(result).includes(IMAGE_MISSING_NOTE), true);
});

test("视频已不支持，静默丢弃不触发 preprocess", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    return Response.json({ choices: [{ message: { content: "不应调用" } }] });
  };
  const messages: Message[] = [{
    id: "1",
    role: "user",
    parts: [{ type: "file", mediaType: "video/mp4", data: "data:video/mp4;base64,dmlkZW8=" }],
  }];

  const result = await processAttachments({ provider: "deepseek", model: "deepseek-v4-pro", messages });

  assert.equal(fetchCount, 0);
  assert.equal(result.messages[0].parts.some((p) => p.type === "text" && p.text === "[视频]"), true);
});
