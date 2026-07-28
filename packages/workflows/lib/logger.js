import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, "..", "..", "..", "logs", "workflows");

fs.mkdirSync(LOG_DIR, { recursive: true });

export function createWorkflowLogger(executionId) {
  const logFile = path.join(LOG_DIR, `${executionId}.log`);

  function writeln(level, args) {
    const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] [${level}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
    fs.appendFileSync(logFile, line);
  }

  return {
    info: (...args) => writeln("INFO", args),
    error: (...args) => writeln("ERR", args),
    warn: (...args) => writeln("WARN", args),
  };
}