/**
 * 异步任务状态管理 — 合并 mcp/tools/{image,xiaohongshu,diagram} 三份散落实现
 */
import fs from "node:fs";
import path from "node:path";

export function writeTaskState(workDir, state) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, "task.json"), JSON.stringify(state, null, 2));
}

export function readTaskState(workDir) {
  const taskFile = path.join(workDir, "task.json");
  if (!fs.existsSync(taskFile)) return null;
  return JSON.parse(fs.readFileSync(taskFile, "utf-8"));
}

export function updateTask(workDir, update) {
  const state = readTaskState(workDir);
  if (!state) return;
  Object.assign(state, update);
  fs.writeFileSync(path.join(workDir, "task.json"), JSON.stringify(state, null, 2));
}

/** 自适应轮询等待时间（递减） */
export function getAdaptiveWait(intervalSec, checkCount) {
  const base = intervalSec * 1000;
  const min = base * 0.6;
  let wait = base;
  for (let i = 0; i < checkCount; i++) wait = Math.max(wait * 0.9, min);
  return wait;
}