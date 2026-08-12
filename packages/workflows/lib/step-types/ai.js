import { callLLM } from "../../../shared/llm/index.js";
import { parseJSON } from "../../../shared/llm/parse-json.js";

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