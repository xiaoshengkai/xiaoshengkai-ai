/**
 * Chroma 管理面板 API 路由 — 多库版
 * ============================================================================
 *
 * ⚠️  dev-only,无鉴权。
 *
 * Action:
 *   - GET  ?action=list&database=&collection=    分页列表
 *   - GET  ?action=show&id&database=&collection= 单条详情
 *   - GET  ?action=stats&database=&collection=   统计
 *   - POST ?action=search    语义检索
 *   - POST ?action=compact   整理数据（去重）
 * ============================================================================
 */

import { NextRequest, NextResponse } from "next/server";
import { embed } from "ai";
import type { Where, WhereDocument } from "chromadb";
import {
  listAllChunks,
  getChunkById,
  getCollectionSafe,
  getCollectionStats,
  compactCollection,
  searchRelevant,
  VECTOR_PREVIEW_DIMENSIONS,
  EMBEDDING_DIM,
  SHARED_DB,
  SHARED_COLLECTION,
} from "@/lib/rag/vector-store";
import { glm } from "@/lib/ai/providers";

function ok(data: unknown) {
  return NextResponse.json({ ok: true, data });
}

function err(message: string, status: number = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function parseIntParam(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function parseBoolParam(value: string | null): boolean {
  return value === "true" || value === "1";
}

function getDbColParams(url: URL) {
  return {
    database: url.searchParams.get("database") || undefined,
    collection: url.searchParams.get("collection") || undefined,
  };
}

// ─── Action: stats ───────────────────────────────────────────────

async function handleStats(req: NextRequest) {
  const url = new URL(req.url);
  const { database, collection } = getDbColParams(url);

  const db = database || SHARED_DB;
  const col = collection || SHARED_COLLECTION;
  if (!col) return err("collection 不能为空");

  const safe = await getCollectionSafe(db, col);
  if (!safe) return ok({ database: db, name: col, count: 0, dimension: null });

  try {
    const stats = await getCollectionStats(db, col);
    return ok({ database: db, name: col, count: stats.count, dimension: stats.dimension });
  } catch {
    return ok({ database: db, name: col, count: 0, dimension: null });
  }
}

// ─── Action: list ────────────────────────────────────────────────

async function handleList(req: NextRequest) {
  const url = new URL(req.url);
  const includeDeleted = parseBoolParam(url.searchParams.get("includeDeleted"));
  const { database, collection } = getDbColParams(url);

  const db = database || SHARED_DB;
  const col = collection || SHARED_COLLECTION;
  if (!col) return err("collection 不能为空");

  const safe = await getCollectionSafe(db, col);
  if (!safe) return ok({ chunks: [], database: db, collection: col });

  const result = await listAllChunks({
    includeDeleted,
    database: db,
    collection: col,
  });

  return ok({
    ...result,
    database: db,
    collection: col,
  });
}

// ─── Action: show ────────────────────────────────────────────────

async function handleShow(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return err("缺少 id 参数");
  const { database, collection } = getDbColParams(url);
  const db = database || SHARED_DB;
  const col = collection || SHARED_COLLECTION;
  if (!col) return err("collection 不能为空");

  const safe = await getCollectionSafe(db, col);
  if (!safe) return err(`collection 不存在: ${db}/${col}`, 404);

  const detail = await getChunkById(id, db, col);
  if (!detail) return err(`id 不存在: ${id}`, 404);

  return ok({
    ...detail,
    vectorPreviewDimensions: VECTOR_PREVIEW_DIMENSIONS,
    expectedDimensions: EMBEDDING_DIM,
  });
}

// ─── Action: search ──────────────────────────────────────────────

async function handleSearch(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return err("请求体必须是 JSON"); }

  const { query, topK, database, collection } = (body ?? {}) as {
    query?: unknown; topK?: unknown; database?: string; collection?: string;
  };

  if (typeof query !== "string" || query.trim() === "") return err("query 必须是非空字符串");

  const db = database || SHARED_DB;
  const col = collection || SHARED_COLLECTION;

  const safe = await getCollectionSafe(db, col);
  if (!safe) return ok({ query: "", topK: 0, results: [], embeddingDims: 0 });

  const count = await safe.count();
  const topKNum = Math.min(count, 100);

  let queryVec: number[];
  try {
    const { embedding } = await embed({
      model: glm.embeddingModel("embedding-3"),
      value: query,
    });
    queryVec = embedding;
  } catch (e) {
    return err(`embedding 失败: ${(e as Error).message}`, 502);
  }

  const results = await searchRelevant(queryVec, topKNum, {
    databases: [
      { database: db, collection: col },
    ],
  });

  // FTS 关键词搜索（精确匹配）
  const ftsRes = await safe.get({
    whereDocument: { $contains: query } as WhereDocument,
    limit: count,
    include: ["documents", "metadatas"],
  });

  const ftsIds = new Set(ftsRes.ids);
  const ftsResults = ftsRes.ids.map((id, i) => ({
    id,
    content: ftsRes.documents?.[i] ?? "",
    similarity: 1.0,
    metadata: (ftsRes.metadatas?.[i] ?? {}) as Record<string, string | number | boolean | null>,
  }));

  // 合并：FTS 在前，语义在后（去重，过滤低相似度）
  const semanticFiltered = results.filter((r) => !ftsIds.has(r.id ?? "") && r.similarity > 0.3);
  const merged = [...ftsResults, ...semanticFiltered];

  merged.sort((a, b) => {
    const ca = (a.metadata?.createdAt as number) ?? 0;
    const cb = (b.metadata?.createdAt as number) ?? 0;
    return cb - ca;
  });
  merged.sort((a, b) => b.similarity - a.similarity);

  return ok({ query, topK: topKNum, results: merged, embeddingDims: queryVec.length });
}

// ─── Action: compact ─────────────────────────────────────────────

async function handleCompact(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return err("请求体必须是 JSON"); }

  const { database, collection } = (body ?? {}) as { database?: string; collection?: string };

  if (!database || !collection) {
    return err("database 和 collection 必填");
  }

  const result = await compactCollection(database, collection);
  return ok(result);
}

