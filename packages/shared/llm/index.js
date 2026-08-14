import { callLLM as callDeepSeek } from "./providers/deepseek.js";
import { callLLM as callMiniMax } from "./providers/minimax.js";
import { callLLM as callGLM } from "./providers/glm.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = path.resolve(__dirname, "..", "..", "data", "settings", "selection.json");

let PROVIDER = process.env.LLM_PROVIDER || "deepseek";
try {
  if (fs.existsSync(SETTINGS_PATH)) {
    const sel = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    if (sel.workflow?.provider) {
      PROVIDER = sel.workflow.provider;
    }
  }
} catch { /* fallback to env */ }

export { PROVIDER };

const CALLERS = {
  minimax: callMiniMax,
  deepseek: callDeepSeek,
  glm: callGLM,
};

export async function callLLM(params) {
  const caller = CALLERS[PROVIDER] || callDeepSeek;
  return caller(params);
}