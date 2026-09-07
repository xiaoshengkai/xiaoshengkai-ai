import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(process.cwd(), "..", "..");

export async function handle(req) {
  const { id } = req.params || {};
  const { structure } = (await req.json()) || {};
  if (!id) return { ok: false, error: "缺少执行 id" };
  if (!structure || typeof structure !== "object") return { ok: false, error: "缺少结构数据" };
  const dir = path.join(PROJECT_ROOT, "data", "workflows", "tasks", id);
  const file = path.join(dir, "structure.json");
  if (!fs.existsSync(file)) return { ok: false, error: "结构文件不存在，请先执行识别步骤" };
  const merged = { ...JSON.parse(fs.readFileSync(file, "utf-8")), ...structure, confirmed: true };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  return { ok: true };
}
