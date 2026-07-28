import { callLLM } from "../../../mcp/lib/llm.js";

export async function execAiStep(step, vars, executionDir) {
  let prompt = step.prompt;
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
  }

  const { text } = await callLLM({
    system: prompt,
    user: step.user || "",
  });

  // 尝试解析 JSON 输出
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
  }

  return { output: text };
}