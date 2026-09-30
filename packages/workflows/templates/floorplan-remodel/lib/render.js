import fs from "node:fs";
import path from "node:path";
import { areaM2, roomTypeByLabel } from "./metrics.js";

const C = {
  wall: "#333333",
  bearing: "#d4380d",
  dim: "#bbbbbb",
  demolish: "#e02020",
  build: "#1677ff",
  text: "#333333",
  sub: "#666666",
  window: "#77aabb",
  door: "#999999",
  entry: "#eb2f96",
  badgeWall: "#595959",
  badgeDoor: "#1677ff",
  badgeWindow: "#13c2c2",
  badgeRoom: "#52c41a",
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

function svgWrap(W, H, title, lines, body, legend) {
  const rows = lines.length + (legend?.length ? 1 : 0);
  const strip = 46 + rows * 24;
  const total = H + strip;
  let lx = 16;
  const legendRow = legend?.length
    ? `<g>${legend.map(item => {
        const sw = `<rect x="${lx}" y="${H + 48}" width="20" height="12" fill="${item.color}"${item.dash ? ` stroke="${item.color}" stroke-dasharray="4 3" fill-opacity="0.35"` : ""}/>`;
        const tx = `<text x="${lx + 26}" y="${H + 59}" font-size="15" fill="${C.sub}">${esc(item.label)}</text>`;
        lx += 26 + item.label.length * 15 + 18;
        return sw + tx;
      }).join("")}</g>`
    : "";
  const caption = [
    `<text x="16" y="${H + 30}" font-size="24" font-weight="bold" fill="${C.text}" font-family="sans-serif">${esc(title)}</text>`,
    legendRow,
    ...lines.map((l, i) => `<text x="16" y="${H + 58 + (legend?.length ? 24 : 0) + i * 24}" font-size="16" fill="${C.sub}" font-family="sans-serif">${esc(l)}</text>`),
  ].join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${total}" font-family="sans-serif">
<rect width="${W}" height="${total}" fill="#ffffff"/>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${body}
${caption}
</svg>`;
}

// 墙：承重=红粗、非承重=黑、未验证=灰虚线；withIds 时挂 data-id 供确认面板交互高亮
function wallEls(structure, strokeW, withIds = false) {
  return (structure.walls || []).map(w => {
    const did = withIds ? ` data-id="${w.id}" data-kind="wall"` : "";
    if (w.unverified) {
      return `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${C.door}" stroke-width="${strokeW * 0.6}" stroke-dasharray="8 8" stroke-opacity="0.7"${did}/>`;
    }
    const el = `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${w.bearing ? C.bearing : C.wall}" stroke-width="${w.bearing ? strokeW * 1.5 : strokeW}" stroke-linecap="round"${did}/>`;
    if (!w.bearing) return el;
    const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
    return el + `\n<text x="${mx}" y="${my - 10}" text-anchor="middle" font-size="16" fill="${C.bearing}">承重</text>`;
  }).join("\n");
}

// 方案底图：灰墙线
function dimWallEls(structure, strokeW) {
  return (structure.walls || []).map(w => lineEl(w.x1, w.y1, w.x2, w.y2, C.dim, strokeW)).join("\n");
}

