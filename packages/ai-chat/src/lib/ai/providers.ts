import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getProviderConfig } from "@/lib/settings/dispatcher";
import { env } from "@/lib/utils/env";
import type { Module } from "@/lib/settings/types";

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

export const minimax = createAnthropic({
  baseURL: env.MINIMAX_ANTHROPIC_BASE_URL,
  apiKey: env.MINIMAX_API_KEY,
});

export function getModel(module: Module) {
  const cfg = getProviderConfig(module);
  if (cfg.protocol === "anthropic") {
    const p = createAnthropic({ baseURL: cfg.baseURL, apiKey: cfg.apiKey });
    return p(cfg.model);
  }
  const p = createOpenAICompatible({ name: module, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  return p(cfg.model);
}