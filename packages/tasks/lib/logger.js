import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, "..", "..", "..", "logs", "tasks");

fs.mkdirSync(LOG_DIR, { recursive: true });

export function createTaskLogger(taskName) {
  const logFile = path.join(LOG_DIR, `${taskName}.log`);

  function writeLog(level, args) {
    const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] [${level}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
    const old = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf-8") : "";
    fs.writeFileSync(logFile, line + old);
  }

  return {
    log: (...args) => writeLog("LOG", args),
    error: (...args) => writeLog("ERR", args),
    info: (...args) => writeLog("INFO", args),
    warn: (...args) => writeLog("WARN", args),
  };
}