// 门窗：门=白缺口+门弧，窗=白缺口+双线；入户门高亮 + 「入户门」标注；withIds 时整组挂 data-id
function openingEls(structure, gapW, withIds = false) {
  const els = [];
  for (const o of structure.openings || []) {
    const w = wallById(structure, o.wallId);
    if (!w) continue;
    const g = [];
    const t = Math.max(0, Math.min(1, Number(o.pos) || 0.5));
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const cx = w.x1 + dx * t, cy = w.y1 + dy * t;
    const half = o.len ? Math.max(gapW * 1.5, Math.min(o.len / 2, gapW * 4)) : (o.type === "door" ? gapW * 3 : gapW * 3.6);
    const gx1 = cx - ux * half, gy1 = cy - uy * half;
    const gx2 = cx + ux * half, gy2 = cy + uy * half;
    const isEntry = structure.entryDoorId && structure.entryDoorId === o.id;
    g.push(lineEl(gx1, gy1, gx2, gy2, "#ffffff", gapW * 2));
    if (o.type === "window") {
      const off = gapW * 0.7;
      g.push(lineEl(gx1 + nx * off, gy1 + ny * off, gx2 + nx * off, gy2 + ny * off, C.window, gapW * 0.4));
      g.push(lineEl(gx1 - nx * off, gy1 - ny * off, gx2 - nx * off, gy2 - ny * off, C.window, gapW * 0.4));
    } else {
      const color = isEntry ? C.entry : C.door;
      const width = isEntry ? gapW * 0.9 : gapW * 0.3;
      g.push(`<path d="M ${gx2} ${gy2} A ${half * 2} ${half * 2} 0 0 1 ${gx2 - uy * half * 2} ${gy2 + ux * half * 2}" fill="none" stroke="${color}" stroke-width="${width}"/>`);
      if (isEntry) {
        g.push(`<text x="${cx - uy * half * 2.2}" y="${cy + ux * half * 2.2}" text-anchor="middle" font-size="${Math.max(12, gapW * 1.5)}" fill="${C.entry}" font-weight="bold">入户门</text>`);
      }
    }
    els.push(withIds ? `<g data-id="${o.id}" data-kind="opening">${g.join("")}</g>` : g.join("\n"));
  }
  return els.join("\n");
}

function roomEls(structure, overrides = [], showIds = false) {
  const map = new Map((overrides || []).map(o => [o.roomId, o.newLabel]));
  return (structure.rooms || []).map(r => {
    const [cx, cy] = r.center || [500, 500];
    const label = esc(map.get(r.id) || r.label || "");
    const area = r.area ? esc(r.area) : "";
    const idTag = showIds
      ? `\n<text x="${cx}" y="${cy + (area ? 50 : 26)}" text-anchor="middle" font-size="14" font-weight="bold" fill="${C.badgeRoom}" data-id="${r.id}" data-kind="room">${r.id}</text>`
      : "";
    return `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="26" font-weight="bold" fill="${C.text}">${label}</text>` +
      (area ? `\n<text x="${cx}" y="${cy + 28}" text-anchor="middle" font-size="18" fill="${C.sub}">${area}</text>` : "") + idTag;
  }).join("\n");
}

