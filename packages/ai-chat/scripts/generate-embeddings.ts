/**
 * 一次性迁移脚本:data/embeddings.json → Chroma
 * ============================================================================
 *
 * 背景:
 *   - 旧版 RAG 把 chunk + 预计算向量存到 data/embeddings.json(4.2 MB)
 *   - 升级到 Chroma 后,本脚本把已有向量一次性 upsert 到 Chroma collection
 *   - 后续 RAG 流程不再读 JSON
 *
 * 用法:
 *   npx tsx scripts/generate-embeddings.ts              # 默认迁移
 *   npx tsx scripts/generate-embeddings.ts --reset      # 先清空 collection 再迁
 *
 * 优势:
 *   - 不需要重新 embed(向量已在 JSON 中预计算好),秒级完成
 *   - 复用现有智谱 embedding-3 的 2048 维向量,与 Chroma collection 维度匹配
 *
 * 数据形状:
 *   data/embeddings.json: [{content: string, embedding: number[]}]
 *   → Chroma record:
 *       id        = sha1(content)[:16]  (稳定 hash,重复运行幂等)
 *       document  = content
 *       embedding = 预计算向量
 *       metadata  = {source: "migrated", charCount: number, migratedAt: epoch_ms}
 * ============================================================================
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ChromaClient } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import { loadNetworkConfig } from "@shared/network.js";

// 从 config/network.json 读 chroma host+port（共享读取器）
const NET_CONFIG = loadNetworkConfig();
const CHROMA_URL = `http://${NET_CONFIG.hosts.local}:${NET_CONFIG.ports.chroma}`;

/** Chroma collection 名(必须与 vector-store.ts 一致)。 */
const COLLECTION_NAME = "java_knowledge";

/** 旧 JSON 文件路径。 */
const LEGACY_JSON = join(process.cwd(), "data", "embeddings.json");

/** 智谱 embedding-3 向量维度。 */
const EMBEDDING_DIM = 2048;

/** 批量插入大小(Chroma 限制 5461,保守取 1000)。 */
const BATCH_SIZE = 1_000;

/**
 * 生成稳定的 id(sha1 前 16 位)。
 * - 同一 content 永远得到同一 id,允许重复执行幂等
 * - 16 位 hex = 64 bit,冲突概率极低
 */
function stableId(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

// ─── 解析命令行参数 ───────────────────────────────────────────────

const args = process.argv.slice(2);
const RESET_MODE = args.includes("--reset");

// ─── 主流程 ─────────────────────────────────────────────────────

async function main() {
  console.log("🚀 迁移脚本启动...");
  console.log(`📂 源文件: ${LEGACY_JSON}`);
  console.log(`🎯 目标 collection: ${COLLECTION_NAME}`);
  console.log(`🔗 Chroma: ${CHROMA_URL}`);
  console.log(`🧹 reset 模式: ${RESET_MODE ? "是" : "否"}\n`);

  // 1. 读取 JSON
  console.log("📖 读取 embeddings.json ...");
  const raw = await readFile(LEGACY_JSON, "utf-8");
  const records: { content: string; embedding: number[] }[] = JSON.parse(raw);
  console.log(`✅ 共 ${records.length} 条记录`);

  // 2. 校验维度
  const sample = records[0];
  if (!sample || sample.embedding.length !== EMBEDDING_DIM) {
    throw new Error(
      `❌ 向量维度异常: 期望 ${EMBEDDING_DIM},实际 ${sample?.embedding?.length}。` +
        `请确认 data/embeddings.json 是用 embedding-3 生成的。`,
    );
  }
  console.log(`✅ 向量维度: ${sample.embedding.length} (符合 embedding-3)\n`);

  // 3. 连接 Chroma
  console.log("🔌 连接 Chroma ...");
  const client = new ChromaClient({
    host: new URL(CHROMA_URL).hostname,
    port: parseInt(new URL(CHROMA_URL).port || "8000", 10),
    ssl: new URL(CHROMA_URL).protocol === "https:",
  });

  // 4. 可选:重置 collection
  if (RESET_MODE) {
    console.log("🧹 删除已有 collection ...");
    try {
      await client.deleteCollection({ name: COLLECTION_NAME });
      console.log("✅ 已删除");
    } catch (err) {
      console.warn(`⚠️  collection 可能不存在,继续: ${(err as Error).message}`);
    }
  }

  // 5. 获取或创建 collection
  console.log("📦 获取 collection ...");
  const col = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: { "hnsw:space": "cosine" },
    embeddingFunction: new DefaultEmbeddingFunction(),
  });
  console.log("✅ collection 就绪\n");

  // 6. 批量 upsert
  console.log("📤 开始批量 upsert ...");
  const total = records.length;
  const migratedAt = Date.now();
  const startTime = Date.now();

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const batch = records.slice(offset, offset + BATCH_SIZE);
    const ids = batch.map((r) => stableId(r.content));
    const documents = batch.map((r) => r.content);
    const embeddings = batch.map((r) => r.embedding);
    const metadatas = batch.map((r) => ({
      source: "migrated-from-json",
      charCount: r.content.length,
      migratedAt,
      deleted: false, // 与 chroma-server addKnowledge 保持一致,显式标记未软删
    }));

    // 用 upsert 而非 add:重复运行不会冲突
    await col.upsert({ ids, documents, embeddings, metadatas });

    const pct = (((offset + batch.length) / total) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `✅ [${pct}%] ${offset + batch.length}/${total} (${elapsed}s)`,
    );
  }

  // 7. 校验
  const finalCount = await col.count();
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n🎉 迁移完成!`);
  console.log(`   总耗时: ${totalTime}s`);
  console.log(`   Chroma collection "${COLLECTION_NAME}" 当前记录数: ${finalCount}`);
  console.log(`\n💡 接下来你可以:`);
  console.log(`   - 启动 ai-chat: cd .. && npm run dev`);
  console.log(`   - 浏览器测试 RAG 检索`);
  console.log(`   - 让 AI 调 addKnowledge / searchKnowledge 测试 CRUD`);
  console.log(`   - 确认无误后删除旧文件: rm ${LEGACY_JSON}`);
}

main().catch((err) => {
  console.error("❌ 出错:", err);
  process.exit(1);
});