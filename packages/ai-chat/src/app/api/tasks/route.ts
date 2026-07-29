import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const TASKS_DIR = path.resolve(process.cwd(), "..", "..", "packages", "tasks");
const DATA_DIR = path.resolve(process.cwd(), "..", "..", "data", "tasks");

function getStatePath(name: string) {
  return path.join(DATA_DIR, name, "index.json");
}

function getLockPath(name: string) {
  return path.join(DATA_DIR, name, ".lock");
}

function readData(name: string) {
  const p = getStatePath(name);
  const defaults = { description: "", cron: null, enabled: true, until: null, lastRun: null, lastStatus: null, lastError: null };
  if (fs.existsSync(p)) {
    return { ...defaults, ...JSON.parse(fs.readFileSync(p, "utf-8")) };
  }
  return defaults;
}

function writeData(name: string, partial: Record<string, unknown>) {
  const p = getStatePath(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const current = readData(name);
  const updated = { ...current, ...partial };
  fs.writeFileSync(p, JSON.stringify(updated, null, 2));
}

function appendTaskLog(name: string, text: string) {
  const logDir = path.resolve(process.cwd(), "..", "..", "logs", "tasks");
  fs.mkdirSync(logDir, { recursive: true });
  const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] ${text}\n`;
  fs.appendFileSync(path.join(logDir, `${name}.log`), line);
}

function loadTasks() {
  const tasks: Record<string, unknown>[] = [];
  if (!fs.existsSync(TASKS_DIR)) return tasks;

  for (const dir of fs.readdirSync(TASKS_DIR)) {
    const taskDir = path.join(TASKS_DIR, dir);
    const taskJson = path.join(taskDir, "task.json");
    if (!fs.statSync(taskDir).isDirectory() || !fs.existsSync(taskJson)) continue;

    const meta = JSON.parse(fs.readFileSync(taskJson, "utf-8"));
    const name = meta.name || dir;
    const data = readData(name);

    const lockPath = getLockPath(name);
    const running = fs.existsSync(lockPath);

    tasks.push({
      name,
      description: data.description || "",
      html: meta.html || null,
      cron: data.cron,
      enabled: data.enabled,
      until: data.until,
      running,
      lastRun: data.lastRun,
      lastStatus: data.lastStatus,
      lastError: data.lastError,
    });
  }
  return tasks;
}

export async function GET() {
  const tasks = loadTasks();
  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  const { name } = await request.json();
  if (!name) return NextResponse.json({ error: "missing name" }, { status: 400 });

  const taskDir = path.join(TASKS_DIR, name);
  const entryPath = path.join(taskDir, "index.js");
  if (!fs.existsSync(entryPath)) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  const lockPath = getLockPath(name);
  if (fs.existsSync(lockPath)) {
    return NextResponse.json({ error: "task is running" }, { status: 409 });
  }

  const startTime = new Date();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, String(process.pid));

  try {
    await new Promise<void>((resolve, reject) => {
      execFile("node", [entryPath], { timeout: 300000 }, (err, stdout, stderr) => {
        if (stdout) appendTaskLog(name, stdout);
        if (stderr) appendTaskLog(name, stderr);
        if (err) reject(err);
        else resolve();
      });
    });

    writeData(name, { lastRun: startTime.toISOString(), lastStatus: "success", lastError: null });
    return NextResponse.json({ ok: true, status: "success" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    writeData(name, { lastRun: startTime.toISOString(), lastStatus: "error", lastError: message });
    return NextResponse.json({ ok: false, status: "error", error: message }, { status: 500 });
  } finally {
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

export async function PUT(request: Request) {
  const { name, cron, enabled, description, until } = await request.json();
  if (!name) return NextResponse.json({ error: "missing name" }, { status: 400 });

  const taskJsonPath = path.join(TASKS_DIR, name, "task.json");
  if (!fs.existsSync(taskJsonPath)) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  // 更新 data/tasks/<name>/index.json
  const dataFields: Record<string, unknown> = {};
  if (cron !== undefined) dataFields.cron = cron;
  if (enabled !== undefined) dataFields.enabled = enabled;
  if (until !== undefined) dataFields.until = until || null;
  if (description !== undefined) dataFields.description = description;
  writeData(name, dataFields);

  return NextResponse.json({ ok: true });
}
