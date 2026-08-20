import type { LanguageModel } from "ai";
import type { ProviderConfig } from "@/lib/settings/dispatcher";

export interface ChatStrategy {
  resolveModel(userText: string): Promise<{ model: string; classifyUsage?: { inputTokens: number; outputTokens: number; totalTokens: number } }>;
  getProviderName(): string;
  createModel(model: string, cfg: ProviderConfig): LanguageModel;
}