import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { runWorkflowCli } from "../../../_lib/cli";

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

function setTweakStatus(dir: string, status: string, error?: string) {
  try {
    const state = readState(dir);
    state.tweakTask = {
      ...state.tweakTask,
      status,
      completedAt: new Date().toISOString(),
      error: error || null,
    };
    writeState(dir, state);
  } catch { /* ignore */ }
}

async function runTweakInBackground(executionId: string) {
  const dir = path.join(DATA_DIR, executionId);
  const TIMEOUT_MS = 600_000; // 10 分钟

  try {
    // tweak 带 timeout
    const data = (await Promise.race([
      runWorkflowCli(["tweak", JSON.stringify({ executionId })], 300_000),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("tweak timeout after 10 min")), TIMEOUT_MS)
      ),
    ])) as Record<string, unknown>;

    if (!data?.ok) {
      setTweakStatus(dir, "failed", data?.error as string || "tweak failed");
      writeLog("ERR", `tweak failed: ${data?.error}`);
      return;
    }

    // tweak 成功 → 更新任务状态
    const state = readState(dir);
    state.tweakTask = { status: "completed", completedAt: new Date().toISOString(), version: data.version as number, error: null };
    writeState(dir, state);
    writeLog("INFO", `tweak completed v${data.version}, starting auto in background...`);

    // auto 后台跑，不阻塞
    runWorkflowCli(["auto", JSON.stringify({ executionId })], 600_000)
      .then((autoResult) => {
        if ((autoResult as Record<string, unknown>)?.ok) {
          setTweakStatus(dir, "done");
          writeLog("INFO", "auto completed, render done");
        } else {
          setTweakStatus(dir, "failed", (autoResult as Record<string, unknown>)?.error as string || "auto failed");
          writeLog("ERR", `auto failed: ${(autoResult as Record<string, unknown>)?.error}`);
        }
      })
      .catch((err) => {
        setTweakStatus(dir, "failed", `auto error: ${err instanceof Error ? err.message : String(err)}`);
        writeLog("ERR", `auto error: ${err instanceof Error ? err.message : String(err)}`);
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeLog("ERR", `background tweak failed: ${msg}`);
    setTweakStatus(dir, "failed", msg);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { feedback, imagePaths } = await request.json();
  if (!feedback?.trim()) {
    return NextResponse.json({ ok: false, error: "missing feedback" }, { status: 400 });
  }

  const dir = path.join(DATA_DIR, id);
  const state = readState(dir);
  state.tweakTask = {
    status: "running",
    feedback,
    images: imagePaths || [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    version: null,
    error: null,
  };
  writeState(dir, state);

  void runTweakInBackground(id);

  return NextResponse.json({ ok: true, status: "running" });
}