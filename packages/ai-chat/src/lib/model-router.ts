import { generateText } from "ai";
import { deepseek } from "@/lib/providers";

export type ModelTier = "flash" | "pro";

export interface ClassifyResult {
  tier: ModelTier;
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

export async function classifyTask(query: string): Promise<ClassifyResult> {
  try {
    const { text, finishReason, usage } = await generateText({
      model: deepseek(process.env.DEEPSEEK_FLASH_MODEL || "deepseek-v4-flash"),
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