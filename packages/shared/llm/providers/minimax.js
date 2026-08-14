import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_PATH = path.resolve(__dirname, "..", "..", "..", "..", "data", "settings", "providers.json");

let MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";
let MINIMAX_IMAGE_MODEL = process.env.MINIMAX_IMAGE_MODEL || "image-01";
let MINIMAX_CHAT_MODEL = process.env.MINIMAX_CHAT_MODEL || "MiniMax-M3";

try {
  if (fs.existsSync(PROVIDERS_PATH)) {
    const p = JSON.parse(fs.readFileSync(PROVIDERS_PATH, "utf-8"));
    if (p.minimax?.baseURL) MINIMAX_BASE_URL = p.minimax.baseURL;
    if (p.minimax?.models?.image) MINIMAX_IMAGE_MODEL = p.minimax.models.image;
    if (p.minimax?.models?.chat) MINIMAX_CHAT_MODEL = p.minimax.models.chat;
  }
} catch { /* fallback to env */ }

export async function callLLM({ system, user, model, temperature = 0.7, maxTokens = 8000, format = 'json_object', images = [] }) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("未配置 MINIMAX_API_KEY");

  const actualModel = model || MINIMAX_CHAT_MODEL;
  console.log(`[minimax] 当前调用: model=${actualModel} baseURL=${MINIMAX_BASE_URL}`);

  const userContent = images.length > 0
    ? [{ type: "text", text: user }, ...images.map(d => ({ type: "image_url", image_url: { url: d, detail: "default" } }))]
    : user;

  const body = {
    model: actualModel,
    thinking: { type: "disabled" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (format) body.response_format = { type: format };

  const res = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.log(`[minimax] callLLM: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    throw new Error(`MiniMax API 错误 (${res.status}): ${data.error?.message || "未知错误"}`);
  }
  const msg = data.choices?.[0]?.message || {};
  console.log(`[minimax] usage: ${JSON.stringify(data.usage)}`);
  return {
    text: msg.content || "",
    usage: {
      totalTokens: data.usage?.totalTokens || data.usage?.total_tokens || 0,
      completionTokens: data.usage?.completionTokens || data.usage?.completion_tokens || 0,
    },
  };
}

export async function generateImage(prompt, { aspectRatio = "1:1", model = MINIMAX_IMAGE_MODEL, image_url } = {}) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("未配置 MINIMAX_API_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const body = {
    model,
    prompt,
    aspect_ratio: aspectRatio,
    n: 1,
    prompt_optimizer: true,
    response_format: "url",
  };
  if (image_url) {
    body.subject_reference = [{ type: "character", image_file: image_url }];
  }

  const res = await fetch(`${MINIMAX_BASE_URL}/image_generation`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  clearTimeout(timeout);

  const result = await res.json();
  if (result.base_resp?.status_code !== 0) {
    throw new Error(result.base_resp?.status_msg || "图片生成失败");
  }

  const url = result.data?.image_urls?.[0];
  if (!url) throw new Error("未获取到图片 URL");

  return url;
}