import type { ChatStrategy } from "./types";
import type { ProviderConfig } from "@/lib/settings/dispatcher";
import { getProviderConfig } from "@/lib/settings/dispatcher";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const createGlmStrategy = (): ChatStrategy => ({
  async resolveModel() {
    const cfg = getProviderConfig("chat");
    return { model: cfg.model };
  },
  getProviderName() { return "glm"; },
  createModel(model: string, cfg: ProviderConfig) {
    return createOpenAICompatible({ name: "glm", baseURL: cfg.baseURL, apiKey: cfg.apiKey })(model);
  },
});