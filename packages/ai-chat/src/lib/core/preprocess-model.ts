import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getProviderConfig } from "@/lib/settings/dispatcher";

/** ponytail: preprocess module → 多模态描述（M3 专用，2026-08-19） */
export function getPreprocessModel() {
  const cfg = getProviderConfig("preprocess");
  return createOpenAICompatible({
    name: cfg.provider,
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
  })(cfg.model);
}