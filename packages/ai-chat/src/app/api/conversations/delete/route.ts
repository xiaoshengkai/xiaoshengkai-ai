import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "..", "..", "data", "conversations");

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id 必填" }, { status: 400 });

  console.log(`[conv:delete] id=${id}`);
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return Response.json({ error: "对话不存在" }, { status: 404 });
  }

  fs.unlinkSync(filePath);
  return Response.json({ ok: true });
}