import { readConversation, deleteConversation } from "@/lib/store/conversation-store";

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id 必填" }, { status: 400 });

  console.log(`[conv:delete] id=${id}`);
  if (!readConversation(id)) {
    return Response.json({ error: "对话不存在" }, { status: 404 });
  }
  deleteConversation(id);
  return Response.json({ ok: true });
}