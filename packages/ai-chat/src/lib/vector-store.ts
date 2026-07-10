/**
 * 向量存储 — Chroma 多库版
 * ============================================================================
 *
 * 支持多数据库架构:
 *   - shared/base_knowledge  — 共享知识库，所有上下文可读
 *   - chat/chat_knowledge    — 聊天产生的知识
 *   - code/<project>         — 编码工具按项目隔离
 *
 * 本模块封装 Chroma HTTP 客户端的"读路径":
 *   - getChromaClient(db)  单例 Chroma 客户端(按数据库缓存)
 *   - getCollection(db, col)  获取/创建 collection
 *   - searchRelevant()      Top-K 检索(支持跨库合并)
 *   - purgeExpiredSoftDeletes()  懒清理软删记录
 *
 * 写路径由 MCP server (chroma.js) 负责。
 * ============================================================================
 */

import { ChromaClient, type Collection, type Where } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import { generateText } from "ai";
import { deepseek } from "@/lib/providers";

// ─── 数据库常量 ─────────────────────────────────────────────────────

export const SHARED_DB = process.env.CHROMA_SHARED_DB ?? "shared";
export const CHAT_DB = process.env.CHROMA_CHAT_DB ?? "chat";
export const CODE_DB = process.env.CHROMA_CODE_DB ?? "code";

export const SHARED_COLLECTION = "base_knowledge";
export const CHAT_COLLECTION = "chat_knowledge";

// ─── 动态 collection 列表（带缓存）──────────────────────────────────

const _collectionsCache: Record<string, { data: string[]; ts: number }> = {};
const COLLECTIONS_CACHE_TTL = 60_000;

export async function listCollections(database: string): Promise<string[]> {
  const cached = _collectionsCache[database];
  if (cached && Date.now() - cached.ts < COLLECTIONS_CACHE_TTL) return cached.data;
  try {
    const res = await fetch(
      `http://localhost:8000/api/v2/tenants/default_tenant/databases/${database}/collections`,
    );
    const cols = await res.json();
    const names = cols.map((c: { name: string }) => c.name);
    _collectionsCache[database] = { data: names, ts: Date.now() };
    return names;
  } catch {
    return [];
  }
}

// ─── 常量(集中管理) ─────────────────────────────────────────────────

export const EMBEDDING_DIM = 2048;
export const DISTANCE_FUNCTION: "cosine" | "l2" | "ip" = "cosine";
export const TOP_K_DEFAULT = 3;
export const SOFT_DELETE_WINDOW_MS = 3_000;

function parseChromaUrl(url: string): { host: string; port: number; ssl: boolean } {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 8000,
    ssl: u.protocol === "https:",
  };
}

const _chromaConn = parseChromaUrl(process.env.CHROMA_URL ?? "http://localhost:8000");

// ─── 类型定义 ───────────────────────────────────────────────────────

