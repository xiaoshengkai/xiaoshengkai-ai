import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "..", "..", "data", "conversations");

export async function POST(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const pinned = url.searchParams.get("pinned") === "true";
  if (!id) return Response.json({ error: "id 必填" }, { status: 400 });

  console.log(`[conv:pin] id=${id} pinned=${pinned}`);
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return Response.json({ error: "对话不存在" }, { status: 404 });
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);
  data.pinned = pinned;
  data.updatedAt = Date.now();

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return Response.json({ ok: true });
}