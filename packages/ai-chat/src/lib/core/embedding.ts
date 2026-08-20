import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getProviderConfig } from "@/lib/settings/dispatcher";

/** ponytail: vector module → embedding（仅 GLM 支持，其他 provider 抛错 2026-08-19） */
export function getEmbeddingModel() {
  const cfg = getProviderConfig("vector");
  if (cfg.provider !== "glm") {
    throw new Error(
      `Embedding 仅支持 GLM provider，当前 vector 配置: ${cfg.provider}/${cfg.model}。请到 settings 切换到 glm。`,
    );
  }
  return createOpenAICompatible({
    name: cfg.provider,
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
  }).embeddingModel(cfg.model);
}