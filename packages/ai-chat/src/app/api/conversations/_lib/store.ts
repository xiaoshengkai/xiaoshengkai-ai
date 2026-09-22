/**
 * 对话 JSON 存储 — 合并 5 个 conversations route 的散落实现
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import path from "node:path";

// ponytail: CONVERSATIONS_DIR 测试缝隙，默认指向仓库 data/conversations
const DIR = process.env.CONVERSATIONS_DIR || path.resolve(process.cwd(), "..", "..", "data", "conversations");

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  titleLocked?: boolean;
  model?: string;
  mode?: string;
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

// ── tool output 裁剪（getDetail 响应瘦身）与还原（save 时无损合并） ──
// UI 对 tool parts 只渲染 [toolName] 标签，output 从不显示（小红书预览卡例外，保留完整）；
// 裁剪仅作用于响应传输，存储保持完整；带 __trimmed 标记的 part 在 writeConversation 时
// 按 toolCallId 从存储换回完整 output，杜绝「加载后再保存丢失原始数据」。
const TRIM_LIMIT = 200;

interface ToolPart {
  type?: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  output?: string;
  __trimmed?: boolean;
  [k: string]: unknown;
}

function isXhsCardPart(p: ToolPart): boolean {
  if (p.toolName !== "generateXiaohongshuNote" || p.state !== "result" || p.output == null) return false;
  try {
    const o = typeof p.output === "string" ? JSON.parse(p.output) : p.output;
    return !!(o && o.ok && o.taskId);
  } catch {
    return false;
  }
}

function serializedOutput(p: ToolPart): string {
  return typeof p.output === "string" ? p.output : JSON.stringify(p.output);
}

export function trimToolOutputs(record: ConversationRecord): ConversationRecord {
  const messages = (record.messages as { parts?: ToolPart[] }[] | undefined)?.map((m) => {
    if (!m?.parts) return m;
    const parts = m.parts.map((p) => {
      if (
        p?.type === "dynamic-tool" &&
        p.state === "output-available" &&
        p.output != null &&
        serializedOutput(p).length > TRIM_LIMIT &&
        !isXhsCardPart(p)
      ) {
        const trimmedPart: ToolPart = { ...p, __trimmed: true };
        if (p.output != null) trimmedPart.output = serializedOutput(p).slice(0, TRIM_LIMIT) + "…(已截断,完整内容见存储)";
        if (p.input != null) trimmedPart.input = JSON.stringify(p.input).slice(0, TRIM_LIMIT);
        return trimmedPart;
      }
      return p;
    });
    return { ...m, parts };
  });
  return { ...record, messages: messages ?? record.messages };
}

function restoreTrimmedOutputs(incoming: unknown[], stored: unknown[]): unknown[] {
  const byCall = new Map<string, ToolPart>();
  for (const m of (stored as { parts?: ToolPart[] }[]) || []) {
    for (const p of m?.parts || []) {
      if (p?.type === "dynamic-tool" && p.toolCallId) byCall.set(p.toolCallId, p);
    }
  }
  if (byCall.size === 0) return incoming;
  return (incoming as { parts?: ToolPart[] }[]).map((m) => {
    if (!m?.parts) return m;
    const parts = m.parts.map((p) => {
      const storedPart = p?.__trimmed && p.toolCallId ? byCall.get(p.toolCallId) : undefined;
      if (storedPart) {
        const { __trimmed: _drop, ...rest } = p;
        return { ...rest, output: storedPart.output, input: storedPart.input };
      }
      return p;
    });
    return { ...m, parts };
  });
}

export function writeConversation(id: string, title: string, messages: unknown[], model?: string, mode?: string): ConversationRecord {
  ensureDir();
  const p = filePath(id);
  const existing = existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
  // 无损合并：客户端带 __trimmed 标记的 tool part 换回存储里的完整 output
  const merged = existing ? restoreTrimmedOutputs(messages, existing.messages) : messages;
  const record: ConversationRecord = {
    id,
    title: existing?.titleLocked ? existing.title : (title || "未命名对话"),
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    pinned: existing?.pinned ?? false,
    titleLocked: existing?.titleLocked ?? false,
    model: model || "deepseek",
    mode: mode || existing?.mode || "chat",
    messages: merged,
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

export function renameConversation(id: string, title: string): ConversationRecord | null {
  const record = readConversation(id);
  if (!record) return null;
  record.title = title || "未命名对话";
  record.titleLocked = true;
  writeFileSync(filePath(id), JSON.stringify(record, null, 2));
  return record;
}

export function pinConversation(id: string, pinned: boolean): ConversationRecord | null {
  const record = readConversation(id);
  if (!record) return null;
  record.pinned = pinned;
  writeFileSync(filePath(id), JSON.stringify(record, null, 2));
  return record;
}