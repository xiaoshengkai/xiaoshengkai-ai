import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
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

// ponytail: M3 → Anthropic 协议（MINIMAX_ANTHROPIC_BASE_URL）
// thinking 是原生 content block (type: "thinking")，AI SDK @ai-sdk/anthropic 原生支持
// M3 默认关闭 thinking，需 { type: 'adaptive' } 开启
// TODO: M3 Anthropic 端点支持 type="video"（文档已确认），但 @ai-sdk/anthropic provider
// 在 convertToModelMessages 阶段就拒了。等 provider 升级后可以通过 fetch 拦截器还原。
// 当前视频走 preprocess 路径（m3ChatComplete → text 描述）。
export const minimax = createAnthropic({
  baseURL: env.MINIMAX_ANTHROPIC_BASE_URL,
  apiKey: env.MINIMAX_API_KEY,
});