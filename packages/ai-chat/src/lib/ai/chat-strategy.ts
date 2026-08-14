import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { classifyTask } from "@/lib/ai/model-router";
import { getProviderConfig } from "@/lib/settings/dispatcher";
import type { ProviderConfig } from "@/lib/settings/dispatcher";
import { env } from "@/lib/utils/env";

export interface ChatStrategy {
  resolveModel(userText: string): Promise<{ model: string; classifyUsage?: { inputTokens: number; outputTokens: number; totalTokens: number } }>;
  getProviderName(): string;
  createModel(model: string, cfg: ProviderConfig): LanguageModel;
}

class MiniMaxStrategy implements ChatStrategy {
  async resolveModel() {
    const cfg = getProviderConfig("chat");
    return { model: cfg.model };
  }
  getProviderName() { return "minimax"; }
  createModel(model: string, cfg: ProviderConfig) {
    return createAnthropic({ baseURL: cfg.baseURL, apiKey: cfg.apiKey })(model);
  }
}

class DeepSeekStrategy implements ChatStrategy {
  async resolveModel(userText: string) {
    const classify = await classifyTask(userText);
    const model = classify.tier === "pro" ? env.DEEPSEEK_PRO_MODEL : env.DEEPSEEK_FLASH_MODEL;
    return { model, classifyUsage: classify.usage };
  }
  getProviderName() { return "deepseek"; }
  createModel(model: string, cfg: ProviderConfig) {
    return createOpenAICompatible({ name: "deepseek", baseURL: cfg.baseURL, apiKey: cfg.apiKey })(model);
  }
}

class GLMStrategy implements ChatStrategy {
  async resolveModel() {
    const cfg = getProviderConfig("chat");
    return { model: cfg.model };
  }
  getProviderName() { return "glm"; }
  createModel(model: string, cfg: ProviderConfig) {
    return createOpenAICompatible({ name: "glm", baseURL: cfg.baseURL, apiKey: cfg.apiKey })(model);
  }
}

const STRATEGIES: Record<string, ChatStrategy> = {
  minimax: new MiniMaxStrategy(),
  deepseek: new DeepSeekStrategy(),
  glm: new GLMStrategy(),
};

export function getChatStrategy(): ChatStrategy {
  const cfg = getProviderConfig("chat");
  if (cfg.model.startsWith("deepseek")) return STRATEGIES.deepseek;
  if (cfg.model.startsWith("glm")) return STRATEGIES.glm;
  if (cfg.protocol === "anthropic") return STRATEGIES.minimax;
  return STRATEGIES.deepseek;
}