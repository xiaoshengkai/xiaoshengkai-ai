import type { ChatStrategy } from "./types";
import type { ProviderConfig } from "@/lib/settings/dispatcher";
import { getProviderConfig } from "@/lib/settings/dispatcher";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { injectReasoningSplit } from "@/lib/core/fetch-interceptors";

// ponytail: M3 走 OpenAI 兼容协议（2026-08-19），Anthropic provider 已移除
export const createMiniMaxStrategy = (): ChatStrategy => ({
  async resolveModel() {
    const cfg = getProviderConfig("chat");
    return { model: cfg.model };
  },
  getProviderName() { return "minimax"; },
  createModel(model: string, cfg: ProviderConfig) {
    return createOpenAICompatible({
      name: "minimax",
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      fetch: injectReasoningSplit(fetch),
    })(model);
  },
});