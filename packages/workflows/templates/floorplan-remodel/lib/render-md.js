import { areaM2 } from "./metrics.js";

/**
 * MD 派生视图渲染器（只读产物，真源仍是 structure.json / plans.json）
 *
 * ASCII 画 + 表格：人可读、聊天 AI 可直接当上下文读；与叠原图 SVG 双渲染并存。
 */

const COLS = 60;

function makeGrid(structure) {
  const W = structure.imgW || structure.width || 1000;
  const H = structure.imgH || structure.height || 700;
  const rows = Math.max(18, Math.round(COLS * H / W));
  const g = Array.from({ length: rows }, () => Array(COLS).fill(" "));
  const at = (x, y) => [Math.max(0, Math.min(COLS - 1, Math.floor(x / W * COLS))), Math.max(0, Math.min(rows - 1, Math.floor(y / H * rows)))];
  return { g, rows, at, W, H };
}

function plotSeg(g, at, x1, y1, x2, y2, ch) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const n = Math.max(2, Math.ceil(len / 4));
  for (let i = 0; i <= n; i++) {
    const [c, r] = at(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n);
    g[r][c] = ch;
  }
}

function ascii(structure, plan) {
  const { g, at } = makeGrid(structure);
  const demolish = new Set(plan?.demolish || []);
  for (const w of structure.walls || []) {
    plotSeg(g, at, w.x1, w.y1, w.x2, w.y2, demolish.has(w.id) ? "X" : (w.bearing ? "#" : "+"));
  }
  for (const b of plan?.build || []) plotSeg(g, at, b.x1, b.y1, b.x2, b.y2, "B");
  for (const o of structure.openings || []) {
    const w = (structure.walls || []).find(w => w.id === o.wallId);
    if (!w) continue;
    const [c, r] = at(w.x1 + (w.x2 - w.x1) * o.pos, w.y1 + (w.y2 - w.y1) * o.pos);
    g[r][c] = o.type === "door" ? (o.id === structure.entryDoorId ? "E" : "d") : "w";
  }
  for (const nr of plan?.newRooms || []) {
    if (!Array.isArray(nr.bbox)) continue;
    const [c1, r1] = at(nr.bbox[0], nr.bbox[1]);
    const [c2, r2] = at(nr.bbox[2], nr.bbox[3]);
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      g[r][c] = (r === r1 || r === r2 || c === c1 || c === c2) ? "*" : ".";
    }
  }
  for (const r of structure.rooms || []) {
    const [c, row] = at(...(r.center || [(r.bbox?.[0] + r.bbox?.[2]) / 2, (r.bbox?.[1] + r.bbox?.[3]) / 2]));
    g[row][c] = String(r.label || "?").slice(0, 1);
  }
  for (const nr of plan?.newRooms || []) {
    if (!Array.isArray(nr.bbox)) continue;
    const [c, row] = at((nr.bbox[0] + nr.bbox[2]) / 2, (nr.bbox[1] + nr.bbox[3]) / 2);
    g[row][c] = String(nr.label || "?").slice(0, 1);
  }
  return g.map(row => row.join("").trimEnd()).join("\n");
}

function scaleLine(structure) {
  if (!structure.mmPerPx) return "比例尺缺失（图无尺寸标注且未提供建筑面积）— 面积校验降级为提示";
  const src = structure.scaleSource === "areaM2" ? "建筑面积参数估算" : "图上尺寸标注";
  return `比例尺 ${structure.mmPerPx} mm/px（${src}）`;
}

function roomTable(structure) {
  const lines = ["| 房间 | 名称 | 面积(㎡) |", "|---|---|---|"];
  for (const r of structure.rooms || []) {
    const a = r.bbox ? areaM2(r.bbox, structure.mmPerPx) : null;
    lines.push(`| ${r.id} | ${r.label} | ${a ?? (r.area || "-")} |`);
  }
  return lines.join("\n");
}

function wallTable(structure) {
  const lines = ["| 墙 | 承重 | 厚(px) | 状态 |", "|---|---|---|---|"];
  for (const w of structure.walls || []) {
    lines.push(`| ${w.id} | ${w.bearing ? "是" : "否"} | ${w.thickness || "-"} | ${w.unverified ? "⚠未验证" : "ok"} |`);
  }
  return lines.join("\n");
}

