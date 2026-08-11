import { writeConversation } from "@/lib/conversation-store";

export async function POST(req: Request) {
  const { id, title, messages, model } = await req.json();
  if (!id || !messages) {
    return Response.json({ error: "id 和 messages 必填" }, { status: 400 });
  }

  console.log(`[conv:save] id=${id} title="${title || ""}" messages=${messages.length} model=${model || "deepseek"}`);
  writeConversation(id, title, messages, model);
  return Response.json({ ok: true, id });
}