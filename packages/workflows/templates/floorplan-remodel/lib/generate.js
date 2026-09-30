import fs from "node:fs";
import path from "node:path";
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { renderPlan, readImg } from "./render.js";
import { renderPlanMd } from "./render-md.js";
import { loadWallMask, nearMask } from "./snap.js";
import { resolvePlanSpecs } from "./anchors.js";
import { areaM2, roomTypeByLabel } from "./metrics.js";

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
  "新增房间面积合理（功能房≥5㎡、马桶间≥2㎡，硬下限1.5㎡）",
  "新房间四边围合（新墙两端接墙，不悬空）",
  "拆墙有补：重建围合或声明空间合并，不孤儿化房间",
  "居住空间直接采光未被破坏",
  "厨卫通风",
  "动线未被阻断、逃生通道畅通",
  "新马桶间邻近排水立管（卫生间/厨房），否则注明墙排/提升泵",
];

function distToSeg(px, py, w) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / len2));
  return Math.hypot(px - (w.x1 + dx * t), py - (w.y1 + dy * t));
}

function validatePlan(p, structure, tol, maskPts) {
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
      const onMask = maskPts ? nearMask(Number(x), Number(y), maskPts, tol) : false;
      // L/T 型新墙交点：端点落在同方案另一新墙上合法
      const onBuild = (p.build || []).some(o => o !== b &&
        ["x1", "y1", "x2", "y2"].every(k => Number.isFinite(Number(o?.[k]))) && distToSeg(Number(x), Number(y), o) < tol);
      if (!onWall && !inBbox && !onMask && !onBuild) errors.push(`build[${j}] 端点(${x},${y})悬空：不贴墙也不在任何房间 bbox 内`);
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

export function validatePlanWithRules(p, structure, rules = {}, maskPts = null) {
  const tol = (structure.imgW || 1000) * 0.02;
  const v = validatePlan(p, structure, tol, maskPts);

  (p.build || []).forEach((b, j) => {
    if (!b) return;
    const len = Math.hypot(Number(b.x2) - Number(b.x1), Number(b.y2) - Number(b.y1));
    if (len < tol) v.errors.push(`build[${j}] 长度过短（${len.toFixed(0)}px），无法构成有效隔墙`);
  });

  const minArea = (rules.minAreaM2 || {});
  (p.newRooms || []).forEach((nr, j) => {
    if (!nr || !nr.label) return;
    const type = roomTypeByLabel(nr.label);
    if (!type || !minArea[type]) return;
    const a = areaM2(nr.bbox, structure.mmPerPx);
    if (a == null) {
      if (!structure.mmPerPx) v.warnings.push(`newRooms[${j}]（${nr.label}）无比例尺(mmPerPx)，面积下限未校验`);
      return;
    }
    if (a < minArea[type] * 0.6) v.errors.push(`newRooms[${j}]（${nr.label}）面积 ${a}㎡ 远低于 ${type} 下限 ${minArea[type]}㎡`);
    else if ((rules.hardMinAreaM2 || {})[type] && a < rules.hardMinAreaM2[type]) v.errors.push(`newRooms[${j}]（${nr.label}）面积 ${a}㎡ 低于硬下限 ${rules.hardMinAreaM2[type]}㎡`);
    else if (a < minArea[type]) v.warnings.push(`newRooms[${j}]（${nr.label}）面积 ${a}㎡ 低于 ${type} 下限 ${minArea[type]}㎡，仅示意`);
  });

  // 新房间 bbox 中心须落在既有房间内（防画到户型外）
  (p.newRooms || []).forEach((nr, j) => {
    if (!nr || !Array.isArray(nr.bbox) || nr.bbox.length !== 4 || !nr.bbox.every(v => Number.isFinite(Number(v)))) return;
    const cx = (Number(nr.bbox[0]) + Number(nr.bbox[2])) / 2;
    const cy = (Number(nr.bbox[1]) + Number(nr.bbox[3])) / 2;
    const inside = (structure.rooms || []).some(r => r.bbox &&
      cx >= r.bbox[0] - tol && cx <= r.bbox[2] + tol && cy >= r.bbox[1] - tol && cy <= r.bbox[3] + tol);
    if (!inside) v.warnings.push(`newRooms[${j}]（${nr.label || "?"}）中心不在任何既有房间内，可能画到户型外`);
  });

  // 新马桶间须邻湿区（含房间 bbox 扩展 tol）
  const wet = structure.wetRooms || [];
  (p.newRooms || []).forEach((nr, j) => {
    if (!nr || !nr.label) return;
    if (roomTypeByLabel(nr.label) !== "toilet" || wet.length === 0) return;
    const near = (structure.rooms || []).some(r => wet.includes(r.id) && r.bbox && nearBbox(nr.bbox, r.bbox, tol));
    if (!near) v.warnings.push(`newRooms[${j}]（${nr.label}）不邻湿区，需墙排/提升泵`);
  });

  // 围合校验：newRooms 四边须被"拆后墙图+新墙"覆盖≥80%（治悬空功能舱）
  const keptWalls = (structure.walls || []).filter(w => !(p.demolish || []).includes(w.id));
  const segs = [...keptWalls, ...(p.build || []).filter(b => b && ["x1", "y1", "x2", "y2"].every(k => Number.isFinite(Number(b[k]))) )];
  (p.newRooms || []).forEach((nr, j) => {
    if (!nr || !Array.isArray(nr.bbox) || nr.bbox.length !== 4 || !nr.bbox.every(x => Number.isFinite(Number(x)))) return;
    const [x1, y1, x2, y2] = nr.bbox.map(Number);
    const sides = [
      { n: "上", s: { x1, y1, x2, y2: y1 } },
      { n: "下", s: { x1, y1: y2, x2, y2 } },
      { n: "左", s: { x1, y1, x2: x1, y2 } },
      { n: "右", s: { x1: x2, y1, x2, y2 } },
    ];
    for (const { n, s } of sides) {
      if (sideCoverage(s, segs, tol) < 0.8) {
        v.errors.push(`newRooms[${j}]（${nr.label || "?"}）${n}边未围合（拆后墙+新墙覆盖<80%）`);
      }
    }
  });

  // 拆墙孤儿化校验：拆墙使需围合房间(卧/书/卫)边界缺口且未声明合并 → 报错
  const mergedRooms = new Set((p.roomChanges || []).map(rc => rc?.roomId).filter(Boolean));
  const enclosedTypes = new Set(["bedroom", "study", "toilet"]);
  (p.demolish || []).forEach(id => {
    const w = (structure.walls || []).find(x => x.id === id);
    if (!w) return;
    for (const r of structure.rooms || []) {
      if (!r.bbox || mergedRooms.has(r.id)) continue;
      const type = roomTypeByLabel(r.label);
      if (!type || !enclosedTypes.has(type)) continue;
      const [x1, y1, x2, y2] = r.bbox.map(Number);
      const sides = [
        { x1, y1, x2, y2: y1 }, { x1, y1: y2, x2, y2 },
        { x1, y1, x2: x1, y2 }, { x1: x2, y1, x2, y2 },
      ];
      const wLen = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
      if (sides.some(sd => {
        const sLen = Math.hypot(sd.x2 - sd.x1, sd.y2 - sd.y1) || 1;
        return collinearOverlap(sd, w, tol) > 0.5 * Math.min(sLen, wLen);
      })) {
        v.errors.push(`拆墙 ${id} 使 ${r.id}（${r.label}）围合缺口且未用 roomChanges 声明合并`);
      }
    }
  });

  return v;
}

/** newRooms 四边中未被"保留墙+已有新墙"覆盖≥80% 的边 → 自动补新墙 */
function synthesizeEnclosure(p, structure, tol) {
  const kept = (structure.walls || []).filter(w => !(p.demolish || []).includes(w.id));
  const added = [];
  for (const nr of p.newRooms || []) {
    if (!nr || !Array.isArray(nr.bbox) || nr.bbox.length !== 4 || !nr.bbox.every(x => Number.isFinite(Number(x)))) continue;
    const [x1, y1, x2, y2] = nr.bbox.map(Number);
    const sides = [
      { x1, y1, x2, y2: y1 }, { x1, y1: y2, x2, y2 },
      { x1, y1, x2: x1, y2 }, { x1: x2, y1, x2, y2 },
    ];
    for (const sd of sides) {
      if (sideCoverage(sd, [...kept, ...(p.build || []), ...added], tol) >= 0.8) continue;
      added.push({ x1: sd.x1, y1: sd.y1, x2: sd.x2, y2: sd.y2, auto: true });
    }
  }
  return added;
}

/** 线段 side 被 segments 中同向共线段的覆盖比例 */
function sideCoverage(side, segments, tol) {
  const horiz = Math.abs(side.y2 - side.y1) <= Math.abs(side.x2 - side.x1);
  const len = Math.hypot(side.x2 - side.x1, side.y2 - side.y1) || 1;
  const base = horiz ? side.x1 : side.y1;
  const intervals = [];
  for (const s of segments) {
    const ov = collinearOverlap(side, s, tol);
    if (ov <= 0) continue;
    const a1 = horiz ? Math.max(s.x1, side.x1) : Math.max(s.y1, side.y1);
    const a2 = horiz ? Math.min(s.x2, side.x2) : Math.min(s.y2, side.y2);
    intervals.push([a1 - base, a2 - base]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let cov = 0, cur = -1;
  for (const [a, b] of intervals) {
    const s0 = Math.max(a, cur);
    if (b > s0) { cov += b - s0; cur = b; }
  }
  return cov / len;
}

/** 两线段同向共线（轴距≤tol）时的重叠长度 */
function collinearOverlap(a, b, tol) {
  if (!a || !b || !["x1", "y1", "x2", "y2"].every(k => Number.isFinite(Number(a[k])) && Number.isFinite(Number(b[k])))) return 0;
  const aH = Math.abs(a.y2 - a.y1) <= Math.abs(a.x2 - a.x1);
  const bH = Math.abs(b.y2 - b.y1) <= Math.abs(b.x2 - b.x1);
  if (aH !== bH) return 0;
  if (aH) {
    if (Math.abs(a.y1 - b.y1) > tol) return 0;
    return Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  }
  if (Math.abs(a.x1 - b.x1) > tol) return 0;
  return Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
}

function nearBbox(a, b, tol) {
  if (!a || a.length !== 4 || !b || b.length !== 4) return false;
  return !(a[2] + tol < b[0] || b[2] + tol < a[0] || a[3] + tol < b[1] || b[3] + tol < a[1]);
}

export async function generatePlans(needs, needsText, planCount, executionDir, retryForce) {
  const structure = JSON.parse(fs.readFileSync(path.join(executionDir, "structure.json"), "utf-8"));
  if (!structure.confirmed) throw Object.assign(new Error("户型结构尚未确认，请先在上一步确认入户门/门窗/房间/承重墙"), { retryable: false });
  const rules = JSON.parse(fs.readFileSync(new URL("../rules.json", import.meta.url), "utf-8"));
  const n = Math.max(1, Math.min(6, parseInt(planCount, 10) || 4));
  const plansPath = path.join(executionDir, "plans.json");
  const qualityPath = path.join(executionDir, "quality.json");
  const tol = (structure.imgW || 1000) * 0.02;

  // force 重试（↻ 重新生成）= 主动重新生成：清产物缓存真跑 LLM；普通补跑继续复用
  if (retryForce && fs.existsSync(plansPath)) {
    fs.rmSync(plansPath);
    for (const f of fs.readdirSync(executionDir)) {
      if (/^plan-p\d+\.(svg|md)$/.test(f)) fs.rmSync(path.join(executionDir, f));
    }
    console.log("[floorplan] force 重试：清除旧方案缓存，重新生成");
  }

  let plans;
  let discarded = [];
  if (fs.existsSync(plansPath)) {
    plans = JSON.parse(fs.readFileSync(plansPath, "utf-8"));
  } else {
    const bearingIds = (structure.walls || []).filter(w => w.bearing).map(w => w.id);
    const removableIds = (structure.walls || []).filter(w => !w.bearing && !w.unverified).map(w => w.id);
    const tierList = TIERS.slice(0, n).map(([id, desc], i) => `${i + 1}. tier=${id}：${desc}`).join("\n");
    const principles = rules.designPrinciples || [];
    const patterns = (rules.patterns || []).map(p => `- ${p.id} ${p.name}｜适用:${p.when}｜做法:${p.how}｜约束:${p.limits}`).join("\n");
    const notes = (rules.constructionNotes || []).map(x => `- ${x}`).join("\n");
    const hardRules = (rules.hardRules || []).map(x => `- ${x}`).join("\n");
    const system = `你是资深住宅改造设计师。基于结构化户型数据（像素坐标，图宽 ${structure.imgW || structure.width}），按指定梯度生成 ${n} 套改造方案。
设计准则（逐条遵守）：
${principles.map(r => `- ${r}`).join("\n")}
改造套路库（优先组合引用，summary 中注明所用套路 id）：
${patterns}
施工注意（涉及时在 summary/checks 注明）：
${notes}
硬规则（代码会校验，违反即方案作废）：
${hardRules}
硬约束（违反即方案作废）：
- demolish 只能从可拆墙白名单中选择：${removableIds.join(", ") || "无（不可拆任何墙）"}；承重墙 ${bearingIds.join(", ") || "无"} 绝对不可拆
- 拆墙必须有补：同方案内用 build 重建围合，或用 roomChanges 声明被拆墙两侧空间合并；禁止拆了不补留下开放缺口
- build 新墙用符号锚点：{"from":<锚点>,"to":<锚点>}；锚点 ∈ {"wall":"<墙id>","t":0-1 沿墙比例} 或 {"room":"<房间id>","edge":"N|S|W|E","t":0-1 沿边比例}；墙id/房间id 必须取自上方结构数据，严禁直接编造像素坐标；新墙两端必须落在墙/房间边上形成闭合空间
- 每个新增/改造出的功能空间必须输出 newRooms：{label, room:"<空间所在房间id>", rel:[x1,y1,x2,y2] 该房间 bbox 内 0-1 相对矩形}（如新隔出的马桶间、书房）；newRooms 的四边必须被既有墙+本方案新墙围合
- 新增马桶间必须紧邻现有卫生间或厨房（排水立管位置），否则在 checks 中标 ✗ 并注明提升泵
- 方案之间必须有实质差异，严格按梯度区分改造力度
每套方案对以下规则逐条自检输出 checks：
${CHECK_RULES.map(r => `- ${r}`).join("\n")}
输出严格 JSON（不要 markdown 围栏）：
{"plans":[{"title":"…","demolish":["w3"],"build":[{"from":{"wall":"w3","t":0.4},"to":{"room":"r2","edge":"N","t":0.5}}],"newRooms":[{"label":"独立马桶间","room":"r2","rel":[0.6,0,1,0.35]}],"roomChanges":[{"roomId":"r2","newLabel":"儿童房"}],"summary":"2-3句，注明所用套路 id（如 P2/P3），用 newRooms 标签呼应","checks":[{"rule":"${CHECK_RULES[0]}","pass":true,"note":"可选说明"}]}]}
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
      const report = (Array.isArray(parsed.plans) ? parsed.plans : []).map((p, i) => {
        const spec = { buildSpec: p?.build, newRoomsSpec: p?.newRooms };
        const res = resolvePlanSpecs(p || {}, structure);
        if (p && typeof p === "object") {
          Object.assign(p, res, spec, { schemaVersion: 2 });
          // newRooms 为隔断真源：未被既有墙/新墙覆盖的边自动补新墙（确定性，治悬空舱）
          const auto = synthesizeEnclosure(p, structure, tol);
          if (auto.length) {
            p.build = [...(p.build || []), ...auto];
            p.buildSpec = [...(p.buildSpec || []), ...auto.map(() => ({ auto: true, along: "newRooms 未围合边" }))];
          }
        }
        const v = validatePlanWithRules(p, structure, rules, mask);
        return { index: i + 1, title: p?.title || `方案${i + 1}`, errors: [...res.errors, ...v.errors], warnings: v.warnings, plan: p };
      });
      const valid = report.filter(r => r.errors.length === 0).map(r => r.plan);
      if (valid.length === n) { best = { valid: report.filter(r => r.errors.length === 0), report }; break; }
      if (valid.length > best.valid.length) best = { valid: report.filter(r => r.errors.length === 0), report };
      lastErrors = report.flatMap(r => r.errors.map(e => `${r.title}: ${e}`));
    }
    if (best.valid.length === 0) {
      const reasons = best.report.flatMap(r => r.errors.map(e => `${r.title}: ${e}`));
      writeQuality(qualityPath, { generate: best.report.map(({ plan, ...r }) => r) });
      throw Object.assign(new Error(`方案生成失败：${reasons.slice(0, 5).join("；") || "无有效方案"}`), { retryable: false });
    }
    const wallMap = new Map((structure.walls || []).map(w => [w.id, w]));
    discarded = best.report.filter(r => r.errors.length > 0);
    plans = best.valid.map((r, i) => ({
      ...r.plan,
      demolish: (r.plan.demolish || []).filter(id => !wallMap.get(id)?.unverified),
      id: `p${i + 1}`, tier: TIERS[r.index - 1]?.[0] || "balanced",
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
    fs.writeFileSync(path.join(executionDir, `plan-p${i + 1}.md`), renderPlanMd(structure, p));
    return { page: i + 1, file };
  });
  const output = plans.map(p => `【${p.tier}】${p.title}：${p.summary}`).join("\n") +
    (extraLines.length ? `\n${extraLines.join("；")}` : "");
  return { pages, mdFiles: plans.map((_, i) => `plan-p${i + 1}.md`), output };
}

function writeQuality(qualityPath, section) {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(qualityPath, "utf-8")); } catch { /* fresh */ }
  fs.writeFileSync(qualityPath, JSON.stringify({ ...existing, ...section }, null, 2));
}
