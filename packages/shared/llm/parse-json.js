/**
 * JSON 解析 — 从 LLM 输出中提取 JSON（去 markdown 标记 + 括号匹配）
 * 之前散落在 xiaohongshu / diagram / ai / prompt-builder 里
 */

export function parseJSON(text) {
  const cleaned = text.replace(/```\w*\n?|\n?```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("未找到 JSON");
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)); }
  }
  throw new Error("JSON 未闭合");
}