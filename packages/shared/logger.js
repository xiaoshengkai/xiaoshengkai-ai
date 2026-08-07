import fs from "node:fs";
import path from "node:path";

export function createLogger(source, logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const LOG_FILE = path.join(logDir, `app-${new Date().toISOString().slice(0, 10)}.log`);

  const MAX_DAYS = 7;
  const files = fs.readdirSync(logDir).filter(f => f.endsWith(".log"));
  for (const f of files) {
    const dateStr = f.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (dateStr && Date.now() - new Date(dateStr).getTime() > MAX_DAYS * 86400000) {
      fs.unlinkSync(path.join(logDir, f));
    }
  }

  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  const origInfo = console.info;

  function writeLog(level, args) {
    const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] [${source}] [${level}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
    const old = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf-8") : "";
    fs.writeFileSync(LOG_FILE, line + old);
  }

  console.log = (...args) => { origLog(...args); writeLog("LOG", args); };
  console.error = (...args) => { origErr(...args); writeLog("ERR", args); };
  console.warn = (...args) => { origWarn(...args); writeLog("WARN", args); };
  console.info = (...args) => { origInfo(...args); writeLog("INFO", args); };
}

export function createItemLogger(logDir, itemName) {
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${itemName}.log`);

  function writeln(level, args) {
    const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] [${level}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
    const old = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf-8") : "";
    fs.writeFileSync(logFile, line + old);
  }

  return {
    log: (...args) => writeln("LOG", args),
    info: (...args) => writeln("INFO", args),
    error: (...args) => writeln("ERR", args),
    warn: (...args) => writeln("WARN", args),
  };
}

export function createDateLogger(source, logDir, itemName) {
  const absLogDir = path.resolve(logDir);
  fs.mkdirSync(absLogDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const safeSource = String(source || "app").replace(/[/\\:*?"<>|\s]/g, "_");
  const safeItemName = String(itemName || "main").replace(/[/\\:*?"<>|\s]/g, "_");
  const LOG_FILE = path.join(absLogDir, `${safeSource}-${today}.log`);

  const MAX_DAYS = 7;
  try {
    const files = fs.readdirSync(absLogDir).filter(f => f.startsWith(`${safeSource}-`) && f.endsWith(".log"));
    for (const f of files) {
      const dateStr = f.match(/\d{4}-\d{2}-\d{2}/)?.[0];
      if (dateStr && Date.now() - new Date(dateStr).getTime() > MAX_DAYS * 86400000) {
        fs.unlinkSync(path.join(absLogDir, f));
      }
    }
  } catch { /* ignore */ }

  function writeln(level, args) {
    const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] [${safeSource}] [${safeItemName}] [${level}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
    let old = "";
    try { old = fs.readFileSync(LOG_FILE, "utf-8"); } catch { /* ignore */ }
    fs.writeFileSync(LOG_FILE, line + old);
  }

  return {
    log: (...args) => writeln("LOG", args),
    info: (...args) => writeln("INFO", args),
    error: (...args) => writeln("ERR", args),
    warn: (...args) => writeln("WARN", args),
  };
}