import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { areaM2, roomTypeByLabel } from "./metrics.js";

const C = {
  wall: "#333333",
  bearing: "#d4380d",
  dim: "#bbbbbb",
  demolish: "#e02020",
  build: "#1677ff",
  align: "#f5c542",
  text: "#333333",
  sub: "#666666",
  window: "#77aabb",
  door: "#999999",
  entry: "#eb2f96",
};

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function lineEl(x1, y1, x2, y2, stroke, w, opacity) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"${opacity ? ` stroke-opacity="${opacity}"` : ""}/>`;
}

function wallById(structure, id) {
  return (structure.walls || []).find(w => w.id === id);
}

function wrapLines(text, chunk) {
  const lines = [];
  for (let i = 0; i < text.length; i += chunk) lines.push(text.slice(i, i + chunk));
  return lines;
}

function svgWrap(W, H, title, lines, body) {
  const strip = 46 + lines.length * 24;
  const total = H + strip;
  const caption = [
    `<text x="16" y="${H + 30}" font-size="24" font-weight="bold" fill="${C.text}" font-family="sans-serif">${esc(title)}</text>`,
    ...lines.map((l, i) => `<text x="16" y="${H + 58 + i * 24}" font-size="16" fill="${C.sub}" font-family="sans-serif">${esc(l)}</text>`),
  ].join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${total}" font-family="sans-serif">
<rect width="${W}" height="${total}" fill="#ffffff"/>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${body}
${caption}
</svg>`;
}

// 墙：承重=红粗、非承重=黑、未验证=灰虚线
function wallEls(structure, strokeW) {
  return (structure.walls || []).map(w => {
    if (w.unverified) {
      return `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${C.door}" stroke-width="${strokeW * 0.6}" stroke-dasharray="8 8" stroke-opacity="0.7"/>`;
    }
    const el = lineEl(w.x1, w.y1, w.x2, w.y2, w.bearing ? C.bearing : C.wall, w.bearing ? strokeW * 1.5 : strokeW);
    if (!w.bearing) return el;
    const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
    return el + `\n<text x="${mx}" y="${my - 10}" text-anchor="middle" font-size="16" fill="${C.bearing}">承重</text>`;
  }).join("\n");
}

// 方案底图：灰墙线
function dimWallEls(structure, strokeW) {
  return (structure.walls || []).map(w => lineEl(w.x1, w.y1, w.x2, w.y2, C.dim, strokeW)).join("\n");
}

// 门窗：门=白缺口+门弧，窗=白缺口+双线；入户门高亮 + 「入户门」标注
function openingEls(structure, gapW) {
  const els = [];
  for (const o of structure.openings || []) {
    const w = wallById(structure, o.wallId);
    if (!w) continue;
    const t = Math.max(0, Math.min(1, Number(o.pos) || 0.5));
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const cx = w.x1 + dx * t, cy = w.y1 + dy * t;
    const half = o.type === "door" ? gapW * 3 : gapW * 3.6;
    const gx1 = cx - ux * half, gy1 = cy - uy * half;
    const gx2 = cx + ux * half, gy2 = cy + uy * half;
    const isEntry = structure.entryDoorId && structure.entryDoorId === o.id;
    els.push(lineEl(gx1, gy1, gx2, gy2, "#ffffff", gapW * 2));
    if (o.type === "window") {
      const off = gapW * 0.7;
      els.push(lineEl(gx1 + nx * off, gy1 + ny * off, gx2 + nx * off, gy2 + ny * off, C.window, gapW * 0.4));
      els.push(lineEl(gx1 - nx * off, gy1 - ny * off, gx2 - nx * off, gy2 - ny * off, C.window, gapW * 0.4));
    } else {
      const color = isEntry ? C.entry : C.door;
      const width = isEntry ? gapW * 0.9 : gapW * 0.3;
      els.push(`<path d="M ${gx2} ${gy2} A ${half * 2} ${half * 2} 0 0 1 ${gx2 - uy * half * 2} ${gy2 + ux * half * 2}" fill="none" stroke="${color}" stroke-width="${width}"/>`);
      if (isEntry) {
        els.push(`<text x="${cx - uy * half * 2.2}" y="${cy + ux * half * 2.2}" text-anchor="middle" font-size="${Math.max(12, gapW * 1.5)}" fill="${C.entry}" font-weight="bold">入户门</text>`);
      }
    }
  }
  return els.join("\n");
}

