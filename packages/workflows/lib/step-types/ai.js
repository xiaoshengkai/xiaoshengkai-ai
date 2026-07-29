import { callLLM } from "../../../shared/llm/index.js";

function parseJSON(text) {
  let cleaned = text.replace(/```\w*\n?|\n?```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("未找到 JSON");

  let depth = 0, inString = false, escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"' && !inString) { inString = true; continue; }
    if (ch === '"' && inString) { inString = false; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)); }
  }
  throw new Error("JSON 未闭合");
}

export async function execAiStep(step, vars, executionDir) {
  let prompt = step.prompt;
  for (const [key, value] of Object.entries(vars)) {
    if (value != null) {
      prompt = prompt.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
    }
  }

  const { text } = await callLLM({
    system: prompt,
    user: step.user || "",
  });

  try {
    return parseJSON(text);
  } catch (err) {
    console.warn(`[ai] JSON 解析失败: ${err.message}`, "原文前200字:", text.slice(0, 200));
    return { output: text };
  }
}