import "./lib/env.js";
// 日志必须最先初始化：工具模块在顶层 console.log，需在它们被 import 前拦截 stdout
import "./lib/logger-setup.js";

// ─── 进程级死因兜底：子进程异常/被杀时留下证据 ───
process.on("uncaughtException", (err) => {
  console.error(`[mcp] uncaughtException: ${err?.stack || err}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error(`[mcp] unhandledRejection: ${reason?.stack || reason}`);
  process.exit(1);
});
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.error(`[mcp] 收到 ${sig}，退出`);
    process.exit(0);
  });
}
process.on("exit", (code) => {
  console.error(`[mcp] 进程退出 code=${code}`);
});

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

// 中心面包屑：每个工具调用记录工具名（模型名由工具内 provider 日志输出）
const origTool = server.tool.bind(server);
server.tool = (name, description, schema, handler) =>
  origTool(name, description, schema, async (args, extra) => {
    console.log(`[mcp] ▶ 调用工具: ${name}`);
    const t0 = Date.now();
    try {
      return await handler(args, extra);
    } finally {
      console.log(`[mcp] ■ 工具完成: ${name} 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  });

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