// ─── Action: delete ──────────────────────────────────────────────

async function handleDelete(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return err("请求体必须是 JSON"); }

  const { database, collection, id, ids } = (body ?? {}) as {
    database?: string; collection?: string; id?: string; ids?: string[];
  };

  const db = database || SHARED_DB;
  const col = collection || SHARED_COLLECTION;
  if (!db || !col) return err("database 和 collection 必填");

  const targets = id ? [id] : (ids || []);
  if (targets.length === 0) return err("id 或 ids 必填");

  const safe = await getCollectionSafe(db, col);
  if (!safe) return err(`collection 不存在: ${db}/${col}`, 404);

  await safe.delete({ ids: targets });
  return ok({ deleted: targets.length, database: db, collection: col });
}

// ─── Action: collections ──────────────────────────────────────────

async function handleCollections(req: NextRequest) {
  const url = new URL(req.url);
  const database = url.searchParams.get("database") || SHARED_DB;

  try {
    const res = await fetch(
      `http://localhost:8000/api/v2/tenants/default_tenant/databases/${database}/collections`,
    );
    const cols = await res.json();
    const names = cols.map((c: { name: string }) => c.name);
    return ok({ database, collections: names });
  } catch (e) {
    return err(`获取 collections 失败: ${(e as Error).message}`, 500);
  }
}

// ─── 路由分发 ───────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    switch (action) {
      case "list": return await handleList(req);
      case "show": return await handleShow(req);
      case "stats": return await handleStats(req);
      case "collections": return await handleCollections(req);
      default: return err(`未知 action: ${action ?? "(未提供)"}。可选: list | show | stats | collections`);
    }
  } catch (e) {
    console.error("[admin/chroma] GET 错误:", e);
    return err(`服务器错误: ${(e as Error).message}`, 500);
  }
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    switch (action) {
      case "search": return await handleSearch(req);
      case "delete": return await handleDelete(req);
      case "compact": return await handleCompact(req);
      default: return err(`POST 仅支持 action=search | delete | compact,收到: ${action ?? "(未提供)"}`);
    }
  } catch (e) {
    console.error("[admin/chroma] POST 错误:", e);
    return err(`服务器错误: ${(e as Error).message}`, 500);
  }
}