import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskLogger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = __dirname;
const DATA_DIR = path.resolve(__dirname, "..", "..", "data", "tasks");
const LOG_DIR = path.resolve(__dirname, "..", "..", "logs", "tasks");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const running = new Set();
let cronJobs = new Map();
let taskMetas = new Map();

function getStatePath(name) {
  // 新结构: data/tasks/{name}/index.json
  return path.join(DATA_DIR, name, "index.json");
}

function getLockPath(name) {
  return path.join(DATA_DIR, name, ".lock");
}

function readData(name) {
  const p = getStatePath(name);
  const defaults = { cron: null, crons: null, enabled: true, until: null, lastRun: null, lastStatus: null, lastError: null };
  if (fs.existsSync(p)) {
    return { ...defaults, ...JSON.parse(fs.readFileSync(p, "utf-8")) };
  }
  return defaults;
}

function writeData(name, partial) {
  const p = getStatePath(name);
  const current = readData(name);
  const updated = { ...current, ...partial };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(updated, null, 2));
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

    // 支持单个 cron 和 crons 数组
    const crons = data.crons || (data.cron ? [data.cron] : []);

    tasks.push({
      name,
      description: data.description || "",
      html: meta.html || null,
      dir: taskDir,
      crons,
      enabled: data.enabled,
      until: data.until,
    });
  }
  return tasks;
}

function isExpired(until) {
  if (!until) return false;
  return new Date() > new Date(until + "T23:59:59+08:00");
}

async function runTask(task) {
  const { name, dir } = task;
  const logger = createTaskLogger(name);

  if (running.has(name)) {
    logger.warn(`任务 "${name}" 正在执行中，跳过本次触发`);
    return;
  }

  const lockPath = getLockPath(name);
  if (fs.existsSync(lockPath)) {
    logger.warn(`任务 "${name}" 锁文件存在，跳过本次触发`);
    return;
  }

  running.add(name);
  fs.writeFileSync(lockPath, String(process.pid));

  const startTime = new Date();
  logger.info(`开始执行任务 "${name}"`);

  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { origLog(...args); logger.log(...args); };
  console.error = (...args) => { origErr(...args); logger.error(...args); };

  try {
    const entryPath = path.join(dir, "index.js");
    const mod = await import(entryPath);
    await mod.run();

    writeData(name, {
      lastRun: startTime.toISOString(),
      lastStatus: "success",
      lastError: null,
    });

    logger.info(`任务 "${name}" 执行成功 (${(Date.now() - startTime.getTime()) / 1000}s)`);
  } catch (err) {
    writeData(name, {
      lastRun: startTime.toISOString(),
      lastStatus: "error",
      lastError: err.message,
    });

    logger.error(`任务 "${name}" 执行失败: ${err.message}`);
    console.error(`[${name}]`, err);
  } finally {
    console.log = origLog;
    console.error = origErr;
    running.delete(name);
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

function registerCron(task) {
  const validCrons = task.crons.filter(c => {
    if (!c || !cron.validate(c)) {
      console.error(`  ✗ ${task.name}: cron 表达式无效 (${c})`);
      return false;
    }
    return true;
  });

  if (validCrons.length === 0) {
    console.error(`  ✗ ${task.name}: 没有可用的 cron 表达式`);
    return;
  }

  for (const cronExpr of validCrons) {
    const job = cron.schedule(cronExpr, () => {
      if (isExpired(task.until)) return;
      runTask(task);
    }, { timezone: "Asia/Shanghai" });

    // 用 name + cron 表达式作为唯一 key
    const key = `${task.name}::${cronExpr}`;
    cronJobs.set(key, job);
  }

  // 存任务元信息
  taskMetas.set(task.name, { crons: task.crons, enabled: task.enabled, until: task.until });

  const expired = isExpired(task.until) ? " [已到期]" : "";
  console.log(`  ✓ ${task.name}: ${validCrons.join(", ")} — ${task.description || ""}${expired}`);
}

function reloadCronJobs() {
  const tasks = loadTasks();
  const enabled = tasks.filter(t => t.enabled !== false);

  for (const [, job] of cronJobs) {
    job.stop();
  }
  cronJobs.clear();
  taskMetas.clear();

  if (enabled.length === 0) {
    console.log("没有启用的定时任务");
    return;
  }

  console.log(`已加载 ${enabled.length} 个定时任务:\n`);
  for (const task of enabled) {
    registerCron(task);
  }
  console.log("\n调度器已启动\n");
}

// 热重载：每 30s 检查 task.json 和 index.json 是否变化
function watchForChanges() {
  let lastMtimes = {};
  setInterval(() => {
    let changed = false;
    const tasks = loadTasks();
    for (const task of tasks) {
      const taskJsonPath = path.join(task.dir, "task.json");
      const dataPath = getStatePath(task.name);
      const mtime = (fs.existsSync(taskJsonPath) ? fs.statSync(taskJsonPath).mtimeMs : 0)
        + (fs.existsSync(dataPath) ? fs.statSync(dataPath).mtimeMs : 0);
      if (lastMtimes[task.name] !== mtime) {
        changed = true;
        lastMtimes[task.name] = mtime;
      }
    }
    if (changed) {
      console.log("[SCHEDULER] 检测到配置变化，重新加载任务...");
      reloadCronJobs();
    }
  }, 30000);
}

reloadCronJobs();
watchForChanges();