function roomEls(structure, overrides = []) {
  const map = new Map((overrides || []).map(o => [o.roomId, o.newLabel]));
  return (structure.rooms || []).map(r => {
    const [cx, cy] = r.center || [500, 500];
    const label = esc(map.get(r.id) || r.label || "");
    const area = r.area ? esc(r.area) : "";
    return `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="26" font-weight="bold" fill="${C.text}">${label}</text>` +
      (area ? `\n<text x="${cx}" y="${cy + 28}" text-anchor="middle" font-size="18" fill="${C.sub}">${area}</text>` : "");
  }).join("\n");
}

const PALETTE = ["#1677ff", "#52c41a", "#722ed1", "#fa8c16", "#eb2f96", "#13c2c2"];

// 新增房间图元：按房间类型画简单 SVG 图形（马桶+洗手台 / 书桌+椅 / 床 / 衣架）
function fixtureEls(nr) {
  if (!Array.isArray(nr.bbox) || nr.bbox.length !== 4) return "";
  const [x1, y1, x2, y2] = nr.bbox.map(Number);
  const label = String(nr.label || "");
  const type = /衣帽间/.test(label) ? "wardrobe" : roomTypeByLabel(label);
  if (!type) return "";
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2 + (y2 - y1) * 0.25;
  const s = Math.max(8, Math.min(x2 - x1, y2 - y1) * 0.24);
  const k = "#555555";
  let g = "";
  if (type === "toilet") {
    g = `<rect x="${cx - s * 1.2}" y="${cy - s * 0.9}" width="${s * 0.55}" height="${s * 0.8}" fill="none" stroke="${k}" stroke-width="2"/>
<ellipse cx="${cx - s * 0.1}" cy="${cy + s * 0.1}" rx="${s * 0.7}" ry="${s * 0.55}" fill="none" stroke="${k}" stroke-width="2"/>
<rect x="${cx + s * 0.5}" y="${cy - s * 0.9}" width="${s * 0.7}" height="${s * 0.3}" fill="none" stroke="${k}" stroke-width="2"/>
<ellipse cx="${cx + s * 0.85}" cy="${cy - s * 0.35}" rx="${s * 0.3}" ry="${s * 0.2}" fill="none" stroke="${k}" stroke-width="2"/>`;
  } else if (type === "study") {
    g = `<rect x="${cx - s}" y="${cy - s * 0.5}" width="${s * 2}" height="${s * 0.5}" fill="none" stroke="${k}" stroke-width="2"/>
<rect x="${cx + s * 0.4}" y="${cy + s * 0.2}" width="${s * 0.5}" height="${s * 0.5}" fill="none" stroke="${k}" stroke-width="2"/>`;
  } else if (type === "bedroom") {
    g = `<rect x="${cx - s}" y="${cy - s * 0.6}" width="${s * 2}" height="${s * 1.2}" rx="${s * 0.2}" fill="none" stroke="${k}" stroke-width="2"/>
<rect x="${cx - s * 0.5}" y="${cy - s * 0.75}" width="${s}" height="${s * 0.28}" fill="none" stroke="${k}" stroke-width="2"/>`;
  } else {
    g = `<line x1="${cx - s}" y1="${cy - s * 0.6}" x2="${cx + s}" y2="${cy - s * 0.6}" stroke="${k}" stroke-width="2"/>
<line x1="${cx}" y1="${cy - s * 0.6}" x2="${cx}" y2="${cy + s * 0.5}" stroke="${k}" stroke-width="2"/>
<line x1="${cx}" y1="${cy + s * 0.5}" x2="${cx - s * 0.6}" y2="${cy + s * 0.5}" stroke="${k}" stroke-width="2"/>
<line x1="${cx}" y1="${cy + s * 0.5}" x2="${cx + s * 0.6}" y2="${cy + s * 0.5}" stroke="${k}" stroke-width="2"/>`;
  }
  const name = { toilet: "马桶", study: "书桌", bedroom: "床", wardrobe: "衣架" }[type];
  return `<g opacity="0.85">${g}<text x="${cx}" y="${cy + s * 1.5}" text-anchor="middle" font-size="${Math.max(11, s * 0.7)}" fill="${C.sub}">${name}</text></g>`;
}

