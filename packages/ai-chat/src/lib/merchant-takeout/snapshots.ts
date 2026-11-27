/**
 * 外卖开店模拟器 — 方案快照 JSON 存储
 * 一个方案快照一个 JSON 文件；列表扫描 snapshots/*.json；写入用临时文件 + rename 原子替换。
 * 快照不可变：保存完整输入 + 沙盘计算结果，供前后比较与复制为新草稿。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MerchantStore, StoreSnapshot } from "./types";
import { writeStore } from "./store";

// ponytail: MERCHANT_TAKEOUT_SNAPSHOTS_DIR 测试缝隙，默认指向仓库 data/merchant-takeout/snapshots
const DIR = process.env.MERCHANT_TAKEOUT_SNAPSHOTS_DIR || path.resolve(process.cwd(), "..", "..", "data", "merchant-takeout", "snapshots");

// UUID 校验同时充当路径穿越防线：filePath 只拼 `${id}.json`，非 UUID 一律拒绝。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

function filePath(id: string) {
  return path.join(DIR, `${id}.json`);
}

function isValidId(id: string): boolean {
  return UUID_RE.test(id);
}

export function createSnapshot(snapshot: StoreSnapshot): StoreSnapshot {
  if (!isValidId(snapshot.id)) throw new Error("非法的快照 id");
  ensureDir();
  const p = filePath(snapshot.id);
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  renameSync(tmp, p);
  return snapshot;
}

export function readSnapshot(id: string): StoreSnapshot | null {
  if (!isValidId(id)) return null;
  const p = filePath(id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

export function listSnapshots(storeId?: string): StoreSnapshot[] {
  ensureDir();
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf-8")) as StoreSnapshot)
    .filter((s) => !storeId || s.storeId === storeId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function deleteSnapshot(id: string): boolean {
  if (!isValidId(id)) return false;
  const p = filePath(id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

export function copySnapshotToDraft(snapshotId: string, name: string): MerchantStore | null {
  const snapshot = readSnapshot(snapshotId);
  if (!snapshot) return null;
  const store: MerchantStore = {
    ...snapshot.input,
    id: randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "simulation",
    profile: { ...snapshot.input.profile, name: name.trim() || snapshot.input.profile.name },
  };
  return writeStore(store);
}
