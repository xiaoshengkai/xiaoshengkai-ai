import { callLLM as callDeepSeek } from "./providers/deepseek.js";
import { callLLM as callMiniMax } from "./providers/minimax.js";

const PROVIDER = process.env.LLM_PROVIDER || "deepseek";

export { PROVIDER };

export async function callLLM(params) {
  if (PROVIDER === "minimax") return callMiniMax(params);
  return callDeepSeek(params);
}