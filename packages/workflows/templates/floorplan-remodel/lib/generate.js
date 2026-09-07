import fs from "node:fs";
import path from "node:path";
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { renderPlan } from "./render.js";
import { loadWallMask, snapPoint } from "./snap.js";

const TIERS = [
  ["conservative", "保守（最小改动、造价低）"],
  ["balanced", "均衡（改动适中、收益明显）"],
  ["aggressive", "激进（大拆大建、空间重塑）"],
  ["creative", "创意（非常规思路）"],
  ["compact", "紧凑（极致利用每㎡）"],
  ["comfort", "舒适（放宽尺度、牺牲面积换体验）"],
];

const CHECK_RULES = [
  "承重结构未破坏",
  "新增房间面积合理（功能房≥5㎡、马桶间≥2㎡）",
  "居住空间直接采光未被破坏",
  "厨卫通风",
  "动线未被阻断、逃生通道畅通",
  "新马桶间邻近排水立管（卫生间/厨房），否则注明墙排/提升泵方案",
];

function distToSeg(px, py, w) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / len2));
  return Math.hypot(px - (w.x1 + dx * t), py - (w.y1 + dy * t));
}

function validatePlan(p, structure, tol) {
  const errors = [];
  const warnings = [];
  if (!p || typeof p !== "object") return { errors: ["方案不是对象"], warnings };
  if (!p.title || typeof p.title !== "string") errors.push("缺 title");
  if (!p.summary || typeof p.summary !== "string") errors.push("缺 summary");
  if (!Array.isArray(p.demolish)) errors.push("demolish 不是数组");
  if (!Array.isArray(p.build)) errors.push("build 不是数组");
  const wallMap = new Map((structure.walls || []).map(w => [w.id, w]));
  (p.demolish || []).forEach(id => {
    const w = wallMap.get(id);
    if (!w) errors.push(`拆墙 ${id} 不存在`);
    else if (w.bearing) errors.push(`试图拆承重墙 ${id}`);
    else if (w.unverified) warnings.push(`安全降级：未拆未验证墙 ${id}`);
  });
  (p.build || []).forEach((b, j) => {
    if (!["x1", "y1", "x2", "y2"].every(k => Number.isFinite(Number(b?.[k])))) return errors.push(`build[${j}] 坐标不完整`);
    for (const [x, y] of [[b.x1, b.y1], [b.x2, b.y2]]) {
      const onWall = (structure.walls || []).some(w => distToSeg(Number(x), Number(y), w) < tol);
      const inBbox = (structure.rooms || []).some(r => r.bbox &&
        x >= r.bbox[0] - tol && x <= r.bbox[2] + tol && y >= r.bbox[1] - tol && y <= r.bbox[3] + tol);
      if (!onWall && !inBbox) errors.push(`build[${j}] 端点(${x},${y})悬空：不贴墙也不在任何房间 bbox 内`);
    }
  });
  (p.newRooms || []).forEach((nr, j) => {
    if (!nr || typeof nr.label !== "string" || !nr.label) { errors.push(`newRooms[${j}] 缺 label`); return; }
    if (!Array.isArray(nr.bbox) || nr.bbox.length !== 4 || !nr.bbox.every(v => Number.isFinite(Number(v)))) {
      errors.push(`newRooms[${j}] bbox 不完整`);
    }
  });
  return { errors, warnings };
}

