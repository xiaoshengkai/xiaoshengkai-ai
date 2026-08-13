import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { runWorkflowCli } from "@/lib/workflow-cli";

const DATA_DIR = path.resolve(process.cwd(), "..", "..", "data", "workflows");

function writeLog(level: string, message: string) {
  try {
    const logDir = path.resolve(process.cwd(), "..", "..", "logs", "app");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `app-${date}.log`);
    const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] [tweak] [${level}] ${message}\n`;
    const old = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf-8") : "";
    fs.writeFileSync(logFile, line + old);
  } catch { /* ignore */ }
}

function readState(dir: string) {
  return JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf-8"));
}

function writeState(dir: string, state: unknown) {
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
}

async function runTweakInBackground(executionId: string) {
  const dir = path.join(DATA_DIR, executionId);

  try {
    // 调 tweak CLI（只传 id，feedback 已存 state.json）
    const data = await runWorkflowCli(
      ["tweak", JSON.stringify({ executionId })],
      300_000
    ) as Record<string, unknown>;

    if (!data?.ok) {
      const state = readState(dir);
      state.tweakTask = { status: "failed", completedAt: new Date().toISOString(), error: data?.error || "tweak failed" };
      writeState(dir, state);
      writeLog("ERR", `tweak failed: ${data?.error}`);
      return;
    }

    // tweak 成功 → 更新任务状态
    const state = readState(dir);
    state.tweakTask = { status: "completed", completedAt: new Date().toISOString(), version: data.version, error: null };
    writeState(dir, state);
    writeLog("INFO", `tweak completed v${data.version}, starting auto...`);

    // 自动跑 render（auto）
    const autoResult = await runWorkflowCli(
      ["auto", JSON.stringify({ executionId })],
      600_000
    ) as Record<string, unknown>;

    const state2 = readState(dir);
    if (autoResult?.ok) {
      state2.tweakTask = { status: "done", completedAt: new Date().toISOString(), version: data.version, error: null };
      writeLog("INFO", `auto completed, render done`);
    } else {
      state2.tweakTask = { status: "failed", completedAt: new Date().toISOString(), version: data.version, error: autoResult?.error || "auto failed" };
      writeLog("ERR", `auto failed: ${autoResult?.error}`);
    }
    writeState(dir, state2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeLog("ERR", `background tweak failed: ${msg}`);
    try {
      const state = readState(dir);
      state.tweakTask = { status: "failed", completedAt: new Date().toISOString(), error: msg, feedback: state.tweakTask?.feedback || null };
      writeState(dir, state);
    } catch { /* ignore */ }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { feedback } = await request.json();
  if (!feedback) return NextResponse.json({ ok: false, error: "missing feedback" }, { status: 400 });

  const dir = path.join(DATA_DIR, id);

  try {
    if (!fs.existsSync(dir)) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    // 把 feedback 存到 state.json，不走 CLI argv
    const state = readState(dir);
    // 预更新步骤状态，让前端立即看到
    state.status = "running";
    state.steps.forEach((s: { id: string; status: string; elapsed?: string | null; output?: unknown; startedAt?: string | null; error?: string | null }) => {
      if (s.id === "script") {
        s.status = "running";
        s.elapsed = null;
        s.startedAt = null;
      }
      if (s.id === "render" && s.status === "completed") {
        s.status = "pending";
        s.output = null;
        s.error = null;
        s.startedAt = null;
        s.elapsed = null;
      }
    });
    state.tweakTask = { status: "running", startedAt: new Date().toISOString(), completedAt: null, version: null, error: null, feedback };
    writeState(dir, state);
    writeLog("INFO", `async tweak started: feedback="${feedback}"`);

    // 后台执行（不传 feedback，避免 \n 破坏 argv）
    runTweakInBackground(id).catch((err) => {
      writeLog("ERR", `background tweak unhandled: ${err instanceof Error ? err.message : String(err)}`);
    });

    return NextResponse.json({ ok: true, status: "running" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeLog("ERR", `POST /tweak failed: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}