function newRoomEls(plan, W, structure) {
  const fs2 = Math.max(13, W * 0.015);
  return (plan.newRooms || []).map((nr, i) => {
    if (!Array.isArray(nr.bbox) || nr.bbox.length !== 4) return "";
    const [x1, y1, x2, y2] = nr.bbox.map(Number);
    const color = PALETTE[i % PALETTE.length];
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const label = String(nr.label || "");
    const chipW = label.length * fs2 + fs2;
    const area = areaM2(nr.bbox, structure?.mmPerPx);
    const areaLine = area != null
      ? `<text x="${cx}" y="${cy + fs2 * 1.5}" text-anchor="middle" font-size="${fs2 * 0.9}" fill="${C.text}" font-weight="bold">${area}㎡</text>`
      : "";
    return `<rect x="${x1}" y="${y1}" width="${Math.max(0, x2 - x1)}" height="${Math.max(0, y2 - y1)}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="2" stroke-dasharray="6 4"/>
<rect x="${cx - chipW / 2}" y="${cy - fs2}" width="${chipW}" height="${fs2 * 1.9}" rx="${fs2 * 0.5}" fill="${color}" fill-opacity="0.92"/>
<text x="${cx}" y="${cy + fs2 * 0.35}" text-anchor="middle" font-size="${fs2}" fill="#ffffff" font-weight="bold">${esc(label)}</text>
${areaLine}
${fixtureEls(nr)}`;
  }).join("\n");
}

function buildEls(plan, strokeW) {
  return (plan.build || []).map(b => lineEl(b.x1, b.y1, b.x2, b.y2, C.build, strokeW, 0.85)).join("\n");
}

function badgeEls(structure, plan) {
  const fs2 = Math.max(14, (structure.imgW || 1000) * 0.016);
  return (plan.roomChanges || []).map(rc => {
    const room = (structure.rooms || []).find(r => r.id === rc.roomId);
    if (!room || !rc.newLabel) return "";
    const cx = room.center?.[0] ?? 500;
    const cy = room.bbox ? room.bbox[3] - fs2 * 0.8 : (room.center?.[1] ?? 500);
    const text = `→ ${rc.newLabel}`;
    const w = text.length * fs2 + fs2;
    return `<g><rect x="${cx - w / 2}" y="${cy - fs2 * 1.4}" width="${w}" height="${fs2 * 1.9}" rx="${fs2 * 0.5}" fill="${C.build}" fill-opacity="0.9"/>
<text x="${cx}" y="${cy}" text-anchor="middle" font-size="${fs2}" fill="#ffffff" font-weight="bold">${esc(text)}</text></g>`;
  }).join("\n");
}

export function renderStructure(structure, img = null) {
  const W = structure.imgW || structure.width || 1000;
  const H = structure.imgH || structure.height || 700;
  const strokeW = Math.max(4, W * 0.006);
  const body = `${wallEls(structure, strokeW)}\n${openingEls(structure, strokeW)}\n${roomEls(structure)}`;
  const chunk = Math.floor(W / 17);
  const lines = wrapLines("图例：灰虚线=未验证墙 红=承重墙不可拆 黑=非承重墙；请核对线与原图墙体是否贴合，有误请重试", chunk);
  return svgWrap(W, H, "结构识别预览", lines, body);
}