function roomIdEls(structure) {
  return (structure.rooms || []).map(r => {
    const [cx, cy] = r.center || [500, 500];
    return `<text x="${cx}" y="${cy + 50}" text-anchor="middle" font-size="14" font-weight="bold" fill="${C.badgeRoom}" paint-order="stroke" stroke="#ffffff" stroke-width="3" data-id="${r.id}" data-kind="room">${r.id}</text>`;
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
  const fs2 = Math.max(12, W * 0.013);
  return (plan.newRooms || []).map((nr, i) => {
    if (!Array.isArray(nr.bbox) || nr.bbox.length !== 4) return "";
    const [x1, y1, x2, y2] = nr.bbox.map(Number);
    const color = PALETTE[i % PALETTE.length];
    const cx = (x1 + x2) / 2;
    const label = String(nr.label || "");
    const area = areaM2(nr.bbox, structure?.mmPerPx);
    // 小房间标签放框外上方，避免胶囊糊住邻接空间；白描边保证叠图可读
    const inside = y2 - y1 >= fs2 * 3.2;
    const ly = inside ? (y1 + y2) / 2 - fs2 * 0.2 : y1 - fs2 * 0.7;
    const ay = ly + fs2 * 1.25;
    const halo = `paint-order="stroke" stroke="#ffffff" stroke-width="4"`;
    const areaLine = area != null
      ? `<text x="${cx}" y="${ay}" text-anchor="middle" font-size="${fs2 * 0.85}" fill="${C.text}" font-weight="bold" ${halo}>${area}㎡</text>`
      : "";
    return `<rect x="${x1}" y="${y1}" width="${Math.max(0, x2 - x1)}" height="${Math.max(0, y2 - y1)}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="2" stroke-dasharray="6 4"/>
<text x="${cx}" y="${ly}" text-anchor="middle" font-size="${fs2}" fill="${color}" font-weight="bold" ${halo}>${esc(label)}</text>
${areaLine}
${fixtureEls(nr)}`;
  }).join("\n");
}

function buildEls(plan, strokeW) {
  return (plan.build || []).map(b => lineEl(b.x1, b.y1, b.x2, b.y2, C.build, strokeW, 0.85)).join("\n");
}

function badgeEls(structure, plan) {
  const fs2 = Math.max(13, (structure.imgW || 1000) * 0.014);
  return (plan.roomChanges || []).map(rc => {
    const room = (structure.rooms || []).find(r => r.id === rc.roomId);
    if (!room || !rc.newLabel) return "";
    const cx = room.center?.[0] ?? 500;
    const cy = room.bbox ? room.bbox[1] - fs2 * 1.8 : (room.center?.[1] ?? 500) - fs2;
    return `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="${fs2}" fill="${C.build}" font-weight="bold" paint-order="stroke" stroke="#ffffff" stroke-width="4">→ ${esc(rc.newLabel)}</text>`;
  }).join("\n");
}

// 确认预览用 ID 芯片：墙中点/门窗开口/房间 bbox 角标，白描边保证叠图上可读
// 确认预览编号徽章：墙=方徽（承重红/非承重灰）、门窗=圆徽（门蓝/窗青/入户品红）
// 同墙门窗交替偏移两侧 + 两两推挤避让；data-id 供确认面板交互高亮
function idEls(structure, W) {
  const fs2 = Math.max(13, W * 0.014);
  const badges = [];
  for (const w of structure.walls || []) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy) || 1;
    const off = fs2 * 1.2;
    const x = (w.x1 + w.x2) / 2 - (dy / len) * off;
    const y = (w.y1 + w.y2) / 2 + (dx / len) * off;
    const fill = w.bearing ? C.bearing : C.badgeWall;
    const wRect = fs2 * 0.62 * String(w.id).length + fs2 * 0.9;
    badges.push({
      x, y,
      make: (bx, by) => `<g data-id="${w.id}" data-kind="wall"><rect x="${(bx - wRect / 2).toFixed(1)}" y="${(by - fs2 * 0.78).toFixed(1)}" width="${wRect.toFixed(1)}" height="${(fs2 * 1.56).toFixed(1)}" rx="${(fs2 * 0.45).toFixed(1)}" fill="${fill}"/><text x="${bx.toFixed(1)}" y="${(by + fs2 * 0.36).toFixed(1)}" text-anchor="middle" font-size="${(fs2 * 0.82).toFixed(1)}" font-weight="bold" fill="#ffffff">${w.id}</text></g>`,
    });
  }
  const perWall = {};
  for (const o of structure.openings || []) {
    const w = wallById(structure, o.wallId);
    if (!w) continue;
    const k = (perWall[o.wallId] = (perWall[o.wallId] || 0) + 1);
    const side = k % 2 === 0 ? -1 : 1;
    const t = Math.max(0, Math.min(1, Number(o.pos) || 0.5));
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy) || 1;
    const off = fs2 * 2.1 * side;
    const isEntry = structure.entryDoorId === o.id;
    const fill = isEntry ? C.entry : o.type === "window" ? C.badgeWindow : C.badgeDoor;
    const x = w.x1 + dx * t - (dy / len) * off;
    const y = w.y1 + dy * t + (dx / len) * off;
    badges.push({
      x, y,
      make: (bx, by) => `<g data-id="${o.id}" data-kind="opening"><circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${(fs2 * 0.85).toFixed(1)}" fill="${fill}"/><text x="${bx.toFixed(1)}" y="${(by + fs2 * 0.34).toFixed(1)}" text-anchor="middle" font-size="${(fs2 * 0.78).toFixed(1)}" font-weight="bold" fill="#ffffff">${o.id}</text></g>`,
    });
  }
  const min = fs2 * 2.0;
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 0; i < badges.length; i++) {
      for (let j = i + 1; j < badges.length; j++) {
        const a = badges[i], b = badges[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01 && d < min) {
          const push = (min - d) / 2;
          const ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
        }
      }
    }
  }
  return badges.map(b => b.make(b.x, b.y)).join("\n");
}

