import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { processAttachments } from "../../ai-chat/src/lib/multimodal/pipeline";
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
  assert.equal(result.systemInjection, undefined);
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

test("缺失的本地图片明确失败，不静默剥离", async () => {
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "不应调用" } }] });

  await assert.rejects(
    () => processAttachments({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      messages: message("描述 [图片:/api/uploads/not-found.png]"),
    }),
    /图片文件不存在/,
  );
});

test("历史 file 图片不阻止当前图片 marker 进入 preprocess", async () => {
  let imageCount = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    imageCount = JSON.stringify(body).match(/\"type\":\"image_url\"/g)?.length ?? 0;
    return Response.json({ choices: [{ message: { content: "两张图片" } }] });
  };
  const messages: Message[] = [
    { id: "1", role: "user", parts: [{ type: "file", mediaType: "image/png", data: "data:image/png;base64,b2xk" }] },
    { id: "2", role: "user", parts: [{ type: "text", text: `再看 [图片:/api/uploads/${image}]` }] },
  ];

  const result = await processAttachments({ provider: "deepseek", model: "deepseek-v4-pro", messages });

  assert.equal(imageCount, 2);
  assert.equal(result.systemInjection, "两张图片");
});

test("preprocess 拒绝超过 10MB 的本地图片", async () => {
  writeFileSync(largeImagePath, Buffer.alloc(10 * 1024 * 1024 + 1));
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "不应调用" } }] });

  await assert.rejects(
    () => processAttachments({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      messages: message(`描述 [图片:/api/uploads/${largeImage}]`),
    }),
    /图片过大/,
  );
});

test("远程图片下载失败时跳过，不调 preprocess（优雅降级）", async () => {
  let preprocessCalled = false;
  globalThis.fetch = async (_url, init) => {
    // downloadRemoteImage 的 GET 请求无 body → JSON.parse(undefined) 抛错 → 下载失败
    if (init?.body === undefined) throw new Error("download failed");
    preprocessCalled = true;
    return Response.json({ choices: [{ message: { content: "图片描述" } }] });
  };

  const result = await processAttachments({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    messages: message("描述 https://example.com/demo.png"),
  });

  assert.equal(preprocessCalled, false);
  assert.equal(result.systemInjection, "");
});

test("preprocess 请求只含媒体，不带历史对话轮", async () => {
  let body: { messages?: { role?: string; content?: unknown[] }[] } | undefined;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "状态面板截图" } }] });
  };
  const messages: Message[] = [
    { id: "1", role: "user", parts: [{ type: "text", text: `[图片:/api/uploads/${image}]` }] },
    { id: "2", role: "assistant", parts: [{ type: "text", text: "上一轮回复" }] },
    { id: "3", role: "user", parts: [{ type: "text", text: `[图片:/api/uploads/${image}] 再看` }] },
  ];

  const result = await processAttachments({ provider: "deepseek", model: "deepseek-v4-pro", messages });
  const content = JSON.stringify(body?.messages?.[1]?.content);

  assert.equal(result.systemInjection, "状态面板截图");
  assert.deepEqual(body?.messages?.map((m) => m.role), ["system", "user"]);
  assert.equal((content.match(/"type":"image_url"/g) || []).length, 1);
  assert.equal(content.includes("上一轮回复"), false);
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
  assert.equal(result.systemInjection, undefined);
  assert.equal(result.messages[0].parts.some((p) => p.type === "text" && p.text === "[视频]"), true);
});
