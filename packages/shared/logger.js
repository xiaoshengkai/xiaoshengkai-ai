import fs from "node:fs";
import path from "node:path";

const MAX_DAYS = 7;

// 本地时区日期（与内容时间戳 toLocaleString 一致）。
// 弃用 toISOString().slice(0,10)：那是 UTC，CST 凌晨 0-8 点会错一天。
function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 清理超过 MAX_DAYS 的日志文件
function cleanOldLogs(logDir, prefix) {
  try {
    const cutoff = Date.now() - MAX_DAYS * 86400000;
    const files = fs.readdirSync(logDir).filter(f => f.startsWith(prefix) && f.endsWith(".log"));
    for (const f of files) {
      const dateStr = f.match(/\d{4}-\d{2}-\d{2}/)?.[0];
      if (dateStr && new Date(dateStr).getTime() < cutoff) {
        fs.unlinkSync(path.join(logDir, f));
      }
    }
  } catch { /* ignore */ }
}

export function createLogger(source, logDir, opts = {}) {
  // stdout=false：不回显到 stdout。MCP 的 stdout 是 JSON-RPC 通道，禁止被日志污染
  const { stdout = true } = opts;
  fs.mkdirSync(logDir, { recursive: true });
  const safeSource = String(source || "app");
  let lastCleanDate = localDateString();
  cleanOldLogs(logDir, "app-");

  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  const origInfo = console.info;

  function writeLog(level, args) {
    // 每次写日志动态算「今天」的文件名：跨天自动切文件（不再用启动时固化的常量）
    const today = localDateString();
    if (today !== lastCleanDate) {
      lastCleanDate = today;
      cleanOldLogs(logDir, "app-");
    }
    const file = path.join(logDir, `app-${today}.log`);
    const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] [${safeSource}] [${level}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
    // 追加写（时间正序）：多进程共享同一文件时唯一安全的方式，读改写会互相覆盖
    fs.appendFileSync(file, line);
  }

  console.log = (...args) => { if (stdout) origLog(...args); writeLog("LOG", args); };
  console.info = (...args) => { if (stdout) origInfo(...args); writeLog("INFO", args); };
  // console.error/warn 本就走 stderr，不受 stdout 开关影响
  console.error = (...args) => { origErr(...args); writeLog("ERR", args); };
  console.warn = (...args) => { origWarn(...args); writeLog("WARN", args); };
}

export function createDateLogger(source, logDir, itemName) {
  const absLogDir = path.resolve(logDir);
  fs.mkdirSync(absLogDir, { recursive: true });
  const safeSource = String(source || "app").replace(/[/\\:*?"<>|\s]/g, "_");
  const safeItemName = String(itemName || "main").replace(/[/\\:*?"<>|\s]/g, "_");
  let lastCleanDate = localDateString();
  cleanOldLogs(absLogDir, `${safeSource}-`);

  // 倒序缓存：最新在前，跨天切文件时才读一次磁盘
  let buffer = "";
  let bufferFile = "";

  function writeln(level, args) {
    // 动态算「今天」文件名，跨天自动切
    const today = localDateString();
    if (today !== lastCleanDate) {
      lastCleanDate = today;
      cleanOldLogs(absLogDir, `${safeSource}-`);
    }
    const file = path.join(absLogDir, `${safeSource}-${today}.log`);
    if (bufferFile !== file) {
      bufferFile = file;
      buffer = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
    }
    const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] [${safeSource}] [${safeItemName}] [${level}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
    buffer = line + buffer;
    fs.writeFileSync(file, buffer);
  }

  return {
    log: (...args) => writeln("LOG", args),
    info: (...args) => writeln("INFO", args),
    error: (...args) => writeln("ERR", args),
    warn: (...args) => writeln("WARN", args),
  };
}
