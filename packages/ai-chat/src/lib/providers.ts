import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const glm = createOpenAICompatible({
  name: "glm",
  baseURL: process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
  apiKey: process.env.GLM_API_KEY,
});

export const deepseek = createOpenAICompatible({
  name: "aether",
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

export const minimax = createOpenAICompatible({
  name: "minimax",
  baseURL: process.env.MINIMAX_BASE_URL || "https://api.minimax.chat/v1",
  apiKey: process.env.MINIMAX_API_KEY,
});