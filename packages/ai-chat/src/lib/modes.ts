export type ChatMode = "chat" | "plan" | "build";

// 仅 build 模式暴露的写工具（文件写/exec/知识库写）
export const WRITE_TOOLS = new Set([
  "exec",
  "writeFile",
  "appendFile",
  "replaceInFile",
  "createDirectory",
  "deleteFile",
  "moveFile",
  "addKnowledge",
  "updateKnowledge",
  "deleteKnowledge",
  "restoreKnowledgeById",
]);

export function filterToolsByMode(tools: Record<string, unknown>, mode: ChatMode): Record<string, unknown> {
  if (mode === "build") return tools;
  const filtered: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!WRITE_TOOLS.has(name)) filtered[name] = tool;
  }
  return filtered;
}