function openingTable(structure) {
  const lines = ["| 门窗 | 类型 | 所属墙 | 位置 |", "|---|---|---|---|"];
  for (const o of structure.openings || []) {
    lines.push(`| ${o.id}${o.id === structure.entryDoorId ? "(入户)" : ""} | ${o.type === "door" ? "门" : "窗"} | ${o.wallId} | ${(o.pos * 100).toFixed(0)}% |`);
  }
  return lines.join("\n");
}

export function renderStructureMd(structure) {
  const bearing = (structure.walls || []).filter(w => w.bearing).length;
  return `# 户型结构（派生视图，真源 structure.json）

- 几何来源：${structure.source === "cv" ? "CV 像素提取" : "vision"}
- ${scaleLine(structure)}
- 墙 ${(structure.walls || []).length}（承重 ${bearing}）· 房间 ${(structure.rooms || []).length} · 门窗 ${(structure.openings || []).length} · 入户门 ${structure.entryDoorId || "未识别"}
- 图例：#=承重墙 +=隔墙 X=砸墙 B=新墙 d=门 E=入户门 w=窗 *=新房间边界 .=新房间内部 汉字=房间名

\`\`\`
${ascii(structure, null)}
\`\`\`

## 房间
${roomTable(structure)}

## 墙
${wallTable(structure)}

## 门窗
${openingTable(structure)}

${structure.notes ? `## 备注\n${structure.notes}\n` : ""}`;
}

function fmtAnchor(a) {
  if (!a || typeof a !== "object") return "?";
  if (a.wall) return `${a.wall}@${Math.round((Number(a.t) || 0) * 100)}%`;
  if (a.room) return `${a.room}.${a.edge}@${Math.round((Number(a.t) || 0) * 100)}%`;
  return `px(${a.x},${a.y})`;
}

export function renderPlanMd(structure, plan) {
  const buildLines = (plan.build || []).map((b, i) => {
    const spec = plan.buildSpec?.[i];
    const sym = spec && (spec.from || spec.to) ? `${fmtAnchor(spec.from)} → ${fmtAnchor(spec.to)}` : "像素直传";
    return `| B${i + 1} | ${sym} | (${b.x1},${b.y1})-(${b.x2},${b.y2}) |`;
  });
  const newRoomLines = (plan.newRooms || []).map(nr => {
    const a = nr.bbox ? areaM2(nr.bbox, structure.mmPerPx) : null;
    return `| ${nr.label} | ${nr.room || "-"} | ${a ?? "-"} |`;
  });
  const checkLines = (plan.checks || []).map(c => `| ${c.rule} | ${c.pass ? "✓" : "✗"} | ${c.note || ""} |`);
  return `# ${plan.title}（${plan.tier}）

${plan.summary}

- 图例：#=承重墙 +=隔墙 X=砸墙 B=新墙 *=新房间边界 .=新房间内部

\`\`\`
${ascii(structure, plan)}
\`\`\`

## 砸墙
${(plan.demolish || []).length ? plan.demolish.map(id => `- ${id}`).join("\n") : "（无）"}

## 新墙
${buildLines.length ? "| 新墙 | 符号锚点 | 像素 |\n|---|---|---|\n" + buildLines.join("\n") : "（无）"}

## 新房间
${newRoomLines.length ? "| 名称 | 所在房间 | 面积(㎡) |\n|---|---|---|\n" + newRoomLines.join("\n") : "（无）"}

${(plan.roomChanges || []).length ? `## 房间改名\n${plan.roomChanges.map(rc => `- ${rc.roomId} → ${rc.newLabel}`).join("\n")}\n` : ""}
## 自检
${checkLines.length ? "| 规则 | 通过 | 说明 |\n|---|---|---|\n" + checkLines.join("\n") : "（无）"}

${(plan.safetyNotes || []).length ? `## 安全提示\n${plan.safetyNotes.map(s => `- ${s}`).join("\n")}\n` : ""}`;
}
