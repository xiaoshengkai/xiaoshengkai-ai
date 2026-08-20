import { generateText } from "ai";
import type { ChatStrategy } from "./types";
import type { ProviderConfig } from "@/lib/settings/dispatcher";
import { getProviderConfig } from "@/lib/settings/dispatcher";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// ponytail: DeepSeek 自动路由的 flash 档固定（分类 + 轻任务），pro 档读 chat 选择
const DEEPSEEK_FLASH = "deepseek-v4-flash";

export interface ClassifyResult {
  tier: "pro" | "flash";
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

const CLASSIFY_INSTRUCTIONS = `Classify as "light" or "heavy". Reply with ONLY ONE WORD.

HEAVY tasks:
- Write, debug, refactor, or explain code
- Use tools: generate image, search knowledge, manage files/todos
- Math, logic, multi-step reasoning, comparisons, analysis
- Creative: poems, stories, long-form content
- Commands: "remember X", "draw X", "generate X", "create X"

LIGHT tasks:
- Greetings, small talk, casual chat
- Simple facts: "what is X", "when was X", "who is X"
- Translations, basic Q&A with no reasoning needed

Examples:
"Hello" → light
"Write a quick sort in Java" → heavy
"Draw a flowchart of user login" → heavy
"Remember Java Stream is lazy" → heavy
"2+2=?" → light
"Difference between HashMap and TreeMap" → heavy
"What is Python?" → light
"Debug this NullPointerException" → heavy`;

// ponytail: classifyTask 是 DeepSeek 专属（仅 DeepSeek 有 pro/flash 两档），2026-08-19 从 router/task-router.ts 移入
// ponytail: 分类用 deepseek flash（轻模型）跑，读 chat 配置的 baseURL/key（2026-08-20，不再用 workflow 避免被其配额拖累）
async function classifyTask(query: string): Promise<ClassifyResult> {
  try {
    const cfg = getProviderConfig("chat");
    const flashModel = createOpenAICompatible({ name: "deepseek", baseURL: cfg.baseURL, apiKey: cfg.apiKey })(DEEPSEEK_FLASH);
    const { text, finishReason, usage } = await generateText({
      model: flashModel,
      maxOutputTokens: 200,
      prompt: `${CLASSIFY_INSTRUCTIONS}

Task: "${query}"

Classification:`,
    });
    console.log(`[router:raw] text="${text}" finishReason="${finishReason}" usage=${JSON.stringify(usage)}`);
    const raw = text.trim();
    const isHeavy = /^heavy/i.test(raw);
    console.log(`[router] "${query.slice(0, 50)}" → "${raw}" → ${isHeavy ? "pro" : "flash"}`);
    return {
      tier: isHeavy ? "pro" : "flash",
      usage: {
        totalTokens: usage.totalTokens ?? 0,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      },
    };
  } catch (err) {
    console.error(`[router] classify failed, fallback to pro:`, (err as Error).message);
    return { tier: "pro", usage: { totalTokens: 0, inputTokens: 0, outputTokens: 0 } };
  }
}

export const createDeepSeekStrategy = (): ChatStrategy => ({
  async resolveModel(userText: string) {
    const classify = await classifyTask(userText);
    // ponytail: pro 档读 chat 选择（settings 可改），flash 档固定（分类 + 轻任务）
    const cfg = getProviderConfig("chat");
    const model = classify.tier === "pro" ? cfg.model : DEEPSEEK_FLASH;
    return { model, classifyUsage: classify.usage };
  },
  getProviderName() { return "deepseek"; },
  createModel(model: string, cfg: ProviderConfig) {
    return createOpenAICompatible({ name: "deepseek", baseURL: cfg.baseURL, apiKey: cfg.apiKey })(model);
  },
});