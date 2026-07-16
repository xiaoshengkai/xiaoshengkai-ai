import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "..", "..", "data", "conversations");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export async function GET() {
  console.log("[conv:getList] 获取对话列表");
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  const list = files
    .map(f => {
      const raw = fs.readFileSync(path.join(DATA_DIR, f), "utf-8");
      const data = JSON.parse(raw);
      return {
        id: data.id,
        title: data.title || "未命名对话",
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        pinned: data.pinned || false,
      };
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  console.log(`[conv:getList] 返回 ${list.length} 个对话`);
  return Response.json(list);
}