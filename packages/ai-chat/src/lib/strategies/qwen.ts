import type { ChatStrategy } from "./types";
import type { ProviderConfig } from "@/lib/settings/dispatcher";
import { getProviderConfig } from "@/lib/settings/dispatcher";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { injectEnableThinking } from "@/lib/core/fetch-interceptors";

export const createQwenStrategy = (): ChatStrategy => ({
  async resolveModel() {
    const cfg = getProviderConfig("chat");
    return { model: cfg.model };
  },
  getProviderName() { return "qwen"; },
  createModel(model: string, cfg: ProviderConfig) {
    return createOpenAICompatible({
      name: "qwen",
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      fetch: injectEnableThinking(fetch),
    })(model);
  },
});