export function renderPlan(structure, plan, img = null, extraLines = []) {
  const W = structure.imgW || structure.width || 1000;
  const H = structure.imgH || structure.height || 700;
  const strokeW = Math.max(4, W * 0.006);
  const demolish = (plan.demolish || []).map(id => {
    const w = wallById(structure, id);
    return w ? `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${C.demolish}" stroke-width="${strokeW * 1.4}" stroke-dasharray="10 6"/>` : "";
  }).filter(Boolean).join("\n");
  const body = `${dimWallEls(structure, strokeW)}\n${openingEls(structure, strokeW)}\n${demolish}\n${newRoomEls(plan, W, structure)}\n${buildEls(plan, strokeW)}\n${badgeEls(structure, plan)}`;
  const chunk = Math.floor(W / 17);
  const checks = (plan.checks || []).map(c => `${c.pass ? "✓" : "✗"}${c.rule}${c.note && !c.pass ? `(${c.note})` : ""}`).join(" ");
  const lines = ["图例：色块=新增功能空间 蓝线=新砌墙 红虚线=砸墙 | 示意方案，施工前需专业鉴定",
    ...wrapLines(`规范自检：${checks}`, chunk),
    ...extraLines.flatMap(l => wrapLines(l, chunk))];
  return svgWrap(W, H, plan.title || plan.id, lines, body);
}

export function demo() {
  const structure = {
    imgW: 1000, imgH: 700, mmPerPx: 7,
    walls: [
      { id: "w1", x1: 50, y1: 50, x2: 950, y2: 50, bearing: true, confidence: 0.9 },
      { id: "w2", x1: 50, y1: 50, x2: 50, y2: 650, bearing: true, confidence: 0.9 },
      { id: "w3", x1: 500, y1: 50, x2: 500, y2: 350, bearing: false, confidence: 0.8 },
      { id: "w4", x1: 50, y1: 650, x2: 950, y2: 650, bearing: true, confidence: 0.9 },
    ],
    rooms: [
      { id: "r1", label: "客厅", center: [270, 350], area: "30㎡", bbox: [50, 350, 500, 650] },
      { id: "r2", label: "卧室", center: [720, 200], area: "12㎡", bbox: [500, 50, 950, 350] },
    ],
    openings: [{ id: "d1", type: "door", wallId: "w3", pos: 0.8 }],
  };
  const plan = {
    id: "p1", tier: "balanced", title: "均衡型：隔出功能房",
    demolish: ["w3"],
    build: [{ x1: 500, y1: 350, x2: 950, y2: 350 }],
    newRooms: [
      { label: "功能房", bbox: [500, 350, 950, 650] },
      { label: "独立马桶间", bbox: [100, 100, 200, 200] },
    ],
    roomChanges: [{ roomId: "r2", newLabel: "功能房" }],
    checks: [{ rule: "承重结构未破坏", pass: true }, { rule: "新马桶间邻近排水", pass: false, note: "需提升泵" }],
  };
  const sImg = renderStructure(structure);
  const pImg = renderPlan(structure, plan, null, ["丢弃：方案X 试图拆承重墙"]);
  const assert = (cond, msg) => { if (!cond) throw new Error(`render self-check failed: ${msg}`); };
  assert(sImg.includes("<rect width=") && !sImg.includes("<image href="), "structure is pure vector, no base image");
  assert(sImg.includes(C.bearing) && sImg.includes(C.door), "structure has bearing walls + door symbol");
  assert(pImg.includes(C.demolish), "plan has demolish red");
  assert(pImg.includes(PALETTE[0]), "plan has newRoom fill");
  assert(pImg.includes(">功能房</text>"), "plan has newRoom label");
  assert(pImg.includes("→ 功能房"), "plan has rename badge");
  assert(pImg.includes("施工前需专业鉴定"), "disclaimer present");
  assert(pImg.includes("马桶"), "plan has fixture icon for 马桶间");
  const outDir = "/tmp/opencode";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "floorplan-demo-structure.svg"), sImg);
  fs.writeFileSync(path.join(outDir, "floorplan-demo-plan.svg"), pImg);
  console.log("render self-check OK → /tmp/opencode/floorplan-demo-*.svg");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) demo();
