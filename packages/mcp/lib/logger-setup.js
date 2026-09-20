import path from "node:path";
import { createLogger } from "@app/shared/logger.js";

// 必须在所有工具模块之前 import：工具模块在顶层就 console.log，
// 而 stdout 是 MCP 的 JSON-RPC 通道，早期不拦截会污染协议。
// stdout=false：日志只写文件，不回显 stdout。
createLogger(
  "MCP",
  path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "logs", "app"),
  { stdout: false },
);