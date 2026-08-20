/**
 * RAG 检索工具 — 跨库版
 * ============================================================================
 *
 * 在线流程:
 *   1. 接收用户查询字符串
 *   2. 调智谱 embedding-3 生成 2048 维查询向量
 *   3. 跨库检索 shared/base_knowledge + chat/chat_knowledge
 *   4. 返回 { content, index } 给 route.ts,后者注入 system prompt
 * ============================================================================
 */

import { embed } from "ai";
import { getEmbeddingModel } from "@/lib/core/embedding";
import { searchRelevant, SHARED_DB, SHARED_COLLECTION, CHAT_DB, CHAT_COLLECTION, TOP_K_DEFAULT, listCollections } from "@/lib/rag/vector-store";

export interface RetrievedChunk {
  content: string;
  index: number;
}

export async function retrieveRelevantChunks(
  query: string,
  topK: number = TOP_K_DEFAULT,
): Promise<RetrievedChunk[]> {
  if (!query) return [];
  const { embedding: queryVec } = await embed({
    model: getEmbeddingModel(),
    value: query,
  });

  const [sharedCols, chatCols] = await Promise.all([
    listCollections(SHARED_DB),
    listCollections(CHAT_DB),
  ]);
  const databases = [
    ...sharedCols.map((c) => ({ database: SHARED_DB, collection: c })),
    ...chatCols.map((c) => ({ database: CHAT_DB, collection: c })),
  ];

  const results = await searchRelevant(queryVec, topK, { databases });

  return results.map((r, index) => ({
    content: r.content,
    index,
  }));
}