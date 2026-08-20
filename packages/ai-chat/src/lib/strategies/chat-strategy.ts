import type { ChatStrategy } from "./types";
import { getProviderConfig } from "@/lib/settings/dispatcher";
import { createDeepSeekStrategy } from "./deepseek";
import { createMiniMaxStrategy } from "./minimax";
import { createGlmStrategy } from "./glm";
import { createQwenStrategy } from "./qwen";

type StrategyFactory = () => ChatStrategy;

const FACTORIES: Record<string, StrategyFactory> = {
  deepseek: createDeepSeekStrategy,
  glm: createGlmStrategy,
  qwen: createQwenStrategy,
  minimax: createMiniMaxStrategy,
};

export function getChatStrategy(): ChatStrategy {
  const cfg = getProviderConfig("chat");
  // ponytail: M3 已切到 OpenAI 兼容协议（2026-08-19），按 model 前缀识别而非 anthropic 协议
  const prefix = cfg.model.split(/[-:]/)[0].toLowerCase();
  return FACTORIES[prefix]?.() ?? FACTORIES.minimax();
}

export type { ChatStrategy } from "./types";