/**
 * Next.js 16 instrumentation 入口
 * ============================================================================
 *
 * Next.js 在服务器启动时会调用本文件的 `register()`(每个 Node 进程一次)。
 * 在这里拉起 Chroma,确保后续所有请求都能直接拿到 :8000 可用服务。
 *
 * Edge runtime 不需要 Chroma,因此守卫 `NEXT_RUNTIME === "nodejs"`。
 *
 * 关于 Next.js 16:
 *   - 不需要在 next.config.ts 显式开启 instrumentationHook(15+ 已默认开启)
 *   - 仅在 Node 运行时执行,Edge/浏览器构建会被跳过
 * ============================================================================
 */

import fs from "node:fs";
import path from "node:path";

// ─── 日志系统：重定向 console 到文件 + 终端 ───
const LOG_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, `nextjs-${new Date().toISOString().slice(0, 10)}.log`);

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

function writeLog(level: string, args: unknown[]) {
  const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] [${level}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
  const old = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf-8") : "";
  fs.writeFileSync(LOG_FILE, line + old);
}

console.log = (...args: unknown[]) => { origLog(...args); writeLog("LOG", args); };
console.error = (...args: unknown[]) => { origErr(...args); writeLog("ERR", args); };
console.warn = (...args: unknown[]) => { origWarn(...args); writeLog("WARN", args); };

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { ensureChromaRunning } = await import("@/lib/chroma-server");
  await ensureChromaRunning();
}