export function renderStructure(structure, img = null) {
  const W = structure.imgW || structure.width || 1000;
  const H = structure.imgH || structure.height || 700;
  const strokeW = Math.max(4, W * 0.006);
  const base = img?.base64 ? `<image href="data:${img.mime};base64,${img.base64}" x="0" y="0" width="${W}" height="${H}" opacity="0.35"/>` : "";
  const body = `${base}\n${wallEls(structure, strokeW, true)}\n${openingEls(structure, strokeW, true)}\n${img ? roomIdEls(structure) : roomEls(structure, [], true)}\n${idEls(structure, W)}`;
  const chunk = Math.floor(W / 17);
  const lines = wrapLines("编号徽章与确认面板列表一一对应：悬停/点击列表项可在图上高亮；请核对线与原图墙体是否贴合，有误请重试", chunk);
  const legend = [
    { color: C.bearing, label: "承重墙" },
    { color: C.wall, label: "非承重墙" },
    { color: C.door, label: "未验证墙", dash: true },
    { color: C.badgeDoor, label: "门编号" },
    { color: C.badgeWindow, label: "窗编号" },
    { color: C.entry, label: "入户门" },
    { color: C.badgeRoom, label: "房间编号" },
  ];
  return svgWrap(W, H, "结构识别预览", lines, body, legend);
}

export function renderPlan(structure, plan, img = null, extraLines = []) {
  const W = structure.imgW || structure.width || 1000;
  const H = structure.imgH || structure.height || 700;
  const strokeW = Math.max(4, W * 0.006);
  const demolish = (plan.demolish || []).map(id => {
    const w = wallById(structure, id);
    return w ? `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${C.demolish}" stroke-width="${strokeW * 1.4}" stroke-dasharray="10 6"/>` : "";
  }).filter(Boolean).join("\n");
  const body = `${dimWallEls(structure, strokeW)}\n${roomEls(structure)}\n${openingEls(structure, strokeW)}\n${demolish}\n${newRoomEls(plan, W, structure)}\n${buildEls(plan, strokeW)}\n${badgeEls(structure, plan)}`;
  const chunk = Math.floor(W / 17);
  const checks = (plan.checks || []).map(c => `${c.pass ? "✓" : "✗"}${c.rule}${c.note && !c.pass ? `(${c.note})` : ""}`).join(" ");
  const lines = ["图例：色块=新增功能空间 蓝线=新砌墙 红虚线=砸墙 | 示意方案，施工前需专业鉴定",
    ...wrapLines(`规范自检：${checks}`, chunk),
    ...extraLines.flatMap(l => wrapLines(l, chunk))];
  return svgWrap(W, H, plan.title || plan.id, lines, body);
}

export function readImg(executionDir, structure) {
  if (!structure.imgW) return null;
  const dir = fs.readdirSync(executionDir);
  const file = dir.find(f => /^floorplan\.(png|jpe?g|webp)$/.test(f));
  if (!file) return null;
  const ext = path.extname(file).toLowerCase();
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[ext];
  return { base64: fs.readFileSync(path.join(executionDir, file)).toString("base64"), mime };
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
  assert(sImg.includes('data-id="w1"') && sImg.includes('data-kind="opening"') && sImg.includes('data-kind="room"'), "structure badges carry data-id for interactive highlight");
  assert(pImg.includes(C.demolish), "plan has demolish red");
  assert(pImg.includes(PALETTE[0]), "plan has newRoom fill");
  assert(pImg.includes(">功能房</text>"), "plan has newRoom label");
  assert(pImg.includes("→ 功能房"), "plan has rename badge");
  assert(pImg.includes(">客厅</text>"), "plan shows original room labels");
  assert(pImg.includes(">30㎡</text>"), "plan shows original room area");
  assert(pImg.includes("施工前需专业鉴定"), "disclaimer present");
  assert(pImg.includes("<ellipse"), "plan has toilet fixture glyph");
  assert(pImg.includes("0.49㎡"), "new-room area from areaM2");
  const sImg2 = renderStructure(structure, { base64: "iVBORw0KGgo=", mime: "image/png" });
  assert(sImg2.includes("<image href=") && sImg2.includes('opacity="0.35"'), "confirm preview overlays base image");
  assert(sImg2.includes(">w1<") && sImg2.includes(">d1<") && sImg2.includes(">r1<"), "id chips for walls/openings/rooms");
  const outDir = "/tmp/opencode";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "floorplan-demo-structure.svg"), sImg);
  fs.writeFileSync(path.join(outDir, "floorplan-demo-plan.svg"), pImg);
  console.log("render self-check OK → /tmp/opencode/floorplan-demo-*.svg");
}

if (process.argv[1]?.endsWith("render.js")) demo();
