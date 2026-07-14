import { ChromaClient } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embed } from "ai";

const SHARED_DB = "shared";
const CHAT_DB = "chat";
const SHARED_COLLECTION = "base_knowledge";
const CHAT_COLLECTION = "chat_knowledge";
const DISTANCE_FUNCTION = "cosine";
const EMBEDDING_MODEL = process.env.GLM_EMBEDDING_MODEL || "embedding-3";
const EMBED_MAX_RETRIES = 3;
const GLM_BASE_URL = process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";

const embeddingFunction = new DefaultEmbeddingFunction();

const glm = createOpenAICompatible({
  name: "glm",
  baseURL: GLM_BASE_URL,
  apiKey: process.env.GLM_API_KEY,
});

const clientCache = new Map();
const collectionCache = new Map();
let chatCollectionsCache = { data: null, ts: 0 };

export function getChromaClient(database = SHARED_DB) {
  if (!clientCache.has(database)) {
    clientCache.set(database, new ChromaClient({
      host: "localhost", port: 8000, ssl: false,
      database,
    }));
  }
  return clientCache.get(database);
}

export async function getCollection(database, collectionName) {
  const key = `${database}:${collectionName}`;
  if (collectionCache.has(key)) return collectionCache.get(key);
  const client = getChromaClient(database);
  const col = await client.getOrCreateCollection({
    name: collectionName,
    metadata: { "hnsw:space": DISTANCE_FUNCTION },
    embeddingFunction,
  });
  collectionCache.set(key, col);
  return col;
}

export async function embedText(text) {
  let lastErr;
  for (let attempt = 1; attempt <= EMBED_MAX_RETRIES; attempt++) {
    try {
      const { embedding } = await embed({
        model: glm.embeddingModel(EMBEDDING_MODEL),
        value: text,
      });
      return embedding;
    } catch (err) {
      lastErr = err;
      const waitMs = 1000 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error(`智谱 embedding 调用失败(已重试 ${EMBED_MAX_RETRIES} 次): ${lastErr?.message}`);
}

export async function searchCollection(queryVec, database, collectionName, nResults) {
  const col = await getCollection(database, collectionName);
  const res = await col.query({
    queryEmbeddings: [queryVec],
    nResults,
    where: { deleted: { $ne: true } },
  });
  const documents = res.documents?.[0] ?? [];
  const distances = res.distances?.[0] ?? [];
  const ids = res.ids?.[0] ?? [];
  return documents.map((content, i) => ({
    id: ids[i], content, similarity: 1 - (distances[i] ?? 0), database, collection: collectionName,
  }));
}

export async function listChatCollections() {
  if (chatCollectionsCache.data && Date.now() - chatCollectionsCache.ts < 60000) {
    return chatCollectionsCache.data;
  }
  const client = getChromaClient(CHAT_DB);
  const cols = await client.listCollections();
  chatCollectionsCache.data = (cols || []).map(c => c.name);
  chatCollectionsCache.ts = Date.now();
  return chatCollectionsCache.data;
}

export async function listCollectionsForDb(database) {
  const client = getChromaClient(database);
  const cols = await client.listCollections();
  return (cols || []).map(c => c.name);
}

export async function searchChroma(query, topK = 8) {
  const queryVec = await embedText(query);

  const targets = [
    { database: SHARED_DB, collection: SHARED_COLLECTION },
  ];

  const chatCollections = await listChatCollections().catch(() => [CHAT_COLLECTION]);
  for (const col of chatCollections) {
    targets.push({ database: CHAT_DB, collection: col });
  }

  const perCollection = topK * 3;
  const allResults = await Promise.all(
    targets.map((t) => searchCollection(queryVec, t.database, t.collection, perCollection)),
  );
  const merged = allResults.flat().sort((a, b) => b.similarity - a.similarity).slice(0, topK);

  return merged.map((r) => r.content).join("\n\n");
}