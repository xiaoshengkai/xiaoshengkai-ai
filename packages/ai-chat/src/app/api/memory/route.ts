import { generateText, embed } from "ai";
import { randomUUID } from "crypto";
import { getCollection, CHAT_DB, CHAT_COLLECTION } from "@/lib/rag/vector-store";
import { glm, deepseek } from "@/lib/ai/providers";

export async function POST(req: Request) {
  try {
    const { content } = await req.json();
    if (!content || typeof content !== "string") {
      return Response.json({ error: "content is required" }, { status: 400 });
    }

    const { text: compressed } = await generateText({
      model: deepseek(process.env.DEEPSEEK_FLASH_MODEL || "deepseek-v4-flash"),
      prompt: `请将以下对话内容提炼为一条简洁的知识笔记，保留核心信息、关键结论和所有媒体信息（图片、视频、图表等）：\n\n${content}`,
    });

    const { embedding } = await embed({
      model: glm.embeddingModel("embedding-3"),
      value: compressed,
    });

    const col = await getCollection(CHAT_DB, CHAT_COLLECTION);
    const id = randomUUID();
    await col.add({
      ids: [id],
      embeddings: [embedding as number[]],
      documents: [compressed],
      metadatas: [{ createdAt: Date.now(), deleted: false, source: "user-adopted" }],
    });

    return Response.json({ ok: true, data: { id, charCount: compressed.length } });
  } catch (error) {
    console.error("POST /api/memory error:", error);
    return Response.json({ error: "保存失败，请重试" }, { status: 500 });
  }
}