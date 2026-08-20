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
  // ponytail: 用 cfg.provider 识别 strategy（2026-08-20），不再解析 model 前缀（qwen3.8-max 前缀拆分会错配）
  return FACTORIES[cfg.provider]?.() ?? FACTORIES.minimax();
}

export type { ChatStrategy } from "./types";