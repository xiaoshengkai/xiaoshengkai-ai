/**
 * 候选聚类（LLM 契约重试环）：discovery 首轮与「重新识别」redirect 轮共用。
 */
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { buildClusterPrompt, validateClusterOutput } from "./prompts.js";

export async function clusterSources(profile, promptSources) {
  let parsed = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 5 && !parsed; attempt++) {
    const { system, user } = buildClusterPrompt(profile, promptSources);
    const finalUser = lastErr ? `${user}\n\n上次输出无法解析（${lastErr}），请严格只输出 JSON。` : user;
    const { text } = await callLLM({ system, user: finalUser });
    try {
      parsed = parseJSON(text);
    } catch (err) {
      lastErr = err.message;
    }
  }
  if (!parsed) throw new Error(`候选聚类失败: LLM 输出连续 5 次无法解析为 JSON（${lastErr}）`);
  return validateClusterOutput(parsed, promptSources);
}
