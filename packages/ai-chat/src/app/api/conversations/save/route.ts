import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "..", "..", "data", "conversations");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { id, title, messages, model } = body;

  if (!id || !messages) {
    return Response.json({ error: "id 和 messages 必填" }, { status: 400 });
  }

  ensureDir();
  console.log(`[conv:save] id=${id} title="${title || ""}" messages=${messages.length} model=${model || "deepseek"}`);

  const filePath = path.join(DATA_DIR, `${id}.json`);
  const existing = fs.existsSync(filePath);
  const now = Date.now();

  const data: {
    id: string;
    title: string;
    createdAt?: number;
    updatedAt: number;
    model: string;
    messages: unknown;
    pinned?: boolean;
  } = {
    id,
    title: title || "未命名对话",
    createdAt: undefined,
    updatedAt: now,
    model: model || "deepseek",
    messages,
  };

  if (!existing) {
    data.createdAt = now;
    data.pinned = false;
  } else {
    const old = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    data.createdAt = old.createdAt;
    data.pinned = old.pinned || false;
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return Response.json({ ok: true, id });
}