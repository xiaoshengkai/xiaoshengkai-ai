import { readConversation } from "@/lib/conversation-store";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id 必填" }, { status: 400 });

  console.log(`[conv:getDetail] id=${id}`);
  const record = readConversation(id);
  if (!record) return Response.json({ error: "对话不存在" }, { status: 404 });
  return Response.json(record);
}