import "./lib/env.js";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@app/shared/logger.js";

// ─── 日志系统 ───
createLogger("MCP", path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "logs", "app"));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { register as registerSearch } from "./tools/search/index.js";
// import { register as registerTodo } from "./tools/todo/index.js";
import { register as registerFile } from "./tools/file/index.js";
import { register as registerChroma } from "./tools/chroma/index.js";
import { register as registerSkill } from "./tools/skill/index.js";
import { register as registerExec } from "./tools/exec/index.js";
import { register as registerMedia } from "./tools/media/index.js";
import { register as registerDiagram } from "./tools/diagram/index.js";
import { register as registerXiaohongshu } from "./tools/xiaohongshu/index.js";
import { register as registerDocument, checkPandoc } from "./tools/document/index.js";

console.log(`[mcp] server-id: ${Date.now().toString(36)}`);

// 启动期探测 pandoc（非阻塞，缺失不阻塞 server）
checkPandoc().then((v) => {
  console.log(`[mcp] pandoc: ${v || "未安装（首次 docx 转换时会自动 brew install）"}`);
}).catch(() => {
  console.log("[mcp] pandoc: 探测异常");
});

const server = new McpServer({ name: "node-mcp", version: "2.0.0" });

const modules = [
  { name: "skill", register: registerSkill },
  { name: "exec", register: registerExec },
  { name: "search", register: registerSearch },
  // { name: "todo", register: registerTodo },
  { name: "file", register: registerFile },
  { name: "chroma", register: registerChroma },
  { name: "media", register: registerMedia },
  { name: "diagram", register: registerDiagram },
  { name: "xiaohongshu", register: registerXiaohongshu },
  { name: "document", register: registerDocument },
];

let totalTools = 0;

for (const { name, register } of modules) {
  try {
    const before = Object.keys(server._registeredTools || {}).length;
    register(server);
    const after = Object.keys(server._registeredTools || {}).length;
    const count = after - before;
    totalTools += count;
    console.log(`[mcp] ${name}: loaded (${count} tools)`);
  } catch (err) {
    console.error(`[mcp] ${name}: FAILED - ${err.message}`);
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);

console.log(`[mcp] node-mcp 已启动 (v2.0.0 - ${totalTools} tools)`);