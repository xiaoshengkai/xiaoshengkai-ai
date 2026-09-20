import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const LOG_DIR = path.resolve(process.cwd(), "..", "..", "logs", "app");

export async function POST(request: Request) {
  try {
    const { level, executionId, message } = await request.json();
    if (!message) return NextResponse.json({ ok: true });

    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const logFile = path.join(LOG_DIR, `app-${date}.log`);

    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    const line = `[${now.toLocaleString("zh-CN", { hour12: false })}] [${executionId || "-"}] [${level || "LOG"}] ${message}\n`;
    // 追加写，与 createLogger 的正序格式保持一致
    fs.appendFileSync(logFile, line);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}