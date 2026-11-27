/**
 * 外卖开店模拟器 — 店铺 JSON 存储
 * 一家数字店铺一个 JSON 文件；列表扫描 stores/*.json；写入用临时文件 + rename 原子替换。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import type { MerchantStore } from "./types";
import { createEmptyStore } from "./defaults";

// ponytail: MERCHANT_TAKEOUT_DIR 测试缝隙，默认指向仓库 data/merchant-takeout/stores
const DIR = process.env.MERCHANT_TAKEOUT_DIR || path.resolve(process.cwd(), "..", "..", "data", "merchant-takeout", "stores");

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

export function createStore(name: string): MerchantStore {
  return writeStore(createEmptyStore(name));
}

export function readStore(id: string): MerchantStore | null {
  if (!isValidId(id)) return null;
  const p = filePath(id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

export function writeStore(store: MerchantStore): MerchantStore {
  if (!isValidId(store.id)) throw new Error("非法的店铺 id");
  ensureDir();
  const existing = readStore(store.id);
  const record: MerchantStore = {
    ...store,
    createdAt: existing?.createdAt ?? store.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  const p = filePath(store.id);
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2));
  renameSync(tmp, p);
  return record;
}

export function listStores(): MerchantStore[] {
  ensureDir();
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf-8")) as MerchantStore)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function deleteStore(id: string): boolean {
  if (!isValidId(id)) return false;
  const p = filePath(id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}