export interface ChunkEmbedding {
  id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SearchResult {
  content: string;
  similarity: number;
  id?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

const NOT_SOFT_DELETED = { deleted: { $ne: true } } as Where;

// ─── 客户端缓存(按数据库名) ─────────────────────────────────────────

const clientCache = new Map<string, ChromaClient>();
const collectionCache = new Map<string, Collection>();

function getCacheKey(db: string, col: string) {
  return `${db}:${col}`;
}

export function getChromaClient(database?: string): ChromaClient {
  const db = database ?? SHARED_DB;
  if (!clientCache.has(db)) {
    clientCache.set(db, new ChromaClient({
      host: _chromaConn.host,
      port: _chromaConn.port,
      ssl: _chromaConn.ssl,
      database: db,
    }));
  }
  return clientCache.get(db)!;
}

export function _resetChromaClientForTesting(): void {
  clientCache.clear();
  collectionCache.clear();
}

// ─── Collection 获取/创建 ───────────────────────────────────────────

async function getCollectionDimension(col: Collection): Promise<number | null> {
  try {
    const peek = await col.peek({ limit: 1 });
    if (!peek.embeddings || peek.embeddings.length === 0) return null;
    const first = peek.embeddings[0];
    return Array.isArray(first) ? first.length : null;
  } catch {
    return null;
  }
}

export async function getCollection(
  database?: string,
  collectionName?: string,
): Promise<Collection> {
  const db = database ?? SHARED_DB;
  const col = collectionName ?? SHARED_COLLECTION;
  console.log(`[chroma:getCollection] db=${db} col=${col} caller=${new Error().stack?.split('\n')[2]?.trim()}`);
  const key = getCacheKey(db, col);

  if (collectionCache.has(key)) return collectionCache.get(key)!;

  const client = getChromaClient(db);
  const collection = await client.getOrCreateCollection({
    name: col,
    metadata: { "hnsw:space": DISTANCE_FUNCTION },
    embeddingFunction: new DefaultEmbeddingFunction(),
  });

  const dim = await getCollectionDimension(collection);
  if (dim !== null && dim !== EMBEDDING_DIM) {
    throw new Error(
      `Chroma collection "${db}/${col}" 维度不匹配: ` +
      `期望 ${EMBEDDING_DIM},实际 ${dim}。`,
    );
  }

  collectionCache.set(key, collection);
  return collection;
}

/** 获取 collection，不存在时返回 null（不自动创建）。 */
export async function getCollectionSafe(
  database?: string,
  collectionName?: string,
): Promise<Collection | null> {
  const db = database ?? SHARED_DB;
  const col = collectionName ?? SHARED_COLLECTION;
  const key = getCacheKey(db, col);

  if (collectionCache.has(key)) return collectionCache.get(key)!;

  const client = getChromaClient(db);
  try {
    const collection = await client.getCollection({
      name: col,
      embeddingFunction: new DefaultEmbeddingFunction(),
    });
    collectionCache.set(key, collection);
    return collection;
  } catch {
    return null;
  }
}

// ─── 懒清理 ─────────────────────────────────────────────────────────

export async function purgeExpiredSoftDeletes(
  database?: string,
  collectionName?: string,
): Promise<number> {
  const col = await getCollection(database, collectionName);
  const expired: string[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const page = await col.get({
      where: { deleted: { $eq: true } } as Where,
      limit: pageSize,
      offset,
      include: ["metadatas"],
    });
    if (page.ids.length === 0) break;

    const now = Date.now();
    for (let i = 0; i < page.ids.length; i++) {
      const deletedAt = page.metadatas?.[i]?.deletedAt;
      if (typeof deletedAt === "number" && now - deletedAt > SOFT_DELETE_WINDOW_MS) {
        expired.push(page.ids[i]);
      }
    }

    if (page.ids.length < pageSize) break;
    offset += pageSize;
  }

  if (expired.length === 0) return 0;
  await col.delete({ ids: expired });
  return expired.length;
}

// ─── 检索 ───────────────────────────────────────────────────────────

export interface SearchConfig {
  database?: string;
  collection?: string;
}

export interface CrossDbSearchConfig {
  databases: SearchConfig[];
  topK?: number;
}

async function searchOneCollection(
  queryEmbedding: number[],
  config: SearchConfig,
  topK: number,
): Promise<SearchResult[]> {
  try {
    await purgeExpiredSoftDeletes(config.database, config.collection);
  } catch (err) {
    console.warn("[vector-store] 懒清理软删失败:", err);
  }

  const col = await getCollection(config.database, config.collection);
  const res = await col.query({
    queryEmbeddings: [queryEmbedding],
    nResults: topK,
    where: NOT_SOFT_DELETED,
  });

  const documents = (res.documents?.[0] ?? []).filter((d): d is string => d !== null);
  const distances = res.distances?.[0] ?? [];
  const ids = res.ids?.[0] ?? [];
  const metadatas = (res.metadatas?.[0] ?? []).filter(
    (m): m is Record<string, string | number | boolean | null> => m !== null,
  );

  return documents.map((content, i) => ({
    content,
    similarity: 1 - (distances[i] ?? 0),
    id: ids[i],
    metadata: metadatas[i],
  }));
}

export async function searchRelevant(
  queryEmbedding: number[],
  topK: number = TOP_K_DEFAULT,
  configs?: CrossDbSearchConfig,
): Promise<SearchResult[]> {
  if (queryEmbedding.length !== EMBEDDING_DIM) {
    throw new Error(
      `queryEmbedding 维度错误: 期望 ${EMBEDDING_DIM},实际 ${queryEmbedding.length}。`,
    );
  }

  const targets = configs?.databases?.length
    ? configs.databases
    : [{ database: SHARED_DB, collection: SHARED_COLLECTION }];

  const results = await Promise.all(
    targets.map((c) => searchOneCollection(queryEmbedding, c, topK)),
  );

  const merged = results.flat().sort((a, b) => b.similarity - a.similarity);
  return merged.slice(0, topK);
}

// ─── 内部工具 ───────────────────────────────────────────────────────

export async function getCollectionStats(
  database?: string,
  collectionName?: string,
): Promise<{ name: string; count: number; dimension: number | null; database: string }> {
  const col = await getCollection(database, collectionName);
  const count = await col.count();
  const dimension = await getCollectionDimension(col);
  return {
    name: collectionName ?? SHARED_COLLECTION,
    count,
    dimension,
    database: database ?? SHARED_DB,
  };
}

// ─── 管理面板专用 API ───────────────────────────────────────────────

export interface ChunkRow {
  id: string;
  content: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: number | null;
  charCount: number | null;
  source: string | null;
  deleted: boolean;
  deletedAt: number | null;
}

export interface ChunkDetail extends ChunkRow {
  vectorPreview: number[];
  totalDimensions: number;
}

export interface ListChunksOptions {
  includeDeleted?: boolean;
  database?: string;
  collection?: string;
}

export interface ListChunksResult {
  chunks: ChunkRow[];
}

export const ADMIN_PAGE_SIZE_DEFAULT = 20;

export async function listAllChunks(
  opts: ListChunksOptions = {},
): Promise<ListChunksResult> {
  const includeDeleted = opts.includeDeleted ?? false;
  const col = await getCollection(opts.database, opts.collection);

  const where = includeDeleted ? undefined : { deleted: { $ne: true } } as Where;
  const total = await col.count();
  const limit = Math.max(total, 1);

  const page = await col.get({
    limit,
    offset: 0,
    include: ["documents", "metadatas"],
    where,
  });
  console.log(`[admin:listAllChunks] db=${opts.database} col=${opts.collection} total=${total} returned=${page.ids.length}`);
  const ids = page.ids;
  const documents = (page.documents ?? []).filter((d): d is string => d !== null);
  const metadatas = (page.metadatas ?? []).filter(
    (m): m is Record<string, string | number | boolean | null> => m !== null,
  );

  const rows: ChunkRow[] = ids.map((id, i) => {
    const meta = metadatas[i] ?? {};
    const createdAt =
      typeof meta.createdAt === "number"
        ? meta.createdAt
        : typeof meta.migratedAt === "number"
          ? meta.migratedAt
          : null;
    const deleted = meta.deleted === true;
    const deletedAt = typeof meta.deletedAt === "number" ? meta.deletedAt : null;
    return {
      id,
      content: documents[i] ?? "",
      metadata: meta,
      createdAt,
      charCount: typeof meta.charCount === "number" ? meta.charCount : null,
      source: typeof meta.source === "string" ? meta.source : null,
      deleted,
      deletedAt,
    };
  });

  rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return { chunks: rows };
}

export async function getChunkById(
  id: string,
  database?: string,
  collectionName?: string,
): Promise<ChunkDetail | null> {
  const col = await getCollection(database, collectionName);
  const res = await col.get({
    ids: [id],
    include: ["documents", "metadatas", "embeddings"],
  });

  if (res.ids.length === 0) return null;

  const meta = (res.metadatas?.[0] ?? {}) as Record<string, string | number | boolean | null>;
  const doc = res.documents?.[0] ?? "";
  const embedding = res.embeddings?.[0];

  const createdAt = typeof meta.createdAt === "number" ? meta.createdAt : null;
  const deleted = meta.deleted === true;
  const deletedAt = typeof meta.deletedAt === "number" ? meta.deletedAt : null;

  let vectorPreview: number[] = [];
  let totalDimensions = 0;
  if (Array.isArray(embedding)) {
    totalDimensions = embedding.length;
    vectorPreview = embedding.slice(0, 20);
  }

  return {
    id: res.ids[0],
    content: doc,
    metadata: meta,
    createdAt,
    charCount: typeof meta.charCount === "number" ? meta.charCount : null,
    source: typeof meta.source === "string" ? meta.source : null,
    deleted,
    deletedAt,
    vectorPreview,
    totalDimensions,
  };
}

export const VECTOR_PREVIEW_DIMENSIONS = 20;

// ─── 整理数据 ───────────────────────────────────────────────────────

export interface CompactResult {
  before: number;
  removed: number;
  after: number;
}

export async function compactCollection(
  database: string,
  collectionName: string,
): Promise<CompactResult> {
  const col = await getCollection(database, collectionName);

  const total = await col.count();
  const all = await col.get({
    limit: Math.max(total, 1),
    include: ["embeddings", "metadatas", "documents"],
    where: NOT_SOFT_DELETED,
  });

  if (all.ids.length < 2) {
    return { before: all.ids.length, removed: 0, after: all.ids.length };
  }

  const ids = all.ids;
  const embeddings = all.embeddings as number[][];
  const metadatas = all.metadatas as Record<string, string | number | boolean | null>[];
  const documents = (all.documents ?? []) as string[];

  const toRemove = new Set<string>();

  // Phase 1: 规则过滤
  for (let i = 0; i < ids.length; i++) {
    const content = documents[i] ?? "";
    if (content.trim().length < 20) { toRemove.add(ids[i]); continue; }
    if (/^[a-zA-Z0-9\s\.,;:!?\-'"]+$/.test(content)) { toRemove.add(ids[i]); continue; }
    if (/(.)\1{10,}/.test(content)) { toRemove.add(ids[i]); continue; }
  }

  // Phase 2: 余弦去重(> 0.89)
  const SIMILARITY_THRESHOLD = 0.89;

  for (let i = 0; i < ids.length; i++) {
    if (toRemove.has(ids[i])) continue;
    for (let j = i + 1; j < ids.length; j++) {
      if (toRemove.has(ids[j])) continue;

      const ei = embeddings[i];
      const ej = embeddings[j];
      if (!ei || !ej) continue;

      let dot = 0;
      let normI = 0;
      let normJ = 0;
      for (let k = 0; k < ei.length; k++) {
        dot += ei[k] * ej[k];
        normI += ei[k] * ei[k];
        normJ += ej[k] * ej[k];
      }

      const similarity = dot / (Math.sqrt(normI) * Math.sqrt(normJ));
      if (similarity > SIMILARITY_THRESHOLD) {
        const ci = (metadatas[i]?.createdAt as number) ?? 0;
        const cj = (metadatas[j]?.createdAt as number) ?? 0;
        if (ci >= cj) {
          toRemove.add(ids[j]);
        } else {
          toRemove.add(ids[i]);
          break;
        }
      }
    }
  }

  // Phase 3: LLM 质量过滤
  const remaining = ids.filter((id) => !toRemove.has(id));
  if (remaining.length > 0) {
    try {
      const items = remaining.map((id) => {
        const idx = ids.indexOf(id);
        return `[${id}] ${(documents[idx] ?? "").slice(0, 200)}`;
      }).join("\n\n");

      const { text } = await generateText({
        model: deepseek("deepseek-v4-flash"),
        maxOutputTokens: 200,
        prompt: `分析以下知识条目，标记需要删除的。删除条件：无意义（太短、无信息量）、纯英文、碎片化、格式错误。返回 JSON：{"remove": ["id1", "id2"]}

条目：
${items}`,
      });

      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const { remove } = JSON.parse(match[0]);
        if (Array.isArray(remove)) remove.forEach((id: string) => toRemove.add(id));
      }
    } catch (err) {
      console.warn("[compact] LLM 质量过滤失败，跳过:", (err as Error).message);
    }
  }

  if (toRemove.size > 0) {
    await col.delete({ ids: Array.from(toRemove) });
  }

  return {
    before: ids.length,
    removed: toRemove.size,
    after: ids.length - toRemove.size,
  };
}

// ─── 向后兼容导出 ───────────────────────────────────────────────────

/** @deprecated 使用 getCollection(database, collectionName) */
export const COLLECTION_NAME = "java_knowledge";