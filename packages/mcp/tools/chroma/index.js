import { z } from "zod";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { embedText, getCollection, searchCollection, listChatCollections } from "../../lib/chroma.js";

const SHARED_DB = process.env.CHROMA_SHARED_DB || "shared";
const CHAT_DB = process.env.CHROMA_CHAT_DB || "chat";
const CODE_DB = process.env.CHROMA_CODE_DB || "code";
const SHARED_COLLECTION = "base_knowledge";
const CHAT_COLLECTION = "chat_knowledge";

const SOFT_DELETE_WINDOW_MS = parseInt(process.env.SOFT_DELETE_WINDOW_MS || "3000", 10);
const TOP_K_DEFAULT = 3;

// ponytail: basename(process.cwd()) 在子目录启动时会取到子目录名而非项目名，后续优化为向上查找 .git/package.json 定位项目根
function defaultCollection(db) {
  if (db === SHARED_DB) return SHARED_COLLECTION;
  if (db === CODE_DB) return basename(process.cwd());
  return CHAT_COLLECTION;
}

function toolResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export function register(server) {
  server.tool(
    "addKnowledge",
    "向知识库新增一条笔记。内容用 Markdown 格式记录：## 标题 → ### 小节 → ```代码块/架构图``` → 要点列表，层级分明、信息完整。shared 库用于规则/个人信息，chat 库用于普通知识（默认）。学习场景传 collection=learn-<主题>，其余场景不传使用默认值。",
    {
      content: z.string().min(1).max(10000).describe("笔记正文，用 Markdown 记录：## 标题 → ### 小节 → ```代码块``` → 列表"),
      source: z.string().optional().describe("可选来源标记"),
      database: z.string().optional().describe("目标数据库: shared/chat/code，默认 chat"),
      collection: z.string().optional().describe("目标 collection。不传则自动匹配（shared→base_knowledge, chat→chat_knowledge, code→需指定项目名）"),
    },
    async ({ content, source, database, collection }) => {
      try {
        const db = database || CHAT_DB;
        const col = collection || defaultCollection(db);
        console.log(`[chroma:addKnowledge] db=${db} col=${col} content="${content.slice(0, 80)}"`);
        const id = randomUUID();
        const embedding = await embedText(content);
        const c = await getCollection(db, col);
        const metadata = {
          createdAt: Date.now(),
          deleted: false,
          ...(source ? { source } : {}),
        };
        await c.add({ ids: [id], embeddings: [embedding], documents: [content], metadatas: [metadata] });
        return toolResult({ ok: true, data: { id, database: db, collection: col, charCount: content.length, createdAt: metadata.createdAt, source: source ?? null } });
      } catch (err) {
        return toolResult({ ok: false, error: `addKnowledge 失败: ${err.message}` });
      }
    },
  );

  server.tool(
    "searchKnowledge",
    "在知识库中检索笔记。默认同时查 shared+chat，指定 database 时查 shared+指定库。",
    {
      query: z.string().min(1).describe("查询文本"),
      topK: z.number().int().min(1).max(100).optional().describe("返回条数，默认 3"),
      database: z.string().optional().describe("目标数据库: shared/chat/code，默认同时查 shared+chat"),
      collection: z.string().optional().describe("目标 collection"),
    },
    async ({ query, topK = TOP_K_DEFAULT, database, collection }) => {
      try {
        const queryVec = await embedText(query);

        const targets = [];
        if (database) {
          const targetCol = collection || defaultCollection(database);
          if (database === SHARED_DB && targetCol === SHARED_COLLECTION) {
            targets.push({ database: SHARED_DB, collection: SHARED_COLLECTION });
          } else {
            targets.push({ database: SHARED_DB, collection: SHARED_COLLECTION });
            targets.push({ database, collection: targetCol });
          }
        } else {
          targets.push({ database: SHARED_DB, collection: SHARED_COLLECTION });
          const chatCollections = await listChatCollections().catch(() => [CHAT_COLLECTION]);
          for (const col of chatCollections) {
            targets.push({ database: CHAT_DB, collection: col });
          }
        }
        console.log(`[chroma:searchKnowledge] query="${query.slice(0, 50)}" database=${database} collection=${collection} targets=${JSON.stringify(targets.map(t => `${t.database}/${t.collection}`))}`);

        // 每个 collection 取 topK*3，合并后截断，避免跨 collection 遗漏
        const perCollection = topK * 3;
        const allResults = await Promise.all(
          targets.map((t) => searchCollection(queryVec, t.database, t.collection, perCollection)),
        );
        const merged = allResults.flat().sort((a, b) => b.similarity - a.similarity).slice(0, topK);
        const perCollectionStats = allResults.map((r, i) => `${targets[i].collection}=${r.length}`);
        console.log(`[chroma:searchKnowledge] per-collection: ${perCollectionStats.join(", ")} | merged=${merged.length}`);
        const hitLimit = merged.length >= topK;
        const note = hitLimit ? " 结果数已达到查询上限，可能还有更多。" : "";
        return toolResult({ ok: true, data: { results: merged }, note: note.trim() || undefined });
      } catch (err) {
        return toolResult({ ok: false, error: `searchKnowledge 失败: ${err.message}` });
      }
    },
  );

  server.tool(
    "updateKnowledge",
    "根据 id 修订已有笔记。",
    {
      id: z.string().min(1).describe("目标笔记的 ID"),
      newContent: z.string().min(1).describe("新的笔记正文"),
      database: z.string().optional().describe("所在数据库，默认 chat"),
      collection: z.string().optional().describe("所在 collection，默认 chat_knowledge"),
    },
    async ({ id, newContent, database, collection }) => {
      try {
        const db = database || CHAT_DB;
        const col = collection || defaultCollection(db);
        const c = await getCollection(db, col);
        const existing = await c.get({ ids: [id], include: ["metadatas"] });
        if (existing.ids.length === 0) return toolResult({ ok: false, error: `id 不存在: ${id}` });
        const meta = existing.metadatas?.[0] ?? {};
        if (meta.deleted === true) return toolResult({ ok: false, error: "id 已软删，请先 restoreKnowledgeById 撤销" });
        const newEmbedding = await embedText(newContent);
        const updatedAt = Date.now();
        await c.update({ ids: [id], embeddings: [newEmbedding], documents: [newContent], metadatas: [{ ...meta, updatedAt }] });
        return toolResult({ ok: true, data: { id, charCount: newContent.length, updatedAt } });
      } catch (err) {
        return toolResult({ ok: false, error: `updateKnowledge 失败: ${err.message}` });
      }
    },
  );

  server.tool(
    "deleteKnowledge",
    "软删一条笔记。3 秒内可用 restoreKnowledgeById 撤销。",
    {
      id: z.string().min(1).describe("目标笔记的 ID"),
      database: z.string().optional().describe("所在数据库，默认 chat"),
      collection: z.string().optional().describe("所在 collection，默认 chat_knowledge"),
    },
    async ({ id, database, collection }) => {
      try {
        const db = database || CHAT_DB;
        const col = collection || defaultCollection(db);
        const c = await getCollection(db, col);
        const existing = await c.get({ ids: [id], include: ["metadatas"] });
        if (existing.ids.length === 0) return toolResult({ ok: false, error: `id 不存在: ${id}` });
        const meta = existing.metadatas?.[0] ?? {};
        if (meta.deleted === true) return toolResult({ ok: false, error: "id 已处于软删状态" });
        const deletedAt = Date.now();
        await c.update({ ids: [id], metadatas: [{ ...meta, deleted: true, deletedAt }] });
        return toolResult({ ok: true, data: { id, deletedAt, undoExpiresAt: deletedAt + SOFT_DELETE_WINDOW_MS, windowMs: SOFT_DELETE_WINDOW_MS } });
      } catch (err) {
        return toolResult({ ok: false, error: `deleteKnowledge 失败: ${err.message}` });
      }
    },
  );

  server.tool(
    "restoreKnowledgeById",
    "撤销最近的软删。仅在 3 秒窗口内有效。",
    {
      id: z.string().min(1).describe("目标笔记的 ID"),
      database: z.string().optional().describe("所在数据库，默认 chat"),
      collection: z.string().optional().describe("所在 collection，默认 chat_knowledge"),
    },
    async ({ id, database, collection }) => {
      try {
        const db = database || CHAT_DB;
        const col = collection || defaultCollection(db);
        const c = await getCollection(db, col);
        const existing = await c.get({ ids: [id], include: ["metadatas"] });
        if (existing.ids.length === 0) return toolResult({ ok: false, error: `id 不存在: ${id}` });
        const meta = existing.metadatas?.[0] ?? {};
        if (meta.deleted !== true) return toolResult({ ok: true, data: { id, restored: false, reason: "未被软删" } });
        const elapsed = Date.now() - meta.deletedAt;
        if (elapsed > SOFT_DELETE_WINDOW_MS) {
          return toolResult({ ok: true, data: { id, restored: false, reason: `undo window expired (${elapsed}ms)` } });
        }
        await c.update({ ids: [id], metadatas: [{ ...meta, deleted: false }] });
        return toolResult({ ok: true, data: { id, restored: true, deletedAt: meta.deletedAt } });
      } catch (err) {
        return toolResult({ ok: false, error: `restoreKnowledgeById 失败: ${err.message}` });
      }
    },
  );
}