/**
 * 共享工具函数 — 替换散落的 sleep / shortId
 */
import crypto from "node:crypto";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const shortId = () => crypto.randomUUID().slice(0, 8);