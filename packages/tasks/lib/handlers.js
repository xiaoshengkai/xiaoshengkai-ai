/**
 * tasks 能力 handlers（从 ai-chat app/api/tasks 迁入）
 * list / run / edit / dashboard
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

// ponytail: 被 Next webpack 打包，沿用 process.cwd() = packages/ai-chat 约定
const PROJECT_ROOT = path.resolve(process.cwd(), "..", "..");
const TASKS_DIR = path.join(PROJECT_ROOT, "packages", "tasks", "tasks");
const DATA_DIR = path.join(PROJECT_ROOT, "data", "tasks");
const LOG_DIR = path.join(PROJECT_ROOT, "logs", "tasks");

function getStatePath(name) {
  return path.join(DATA_DIR, name, "index.json");
}

function getLockPath(name) {
  return path.join(DATA_DIR, name, ".lock");
}

function readData(name) {
  const p = getStatePath(name);
  const defaults = { description: "", cron: null, enabled: true, until: null, lastRun: null, lastStatus: null, lastError: null };
  if (fs.existsSync(p)) {
    return { ...defaults, ...JSON.parse(fs.readFileSync(p, "utf-8")) };
  }
  return defaults;
}

function writeData(name, partial) {
  const p = getStatePath(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const current = readData(name);
  const updated = { ...current, ...partial };
  fs.writeFileSync(p, JSON.stringify(updated, null, 2));
}

function appendTaskLog(name, text) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] ${text}\n`;
  fs.appendFileSync(path.join(LOG_DIR, `${name}.log`), line);
}

function loadTasks() {
  const tasks = [];
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

export async function handleList() {
  return { tasks: loadTasks() };
}

export async function handleRun({ request }) {
  const { name } = await request.json();
  if (!name) return Response.json({ ok: false, error: "missing name" }, { status: 400 });

  const taskDir = path.join(TASKS_DIR, name);
  const entryPath = path.join(taskDir, "index.js");
  if (!fs.existsSync(entryPath)) {
    return Response.json({ ok: false, error: "task not found" }, { status: 404 });
  }

  const lockPath = getLockPath(name);
  if (fs.existsSync(lockPath)) {
    return Response.json({ ok: false, error: "task is running" }, { status: 409 });
  }

  const startTime = new Date();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, String(process.pid));

  try {
    await new Promise((resolve, reject) => {
      execFile("node", [entryPath], { timeout: 300000 }, (err, stdout, stderr) => {
        if (stdout) appendTaskLog(name, stdout);
        if (stderr) appendTaskLog(name, stderr);
        if (err) reject(err);
        else resolve();
      });
    });

    writeData(name, { lastRun: startTime.toISOString(), lastStatus: "success", lastError: null });
    return { ok: true, status: "success" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeData(name, { lastRun: startTime.toISOString(), lastStatus: "error", lastError: message });
    return Response.json({ ok: false, status: "error", error: message }, { status: 500 });
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  }
}

export async function handleEdit({ request }) {
  const { name, cron, enabled, description, until } = await request.json();
  if (!name) return Response.json({ ok: false, error: "missing name" }, { status: 400 });

  const taskJsonPath = path.join(TASKS_DIR, name, "task.json");
  if (!fs.existsSync(taskJsonPath)) {
    return Response.json({ ok: false, error: "task not found" }, { status: 404 });
  }

  const dataFields = {};
  if (cron !== undefined) dataFields.cron = cron;
  if (enabled !== undefined) dataFields.enabled = enabled;
  if (until !== undefined) dataFields.until = until || null;
  if (description !== undefined) dataFields.description = description;
  writeData(name, dataFields);

  return { ok: true };
}

export async function handleDashboard({ params }) {
  const name = params.name;
  const taskDir = path.join(TASKS_DIR, name);
  const taskJson = path.join(taskDir, "task.json");

  if (!fs.existsSync(taskJson)) {
    return new Response("Not Found", { status: 404 });
  }

  const meta = JSON.parse(fs.readFileSync(taskJson, "utf-8"));
  const htmlFile = meta.html;
  if (!htmlFile) {
    return new Response("No dashboard", { status: 404 });
  }

  const htmlPath = path.join(taskDir, htmlFile);
  if (!fs.existsSync(htmlPath)) {
    return new Response("Dashboard not generated yet", { status: 404 });
  }

  const html = fs.readFileSync(htmlPath, "utf-8");
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
