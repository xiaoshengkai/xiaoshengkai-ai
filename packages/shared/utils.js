/**
 * 共享工具函数 — 替换散落的 sleep / shortId
 */
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 给任意 promise 加硬超时：超时强制 reject，上层一定能继续。
 * 与 AbortController 不同，不依赖底层 fetch 是否响应 abort——底层挂起时上层照常推进。
 */
export const withTimeout = (promise, ms, label = "操作") => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)}s）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export const shortId = () => crypto.randomUUID().slice(0, 8);

/** 系统 Downloads 目录（跨工具复用） */
export const downloadsDir = path.join(os.homedir(), "Downloads");

/** 仓库根（packages/shared → 上两级） */
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const dataDir = path.join(projectRoot, "data");
/** 小红书笔记任务目录（持久化，跨重启不丢；原 os.tmpdir() 重启即清空） */
export const xhsTasksDir = path.join(dataDir, "xhs-tasks");
/** 小红书笔记导出目录（浏览器可下载的产物） */
export const exportsDir = path.join(dataDir, "exports");