export async function generatePlans(needs, needsText, planCount, executionDir) {
  const structure = JSON.parse(fs.readFileSync(path.join(executionDir, "structure.json"), "utf-8"));
  const n = Math.max(1, Math.min(6, parseInt(planCount, 10) || 4));
  const plansPath = path.join(executionDir, "plans.json");
  const qualityPath = path.join(executionDir, "quality.json");
  const tol = (structure.imgW || 1000) * 0.02;

  let plans;
  let discarded = [];
  if (fs.existsSync(plansPath)) {
    plans = JSON.parse(fs.readFileSync(plansPath, "utf-8"));
  } else {
    const bearingIds = (structure.walls || []).filter(w => w.bearing).map(w => w.id);
    const removableIds = (structure.walls || []).filter(w => !w.bearing && !w.unverified).map(w => w.id);
    const tierList = TIERS.slice(0, n).map(([id, desc], i) => `${i + 1}. tier=${id}：${desc}`).join("\n");
    const system = `你是资深住宅改造设计师。基于结构化户型数据（像素坐标，图宽 ${structure.imgW || structure.width}），按指定梯度生成 ${n} 套改造方案。
硬约束（违反即方案作废）：
- demolish 只能从可拆墙白名单中选择：${removableIds.join(", ") || "无（不可拆任何墙）"}；承重墙 ${bearingIds.join(", ") || "无"} 绝对不可拆
- build 新墙坐标必须是数字，端点必须贴在已有墙上或落在被改造房间的 bbox 内，形成闭合空间
- 每个新增/改造出的功能空间必须输出 newRooms：{label, bbox:[x1,y1,x2,y2]}，bbox 用像素坐标框出该空间矩形（如新隔出的马桶间、书房）
- 新增马桶间必须紧邻现有卫生间或厨房（排水立管位置），否则在 checks 中标 ✗ 并注明提升泵
- 方案之间必须有实质差异，严格按梯度区分改造力度
每套方案对以下规则逐条自检输出 checks：
${CHECK_RULES.map(r => `- ${r}`).join("\n")}
输出严格 JSON（不要 markdown 围栏）：
{"plans":[{"title":"…","demolish":["w3"],"build":[{"x1":0,"y1":0,"x2":0,"y2":0}],"newRooms":[{"label":"独立马桶间","bbox":[x1,y1,x2,y2]}],"roomChanges":[{"roomId":"r2","newLabel":"儿童房"}],"summary":"2-3句，用 newRooms 标签呼应（如「电竞舱」「独立马桶间」）","checks":[{"rule":"${CHECK_RULES[0]}","pass":true,"note":"可选说明"}]}]}
plans 数组顺序必须与梯度编号 1~${n} 一一对应。`;
    const user = `户型结构 JSON：
${JSON.stringify(structure)}

用户诉求：${needs || "无"}${needsText ? `\n补充说明：${needsText}` : ""}

梯度：
${tierList}

输出：`;

    let lastErrors = [];
    let best = { valid: [], report: [] };
    const maskFile = fs.readdirSync(executionDir).find(f => /^floorplan\.(png|jpe?g|webp)$/.test(f));
    const mask = (structure.imgW && maskFile) ? await loadWallMask(path.join(executionDir, maskFile)) : null;
    const Rb = Math.max(40, (structure.imgW || 1000) * 0.06);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { text } = await callLLM({
        system: system + (lastErrors.length ? `\n上次输出校验失败：${lastErrors.join("；")}。请修正。` : ""),
        user,
        temperature: 0.8,
      });
      console.log(`[floorplan] 第 ${attempt + 1}/3 次 AI 原始返回:\n${text}`);
      let parsed;
      try {
        parsed = parseJSON(text);
      } catch (e) {
        lastErrors = [e instanceof Error ? e.message : String(e)];
        continue;
      }
      snapBuilds(parsed, mask, Rb);
      const report = (Array.isArray(parsed.plans) ? parsed.plans : []).map((p, i) => {
        const v = validatePlan(p, structure, tol);
        return { index: i + 1, title: p?.title || `方案${i + 1}`, errors: v.errors, warnings: v.warnings, plan: p };
      });
      const valid = report.filter(r => r.errors.length === 0).map(r => r.plan);
      if (valid.length === n) { best = { valid: report.filter(r => r.errors.length === 0), report }; break; }
      if (valid.length > best.valid.length) best = { valid: report.filter(r => r.errors.length === 0), report };
      lastErrors = report.flatMap(r => [...r.errors.map(e => `${r.title}: ${e}`), ...r.warnings.map(w => `${r.title}: ${w}`)]);
    }
    if (best.valid.length === 0) {
      const reasons = best.report.flatMap(r => r.errors.map(e => `${r.title}: ${e}`));
      writeQuality(qualityPath, { generate: best.report.map(({ plan, ...r }) => r) });
      throw new Error(`方案生成失败：${reasons.slice(0, 5).join("；") || "无有效方案"}`);
    }
    const wallMap = new Map((structure.walls || []).map(w => [w.id, w]));
    discarded = best.report.filter(r => r.errors.length > 0);
    plans = best.valid.map((r, i) => ({
      ...r.plan,
      demolish: (r.plan.demolish || []).filter(id => !wallMap.get(id)?.unverified),
      id: `p${i + 1}`, tier: TIERS[i]?.[0] || "balanced",
      safetyNotes: r.warnings,
    }));
    fs.writeFileSync(plansPath, JSON.stringify(plans, null, 2));
    writeQuality(qualityPath, { generate: best.report.map(({ plan, ...r }) => r) });
  }

  const img = readImg(executionDir, structure);
  const extraLines = [];
  if (discarded.length > 0) {
    extraLines.push(`质检丢弃 ${discarded.length} 套：${discarded.map(d => `${d.title}(${d.errors[0]}${d.errors.length > 1 ? "等" : ""})`).join("；")}`);
  }
  if (plans.length < n) extraLines.push(`要求 ${n} 套，通过质检 ${plans.length} 套`);
  const pages = plans.map((p, i) => {
    const file = `plan-p${i + 1}.svg`;
    fs.writeFileSync(path.join(executionDir, file), renderPlan(structure, p, img, [...extraLines, ...(p.safetyNotes || [])]));
    return { page: i + 1, file };
  });
  const output = plans.map(p => `【${p.tier}】${p.title}：${p.summary}`).join("\n") +
    (extraLines.length ? `\n${extraLines.join("；")}` : "");
  return { pages, output };
}

function snapBuilds(parsed, mask, R) {
  for (const p of Array.isArray(parsed?.plans) ? parsed.plans : []) {
    if (!Array.isArray(p?.build)) continue;
    for (const b of p.build) {
      if (!["x1", "y1", "x2", "y2"].every(k => Number.isFinite(Number(b?.[k])))) continue;
      const vertical = Math.abs(b.y2 - b.y1) >= Math.abs(b.x2 - b.x1);
      for (const [kx, ky] of [["x1", "y1"], ["x2", "y2"]]) {
        const s = mask ? snapPoint(b[kx], b[ky], mask, R) : null;
        if (s) { b[kx] = Math.round(s.x); b[ky] = Math.round(s.y); }
      }
      if (vertical) { const x = Math.round((b.x1 + b.x2) / 2); b.x1 = x; b.x2 = x; }
      else { const y = Math.round((b.y1 + b.y2) / 2); b.y1 = y; b.y2 = y; }
    }
  }
}

function writeQuality(qualityPath, section) {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(qualityPath, "utf-8")); } catch { /* fresh */ }
  fs.writeFileSync(qualityPath, JSON.stringify({ ...existing, ...section }, null, 2));
}

function readImg(executionDir, structure) {
  if (!structure.imgW) return null;
  const dir = fs.readdirSync(executionDir);
  const file = dir.find(f => /^floorplan\.(png|jpe?g|webp)$/.test(f));
  if (!file) return null;
  const ext = path.extname(file).toLowerCase();
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[ext];
  return { base64: fs.readFileSync(path.join(executionDir, file)).toString("base64"), mime };
}
