import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getProviderConfig } from "@/lib/settings/dispatcher";

/** ponytail: tier 概念归属 workflow-model（2026-08-19），pro=重模型 flash=轻模型 */
export type ModelTier = "pro" | "flash";

/** ponytail: workflow module → 后台 chat 任务，支持 pro/flash 分级（2026-08-19） */
export function getWorkflowModel(tier: ModelTier = "pro") {
  const cfg = getProviderConfig("workflow");
  const modelName = tier === "flash" && cfg.flashModel ? cfg.flashModel : cfg.model;
  return createOpenAICompatible({
    name: cfg.provider,
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
  })(modelName);
}