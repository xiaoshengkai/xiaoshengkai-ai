import "./lib/env.js";
import fs from "node:fs";
import path from "node:path";

// ─── 日志系统：重定向 console 到文件 + 终端 ───
const LOG_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, `mcp-${new Date().toISOString().slice(0, 10)}.log`);

// 清理 7 天前的日志
const MAX_DAYS = 7;
const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith(".log"));
for (const f of files) {
  const dateStr = f.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (dateStr && Date.now() - new Date(dateStr).getTime() > MAX_DAYS * 86400000) {
    fs.unlinkSync(path.join(LOG_DIR, f));
  }
}

const origLog = console.log;
const origErr = console.error;
const origWarn = console.warn;

function writeLog(level, args) {
  const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] [${level}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
  const old = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf-8") : "";
  fs.writeFileSync(LOG_FILE, line + old);
}

console.log = (...args) => { origLog(...args); writeLog("LOG", args); };
console.error = (...args) => { origErr(...args); writeLog("ERR", args); };
console.warn = (...args) => { origWarn(...args); writeLog("WARN", args); };

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { register as registerFetch } from "./tools/fetch/index.js";
import { register as registerTodo } from "./tools/todo/index.js";
import { register as registerFile } from "./tools/file/index.js";
import { register as registerChroma } from "./tools/chroma/index.js";
import { register as registerSkill } from "./tools/skill/index.js";
import { register as registerExec } from "./tools/exec/index.js";
import { register as registerMedia } from "./tools/media/index.js";
import { register as registerDiagram } from "./tools/diagram/index.js";

console.error(`[mcp] server-id: ${Date.now().toString(36)}`);

const server = new McpServer({ name: "node-mcp", version: "2.0.0" });

const modules = [
  { name: "skill", register: registerSkill },
  { name: "exec", register: registerExec },
  { name: "fetch", register: registerFetch },
  { name: "todo", register: registerTodo },
  { name: "file", register: registerFile },
  { name: "chroma", register: registerChroma },
  { name: "media", register: registerMedia },
  { name: "diagram", register: registerDiagram },
];

let totalTools = 0;

for (const { name, register } of modules) {
  try {
    const before = Object.keys(server._registeredTools || {}).length;
    register(server);
    const after = Object.keys(server._registeredTools || {}).length;
    const count = after - before;
    totalTools += count;
    console.error(`[mcp] ${name}: loaded (${count} tools)`);
  } catch (err) {
    console.error(`[mcp] ${name}: FAILED - ${err.message}`);
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`[mcp] node-mcp 已启动 (v2.0.0 - ${totalTools} tools)`);