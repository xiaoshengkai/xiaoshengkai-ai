import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(process.cwd(), "..", "..");

export async function handle({ params, request }) {
  const { id } = params || {};
  const { structure } = (await request.json().catch(() => ({}))) || {};
  if (!id) return { ok: false, error: "缺少执行 id" };
  if (!structure || typeof structure !== "object") return { ok: false, error: "缺少结构数据" };
  const dir = path.join(PROJECT_ROOT, "data", "workflows", "tasks", id);
  const file = path.join(dir, "structure.json");
  if (!fs.existsSync(file)) return { ok: false, error: "结构文件不存在，请先执行识别步骤" };
  const merged = { ...JSON.parse(fs.readFileSync(file, "utf-8")), ...structure, confirmed: true };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));

  const stateFile = path.join(dir, "state.json");
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    const parseStep = state.steps?.find(s => s.id === "parse");
    if (parseStep?.output) {
      const isString = typeof parseStep.output === "string";
      const out = isString ? JSON.parse(parseStep.output) : parseStep.output;
      out.structureJson = JSON.stringify(merged);
      parseStep.output = isString ? JSON.stringify(out) : out;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    }
  }

  return { ok: true };
}
