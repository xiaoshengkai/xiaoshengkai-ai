import { renameConversation } from "../_lib/store";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const title = (url.searchParams.get("title") || "").trim().slice(0, 30);
  if (!id) return Response.json({ error: "id 必填" }, { status: 400 });
  if (!title) return Response.json({ error: "标题必填" }, { status: 400 });

  console.log(`[conv:rename] id=${id} title="${title}"`);
  const record = renameConversation(id, title);
  if (!record) return Response.json({ error: "对话不存在" }, { status: 404 });
  return Response.json({ ok: true });
}
