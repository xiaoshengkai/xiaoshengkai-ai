/**
 * 数据落盘：快照（snapshots/YYYY-MM-DD.json）+ 累计索引（registry.json）
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./fetcher.js";
import { config } from "./config.js";

const SNAP_DIR = path.join(DATA_DIR, "snapshots");
const REGISTRY_FILE = path.join(DATA_DIR, "registry.json");

export function todayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function saveSnapshot(date, houses, meta = {}) {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const payload = { date, fetchedAt: new Date().toISOString(), houses, meta };
  fs.writeFileSync(path.join(SNAP_DIR, `${date}.json`), JSON.stringify(payload, null, 2), "utf-8");
  fs.writeFileSync(path.join(DATA_DIR, "current.json"), JSON.stringify(payload, null, 2), "utf-8");
}

/** 早于 date 的最近一份快照（跳过中断日，避免误报下架） */
export function loadPreviousSnapshot(date) {
  if (!fs.existsSync(SNAP_DIR)) return null;
  const files = fs
    .readdirSync(SNAP_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < date)
    .sort();
  if (!files.length) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(SNAP_DIR, files[files.length - 1]), "utf-8"));
  } catch {
    return null;
  }
}

export function loadTodaySnapshot(date) {
  const f = path.join(SNAP_DIR, `${date}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf-8"));
  } catch {
    return null;
  }
}

export function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveRegistry(registry) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf-8");
}

export function pruneSnapshots() {
  if (!fs.existsSync(SNAP_DIR)) return;
  const cutoff = new Date(Date.now() - config.retentionDays * 86400000)
    .toISOString()
    .slice(0, 10);
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (/^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < cutoff) {
      fs.unlinkSync(path.join(SNAP_DIR, f));
    }
  }
}
