import "./lib/env.js";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../shared/logger.js";

// ─── 日志系统 ───
createLogger("MCP", path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "logs", "app"));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { register as registerFetch } from "./tools/fetch/index.js";
// import { register as registerTodo } from "./tools/todo/index.js";
import { register as registerFile } from "./tools/file/index.js";
import { register as registerChroma } from "./tools/chroma/index.js";
import { register as registerSkill } from "./tools/skill/index.js";
import { register as registerExec } from "./tools/exec/index.js";
import { register as registerMedia } from "./tools/media/index.js";
import { register as registerDiagram } from "./tools/diagram/index.js";
import { register as registerXiaohongshu } from "./tools/xiaohongshu/index.js";

console.log(`[mcp] server-id: ${Date.now().toString(36)}`);

const server = new McpServer({ name: "node-mcp", version: "2.0.0" });

const modules = [
  { name: "skill", register: registerSkill },
  { name: "exec", register: registerExec },
  { name: "fetch", register: registerFetch },
  // { name: "todo", register: registerTodo },
  { name: "file", register: registerFile },
  { name: "chroma", register: registerChroma },
  { name: "media", register: registerMedia },
  { name: "diagram", register: registerDiagram },
  { name: "xiaohongshu", register: registerXiaohongshu },
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