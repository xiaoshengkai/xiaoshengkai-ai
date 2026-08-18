/**
 * 共享工具函数 — 替换散落的 sleep / shortId
 */
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const shortId = () => crypto.randomUUID().slice(0, 8);

/** 系统 Downloads 目录（跨工具复用） */
export const downloadsDir = path.join(os.homedir(), "Downloads");