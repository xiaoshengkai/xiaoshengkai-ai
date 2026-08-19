import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getApiKey } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_PATH = path.resolve(__dirname, "..", "..", "..", "..", "data", "settings", "providers.json");

let DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
let DEEPSEEK_PRO_MODEL = process.env.DEEPSEEK_PRO_MODEL || 'deepseek-v4-pro';

try {
  if (fs.existsSync(PROVIDERS_PATH)) {
    const p = JSON.parse(fs.readFileSync(PROVIDERS_PATH, "utf-8"));
    if (p.deepseek?.baseURL) DEEPSEEK_BASE_URL = p.deepseek.baseURL;
    if (p.deepseek?.models?.chat) DEEPSEEK_PRO_MODEL = p.deepseek.models.chat;
  }
} catch { /* fallback to env */ }

export async function callLLM({ system, user, model, temperature = 0.7, maxTokens = 8000, format = 'json_object', images = [] }) {
  const apiKey = getApiKey("deepseek", "DEEPSEEK_API_KEY");
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY');

  const actualModel = model || DEEPSEEK_PRO_MODEL;
  console.log(`[deepseek] 当前调用: model=${actualModel} baseURL=${DEEPSEEK_BASE_URL}`);

  if (images.length > 0) {
    console.warn(`[deepseek] 用户上传了 ${images.length} 张参考图,DeepSeek 不支持视觉,仅基于文字反馈推理`);
    user = `[用户上传了 ${images.length} 张参考图,DeepSeek 不支持视觉,请基于以下文字反馈和已有 script 推理]\n${user}`;
  }

  const body = {
    model: actualModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (format) body.response_format = { type: format };

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.log(`[deepseek] callLLM: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    throw new Error(`DeepSeek API 错误 (${res.status})`);
  }
  console.log(`[deepseek] usage: ${JSON.stringify(data.usage)}`);
  return {
    text: data.choices?.[0]?.message?.content || '',
    usage: {
      totalTokens: data.usage?.totalTokens || data.usage?.total_tokens || 0,
      completionTokens: data.usage?.completionTokens || data.usage?.completion_tokens || 0,
    },
  };
}
