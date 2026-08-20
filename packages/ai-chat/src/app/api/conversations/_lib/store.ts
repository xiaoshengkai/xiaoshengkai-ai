/**
 * 对话 JSON 存储 — 合并 5 个 conversations route 的散落实现
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve(process.cwd(), "..", "..", "data", "conversations");

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  model?: string;
  messages: unknown[];
}

export type ConversationSummary = Omit<ConversationRecord, "messages">;

function filePath(id: string) {
  return path.join(DIR, `${id}.json`);
}

export function readConversation(id: string): ConversationRecord | null {
  const p = filePath(id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

export function writeConversation(id: string, title: string, messages: unknown[], model?: string): ConversationRecord {
  ensureDir();
  const p = filePath(id);
  const existing = existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
  const record: ConversationRecord = {
    id,
    title: title || "未命名对话",
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    pinned: existing?.pinned ?? false,
    model: model || "deepseek",
    messages,
  };
  writeFileSync(p, JSON.stringify(record, null, 2));
  return record;
}

export function listConversations(): ConversationSummary[] {
  ensureDir();
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf-8")) as ConversationRecord)
    .map((r) => ({
      id: r.id,
      title: r.title || "未命名对话",
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      pinned: r.pinned || false,
      model: r.model,
    }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function deleteConversation(id: string): void {
  const p = filePath(id);
  if (existsSync(p)) unlinkSync(p);
}

export function pinConversation(id: string, pinned: boolean): ConversationRecord | null {
  const record = readConversation(id);
  if (!record) return null;
  record.pinned = pinned;
  record.updatedAt = Date.now();
  writeFileSync(filePath(id), JSON.stringify(record, null, 2));
  return record;
}