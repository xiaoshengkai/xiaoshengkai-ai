import { callLLM } from "../../../shared/llm.js";

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

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }

  const mdMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (mdMatch) {
    const inner = mdMatch[1].match(/\{[\s\S]*\}/);
    if (inner) {
      try { return JSON.parse(inner[0]); } catch {}
    }
  }

  return { output: text };
}