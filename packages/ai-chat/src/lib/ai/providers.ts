import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "../utils/env"

export const glm = createOpenAICompatible({
  name: "glm",
  baseURL: env.GLM_BASE_URL,
  apiKey: env.GLM_API_KEY,
});

export const deepseek = createOpenAICompatible({
  name: "deepseek",
  baseURL: env.DEEPSEEK_BASE_URL,
  apiKey: env.DEEPSEEK_API_KEY,
});

// ponytail: 朴素 createOpenAICompatible，不注入任何自定义字段。
// 图片/视频走 preprocess 路径（M3 先看 → text 描述 → 喂给 M3），
// M3 只看到 text，AI SDK 标准路径 100% 兼容。
// preprocess 路径内部用 m3ChatComplete 调 M3，直接解析 reasoning_split=true 的响应。
export const minimax = createOpenAICompatible({
  name: "minimax",
  baseURL: env.MINIMAX_BASE_URL,
  apiKey: env.MINIMAX_API_KEY,
});