/**
 * 一致性校验脚本
 * ============================================================================
 *
 * 对比旧 JSON cosine(JS 手写)与新 Chroma cosine 在同一组查询下的 Top-K 结果。
 * 目的:验证迁移后检索语义未漂移。
 *
 * 通过标准:
 *   - ≥ 80% 的查询,其 Top-3 至少有 2 个 chunk 重叠(内容相同)
 *   - 因为 Chroma HNSW 是近似搜索,小幅 divergence 是正常的
 *
 * 用法:
 *   npx tsx scripts/verify-migration.ts
 * ============================================================================
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { embed } from "ai";
import { glm } from "../src/lib/ai/providers";
import { ChromaClient } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import { loadNetworkConfig } from "@shared/network.js";

// 从 config/network.json 读 chroma host+port（共享读取器）
const NET_CONFIG = loadNetworkConfig();
const CHROMA_URL = `http://${NET_CONFIG.hosts.local}:${NET_CONFIG.ports.chroma}`;
const COLLECTION_NAME = "java_knowledge";
const TOP_K = 3;
const PASS_OVERLAP = 2;       // Top-K 中至少有几个重叠才算"通过"
const PASS_RATE = 0.8;        // 通过率阈值

const TEST_QUERIES = [
  "Java 中接口和抽象类的区别",
  "HashMap 的工作原理",
  "Java 异常处理机制",
  "泛型是什么",
  "Stream API 怎么用",
  "多线程的实现方式",
  "JVM 内存模型",
  "Spring IoC 容器",
  "String 不可变的原因",
  "volatile 关键字的作用",
];

// ─── 工具:旧 cosine 实现 ─────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`向量维度不一致:${a.length} vs ${b.length}`);
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function topKByCosine(
  queryVec: number[],
  records: { content: string; embedding: number[] }[],
  k: number,
): string[] {
  return records
    .map((r) => ({ content: r.content, score: cosineSimilarity(queryVec, r.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((r) => r.content);
}

// ─── 主流程 ─────────────────────────────────────────────────────

async function main() {
  console.log("🧪 一致性校验启动\n");

  // 1. 读旧 JSON
  console.log("📖 加载旧 embeddings.json ...");
  const raw = await readFile(join(process.cwd(), "data", "embeddings.json"), "utf-8");
  const jsonRecords: { content: string; embedding: number[] }[] = JSON.parse(raw);
  console.log(`✅ ${jsonRecords.length} 条记录\n`);

  // 2. 连 Chroma
  console.log("🔌 连接 Chroma ...");
  const client = new ChromaClient({
    host: new URL(CHROMA_URL).hostname,
    port: parseInt(new URL(CHROMA_URL).port || "8000", 10),
    ssl: new URL(CHROMA_URL).protocol === "https:",
  });
  const col = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction: new DefaultEmbeddingFunction(),
  });
  console.log(`✅ Chroma collection "${COLLECTION_NAME}" 已就绪\n`);

  // 3. 跑每个查询
  let passCount = 0;
  const results: { query: string; overlap: number; passed: boolean }[] = [];

  for (const query of TEST_QUERIES) {
    // 3a. embed
    const { embedding: queryVec } = await embed({
      model: glm.embeddingModel("embedding-3"),
      value: query,
    });

    // 3b. 旧 cosine Top-K
    const jsonTop = topKByCosine(queryVec, jsonRecords, TOP_K);

    // 3c. Chroma Top-K
    const chromaRes = await col.query({
      queryEmbeddings: [queryVec],
      nResults: TOP_K,
    });
    const chromaTop = (chromaRes.documents?.[0] ?? []).filter(
      (d): d is string => d !== null,
    ).slice(0, TOP_K);

    // 3d. 计算重叠
    const overlap = chromaTop.filter((c) => jsonTop.includes(c)).length;
    const passed = overlap >= PASS_OVERLAP;
    if (passed) passCount++;

    results.push({ query, overlap, passed });

    const marker = passed ? "✅" : "❌";
    console.log(`${marker} [overlap=${overlap}/${TOP_K}] ${query}`);
  }

  // 4. 总结
  const passRate = passCount / TEST_QUERIES.length;
  console.log(`\n📊 通过率:${passCount}/${TEST_QUERIES.length} = ${(passRate * 100).toFixed(1)}%`);
  console.log(`📏 通过阈值:${PASS_RATE * 100}% (Top-${TOP_K} 至少 ${PASS_OVERLAP} 个重叠)\n`);

  if (passRate >= PASS_RATE) {
    console.log("🎉 一致性校验通过!");
    console.log("   Chroma 与旧 JSON cosine 检索结果高度一致。");
    console.log("   可以放心删除旧 data/embeddings.json。\n");
    process.exit(0);
  } else {
    console.log("⚠️  一致性校验未通过。可能原因:");
    console.log("   1. embedding 模型变了(检查是否都用 embedding-3)");
    console.log("   2. JSON 中向量本身有问题");
    console.log("   3. Chroma 距离函数配置错误(应为 cosine)");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ 出错:", err);
  process.exit(1);
});