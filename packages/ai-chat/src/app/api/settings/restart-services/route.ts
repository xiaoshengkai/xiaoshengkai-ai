import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const SETTINGS_DIR = path.resolve(process.cwd(), "..", "..", "data", "settings");
const MARKER_PATH = path.join(SETTINGS_DIR, "reload-marker.json");
const SCHEDULER_PID = path.join(SETTINGS_DIR, "scheduler.pid");

export async function POST() {
  const results: string[] = [];

  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    fs.writeFileSync(MARKER_PATH, JSON.stringify({ at: new Date().toISOString(), reason: "settings changed" }));
    results.push("MCP marker 已写入, 下次请求自动重建 MCP 客户端");
  } catch (err) {
    results.push(`MCP marker 写入失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    if (fs.existsSync(SCHEDULER_PID)) {
      const pid = parseInt(fs.readFileSync(SCHEDULER_PID, "utf-8"), 10);
      process.kill(pid, "SIGTERM");
      results.push(`定时任务进程已终止 (PID ${pid}), 需 supervisor 自动重启`);
    } else {
      results.push("未找到定时任务 PID 文件 (scheduler.pid)");
    }
  } catch (err) {
    results.push(`定时任务重启失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json({ ok: true, results });
}