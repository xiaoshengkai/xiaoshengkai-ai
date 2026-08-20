import { pinConversation } from "../_lib/store";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const pinned = url.searchParams.get("pinned") === "true";
  if (!id) return Response.json({ error: "id 必填" }, { status: 400 });

  console.log(`[conv:pin] id=${id} pinned=${pinned}`);
  const record = pinConversation(id, pinned);
  if (!record) return Response.json({ error: "对话不存在" }, { status: 404 });
  return Response.json({ ok: true });
}