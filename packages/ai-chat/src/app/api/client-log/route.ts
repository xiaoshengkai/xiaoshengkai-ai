import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const LOG_DIR = path.resolve(process.cwd(), "..", "..", "logs", "app");

export async function POST(request: Request) {
  try {
    const { level, executionId, message } = await request.json();
    if (!message) return NextResponse.json({ ok: true });

    const date = new Date().toISOString().slice(0, 10);
    const logFile = path.join(LOG_DIR, `app-${date}.log`);

    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] [${executionId || "-"}] [${level || "LOG"}] ${message}\n`;
    const old = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf-8") : "";
    fs.writeFileSync(logFile, line + old);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}