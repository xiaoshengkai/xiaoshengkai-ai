import { callLLM as callDeepSeek } from "./deepseek.js";
import { callLLM as callMiniMax } from "./minimax.js";

const PROVIDER = process.env.MCP_LLM_PROVIDER || "deepseek";

export { PROVIDER };

export async function callLLM(params) {
  if (PROVIDER === "minimax") return callMiniMax(params);
  return callDeepSeek(params);
}