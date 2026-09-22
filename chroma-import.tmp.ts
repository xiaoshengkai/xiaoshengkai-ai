import { ChromaClient } from "chromadb";
import fs from "node:fs";

// 一次性迁移工具：base64 float32 JSON → chroma（多 database）
async function main() {
  const file = process.argv[2] || "/tmp/chroma-export.json";
  const data: { db: string; name: string; rows: { id: string; e: string; m: unknown; d: string | null }[] }[] =
    JSON.parse(fs.readFileSync(file, "utf8"));
  const base = "http://127.0.0.1:8000";
  const existing: { name: string }[] = await (
    await fetch(`${base}/api/v2/tenants/default_tenant/databases`)
  ).json();
  const dbNames = new Set(existing.map((d) => d.name));
  for (const db of new Set(data.map((c) => c.db))) {
    if (!dbNames.has(db)) {
      await fetch(`${base}/api/v2/tenants/default_tenant/databases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: db }),
      });
    }
  }
  for (const c of data) {
    const client = new ChromaClient({ host: "127.0.0.1", port: 8000, database: c.db } as ConstructorParameters<typeof ChromaClient>[0]);
    const col = await client.getOrCreateCollection({ name: c.name });
    for (let i = 0; i < c.rows.length; i += 500) {
      const batch = c.rows.slice(i, i + 500);
      await col.add({
        ids: batch.map((r) => r.id),
        embeddings: batch.map((r) => Array.from(new Float32Array(Uint8Array.from(Buffer.from(r.e, "base64")).buffer))),
        metadatas: batch.every((r) => r.m == null) ? undefined : (batch.map((r) => r.m) as never),
        documents: batch.every((r) => r.d == null) ? undefined : batch.map((r) => r.d ?? ""),
      });
    }
    console.log("imported", c.db, c.name, c.rows.length);
  }
  console.log("IMPORT DONE");
}
main();
