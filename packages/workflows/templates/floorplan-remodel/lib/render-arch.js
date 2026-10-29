import { areaM2 } from "./metrics.js";

/**
 * 户型设计交付视图渲染器：
 * - renderArchitectural：原始建筑图（干净矢量 + 尺寸标注，不叠原图）
 * - renderLayout：平面布置图（2D 线稿全屋家具俯视图元）
 * 真源仍是 structure.json / plans.json，本文件只做派生渲染。
 */

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
  furn: "#555555",
};

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function lineEl(x1, y1, x2, y2, stroke, w, dash) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}

function wallById(structure, id) {
  return (structure.walls || []).find(w => w.id === id);
}

function svgWrap(W, H, title, lines, body) {
  const strip = 34 + lines.length * 22;
  const total = H + strip;
  const caption = [
    `<text x="16" y="${H + 30}" font-size="22" font-weight="bold" fill="${C.text}" font-family="sans-serif">${esc(title)}</text>`,
    ...lines.map((l, i) => `<text x="16" y="${H + 56 + i * 22}" font-size="14" fill="${C.sub}" font-family="sans-serif">${esc(l)}</text>`),
  ].join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${total}" font-family="sans-serif">
<rect width="${W}" height="${total}" fill="#ffffff"/>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${body}
${caption}
</svg>`;
}

// 承重红、非承重黑、未验证灰虚线（干净矢量，无编号徽章）
function wallElsArch(structure, strokeW) {
  return (structure.walls || []).map(w => {
    if (w.unverified) return lineEl(w.x1, w.y1, w.x2, w.y2, C.door, strokeW * 0.6, "8 8");
    return lineEl(w.x1, w.y1, w.x2, w.y2, w.bearing ? C.bearing : C.wall, w.bearing ? strokeW * 1.5 : strokeW);
  }).join("\n");
}

function openingElsArch(structure, gapW) {
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
    const half = o.len ? Math.max(gapW * 1.5, Math.min(o.len / 2, gapW * 4)) : (o.type === "door" ? gapW * 3 : gapW * 3.6);
    const gx1 = cx - ux * half, gy1 = cy - uy * half;
    const gx2 = cx + ux * half, gy2 = cy + uy * half;
    els.push(lineEl(gx1, gy1, gx2, gy2, "#ffffff", gapW * 2));
    if (o.type === "window") {
      const off = gapW * 0.7;
      els.push(lineEl(gx1 + nx * off, gy1 + ny * off, gx2 + nx * off, gy2 + ny * off, C.window, gapW * 0.4));
      els.push(lineEl(gx1 - nx * off, gy1 - ny * off, gx2 - nx * off, gy2 - ny * off, C.window, gapW * 0.4));
    } else {
      els.push(`<path d="M ${gx2} ${gy2} A ${half * 2} ${half * 2} 0 0 1 ${gx2 - uy * half * 2} ${gy2 + ux * half * 2}" fill="none" stroke="${C.door}" stroke-width="${gapW * 0.3}"/>`);
    }
  }
  return els.join("\n");
}

function roomElsArch(structure) {
  return (structure.rooms || []).map(r => {
    const [cx, cy] = r.center || [500, 500];
    const area = areaM2(r.bbox, structure.mmPerPx);
    const areaText = area != null ? `${area}㎡` : (r.area || "");
    return `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="24" font-weight="bold" fill="${C.text}">${esc(r.label || "")}</text>` +
      (areaText ? `\n<text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="16" fill="${C.sub}">${esc(areaText)}</text>` : "");
  }).join("\n");
}

// 尺寸标注链：structure.dims 标注行（图上有尺寸标注时）；无标注则用 mmPerPx 反算外围 extent
function dimensionEls(structure) {
  const els = [];
  const off = 26;
  const dims = structure.dims || [];
  for (const d of dims) {
    const horiz = d.edge === "top" || d.edge === "bottom";
    const outwardTop = d.edge === "top";
    const outwardLeft = d.edge === "left";
    const x1 = Number(d.x1) || 0, y1 = Number(d.y1) || 0, x2 = Number(d.x2) || 0, y2 = Number(d.y2) || 0;
    const len = horiz ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
    if (len < 20) continue;
    const values = (d.values || []).filter(v => v > 0);
    const total = values.reduce((a, b) => a + b, 0);
    const lx = horiz ? Math.min(x1, x2) : (outwardLeft ? Math.min(x1, x2) - off : Math.max(x1, x2) + off);
    const ly = horiz ? (outwardTop ? Math.min(y1, y2) - off : Math.max(y1, y2) + off) : Math.min(y1, y2);
    const ex = horiz ? lx + len : lx;
    const ey = horiz ? ly : ly + len;
    els.push(lineEl(lx, ly, ex, ey, "#999999", 1));
    els.push(horiz ? lineEl(lx, ly - 3, lx, ly + 3, "#999999", 1) : lineEl(lx - 3, ly, lx + 3, ly, "#999999", 1));
    let acc = 0;
    for (const v of values) {
      const seg = total > 0 ? (v / total) * len : len / Math.max(1, values.length);
      const mid = acc + seg / 2;
      const tickX = horiz ? lx + acc : lx;
      const tickY = horiz ? ly : ly + acc;
      if (acc > 0) els.push(horiz ? lineEl(tickX, ly - 3, tickX, ly + 3, "#999999", 1) : lineEl(lx - 3, tickY, lx + 3, tickY, "#999999", 1));
      const tx = horiz ? lx + mid : lx + (outwardLeft ? -6 : 6);
      const ty = horiz ? ly + (outwardTop ? -6 : 14) : ly + mid;
      els.push(`<text x="${tx}" y="${ty}" ${horiz ? 'text-anchor="middle"' : (outwardLeft ? 'text-anchor="end"' : 'text-anchor="start"')} font-size="13" fill="#555555">${Math.round(v)}</text>`);
      acc += seg;
    }
    els.push(horiz ? lineEl(ex, ly - 3, ex, ly + 3, "#999999", 1) : lineEl(lx - 3, ey, lx + 3, ey, "#999999", 1));
  }
  // 无尺寸标注但有比例尺 → 外围 extent 兜底尺寸
  if (dims.length === 0 && structure.mmPerPx && (structure.walls || []).length) {
    const xs = structure.walls.flatMap(w => [w.x1, w.x2]);
    const ys = structure.walls.flatMap(w => [w.y1, w.y2]);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const wmm = Math.round((right - left) * structure.mmPerPx);
    const hmm = Math.round((bottom - top) * structure.mmPerPx);
    els.push(lineEl(left, top - off, right, top - off, "#999999", 1));
    els.push(`<text x="${(left + right) / 2}" y="${top - off - 6}" text-anchor="middle" font-size="13" fill="#555555">${wmm}</text>`);
    els.push(lineEl(left - off, top, left - off, bottom, "#999999", 1));
    els.push(`<text x="${left - off - 6}" y="${(top + bottom) / 2}" text-anchor="middle" font-size="13" fill="#555555" transform="rotate(-90 ${left - off - 6} ${(top + bottom) / 2})">${hmm}</text>`);
  }
  return els.join("\n");
}

export function renderArchitectural(structure) {
  const W = structure.imgW || structure.width || 1000;
  const H = structure.imgH || structure.height || 700;
  const strokeW = Math.max(4, W * 0.006);
  const bearing = (structure.walls || []).filter(w => w.bearing).length;
  const body = [wallElsArch(structure, strokeW), openingElsArch(structure, strokeW), roomElsArch(structure), dimensionEls(structure)].join("\n");
  const scale = structure.mmPerPx ? `${structure.mmPerPx} mm/px（${structure.scaleSource === "areaM2" ? "建筑面积估算" : "图上标注"}）` : "比例尺缺失";
  return svgWrap(W, H, "原始建筑图（量房结构）", [
    `图例：红=承重墙 黑=隔墙 灰虚线=未验证墙 · ${scale}`,
    `墙 ${(structure.walls || []).length}（承重 ${bearing}）· 房间 ${(structure.rooms || []).length} · 门窗 ${(structure.openings || []).length}`,
  ], body);
}

// ─── 家具俯视图元库 ──────────────────────────────────────────────

export const GLYPHS = {
  bed: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="none"/><rect x="${x}" y="${y}" width="${w * 0.22}" height="${h}" fill="#bbb"/>`,
  sofa: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="none"/><rect x="${x}" y="${y}" width="${w}" height="${h * 0.3}" fill="#bbb"/><rect x="${x}" y="${y}" width="${w * 0.12}" height="${h}" fill="#ccc"/><rect x="${x + w * 0.88}" y="${y}" width="${w * 0.12}" height="${h}" fill="#ccc"/>`,
  dining: (x, y, w, h) => {
    const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) * 0.28;
    let g = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"/>`;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      g += `<circle cx="${cx + dx * w * 0.36}" cy="${cy + dy * h * 0.36}" r="${Math.min(w, h) * 0.1}" fill="none"/>`;
    }
    return g;
  },
  toilet: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w * 0.35}" height="${h}" fill="none"/><ellipse cx="${x + w * 0.7}" cy="${y + h / 2}" rx="${w * 0.3}" ry="${h * 0.45}" fill="none"/>`,
  sink: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="none"/><ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w * 0.3}" ry="${h * 0.3}" fill="none"/>`,
  shower: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"/><line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}"/><circle cx="${x + w * 0.15}" cy="${y + h * 0.15}" r="${Math.min(w, h) * 0.08}" fill="#bbb"/>`,
  bathtub: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) * 0.3}" fill="none"/><circle cx="${x + w * 0.8}" cy="${y + h * 0.2}" r="${Math.min(w, h) * 0.07}" fill="#bbb"/>`,
  kitchen: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"/><rect x="${x + w * 0.06}" y="${y + h * 0.06}" width="${w * 0.36}" height="${h * 0.88}" fill="#ccc"/>${[0, 1].map(r => [0, 1].map(c => `<circle cx="${x + w * (0.6 + c * 0.24)}" cy="${y + h * (0.3 + r * 0.4)}" r="${Math.min(w, h) * 0.08}" fill="none"/>`).join("")).join("")}`,
  desk: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h * 0.5}" fill="none"/><rect x="${x + w * 0.35}" y="${y + h * 0.6}" width="${w * 0.3}" height="${h * 0.4}" fill="none"/>`,
  wardrobe: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"/><line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}"/>`,
  tv: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h * 0.4}" fill="#bbb"/><line x1="${x + w * 0.15}" y1="${y + h * 0.4}" x2="${x + w * 0.85}" y2="${y + h * 0.4}"/>`,
  fridge: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"/><line x1="${x}" y1="${y + h * 0.4}" x2="${x + w}" y2="${y + h * 0.4}"/>`,
  washer: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"/><circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) * 0.35}" fill="none"/>`,
  table: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="none"/>`,
  stool: (x, y, w, h) => `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) / 2}" fill="none"/>`,
  storage: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"/><line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}"/><line x1="${x + w}" y1="${y}" x2="${x}" y2="${y + h}"/>`,
};

export function furnitureGlyph(type, box) {
  const [x1, y1, x2, y2] = box.map(Number);
  const w = Math.max(1, x2 - x1), h = Math.max(1, y2 - y1);
  // 浅灰底填充让家具呈「实心块」，图生图模型更好识别为家具而非线框
  const base = `<rect x="${x1}" y="${y1}" width="${w}" height="${h}" rx="3" fill="#e6e6e6" stroke="none"/>`;
  const draw = GLYPHS[type];
  if (!draw) return base + `<rect x="${x1}" y="${y1}" width="${w}" height="${h}" fill="none" stroke="${C.furn}" stroke-dasharray="4 3"/>`;
  return `<g>${base}<g stroke="${C.furn}" stroke-width="2" fill="none">${draw(x1, y1, w, h)}</g></g>`;
}

const FURN_LABEL = { bed: "床", sofa: "沙发", dining: "餐桌", toilet: "马桶", sink: "洗手台", shower: "淋浴", bathtub: "浴缸", kitchen: "橱柜", desk: "书桌", wardrobe: "衣柜", tv: "电视柜", fridge: "冰箱", washer: "洗衣机", table: "茶几", stool: "椅凳", storage: "收纳" };

function furnitureEls(furniture, noLabels = false) {
  return (furniture || []).map((f, i) => {
    if (!f || !Array.isArray(f.bbox) || f.bbox.length !== 4) return "";
    const label = FURN_LABEL[f.type];
    const [x1, y1, x2, y2] = f.bbox.map(Number);
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    return `<g opacity="0.9">${furnitureGlyph(f.type, f.bbox)}` +
      (!noLabels && label && (x2 - x1) > 22 && (y2 - y1) > 16 ? `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="11" fill="#888888" font-family="sans-serif">${label}</text>` : "") +
      `</g>`;
  }).join("\n");
}

export function renderLayout(structure, plan, furniture, opts = {}) {
  const { noLabels = false } = opts;
  const W = structure.imgW || structure.width || 1000;
  const H = structure.imgH || structure.height || 700;
  const strokeW = Math.max(4, W * 0.006);
  const demolish = new Set(plan?.demolish || []);
  const walls = (structure.walls || []).map(w =>
    demolish.has(w.id)
      ? lineEl(w.x1, w.y1, w.x2, w.y2, C.demolish, strokeW * 1.2, "10 6")
      : lineEl(w.x1, w.y1, w.x2, w.y2, C.dim, strokeW)
  ).join("\n");
  const build = (plan?.build || []).map(b => lineEl(b.x1, b.y1, b.x2, b.y2, C.build, strokeW, "")).join("\n");
  const newRooms = (plan?.newRooms || []).filter(nr => Array.isArray(nr.bbox)).map(nr =>
    `<rect x="${nr.bbox[0]}" y="${nr.bbox[1]}" width="${Math.max(0, nr.bbox[2] - nr.bbox[0])}" height="${Math.max(0, nr.bbox[3] - nr.bbox[1])}" fill="none" stroke="${C.build}" stroke-width="1.5" stroke-dasharray="6 4"/>`
  ).join("\n");
  const parts = [walls, build, newRooms, openingElsArch(structure, strokeW)];
  if (!noLabels) parts.push(roomElsArch(structure));
  parts.push(furnitureEls(furniture, noLabels));
  const body = parts.join("\n");
  const title = plan ? `平面布置图 · ${plan.title || plan.id}` : "平面布置图（现状）";
  return svgWrap(W, H, title, ["图例：灰=墙 红虚线=砸墙 蓝=新墙/新房间 · 家具俯视图元"], body);
}

export function demo() {
  const structure = {
    imgW: 1000, imgH: 700, mmPerPx: 7, scaleSource: "dims",
    walls: [
      { id: "w1", x1: 50, y1: 50, x2: 950, y2: 50, bearing: true },
      { id: "w2", x1: 50, y1: 50, x2: 50, y2: 650, bearing: true },
      { id: "w3", x1: 500, y1: 50, x2: 500, y2: 350, bearing: false },
      { id: "w4", x1: 50, y1: 650, x2: 950, y2: 650, bearing: true },
    ],
    rooms: [{ id: "r1", label: "客厅", center: [270, 350], bbox: [50, 350, 500, 650] }, { id: "r2", label: "卧室", center: [720, 200], bbox: [500, 50, 950, 350] }],
    openings: [{ id: "d1", type: "door", wallId: "w3", pos: 0.8 }],
    dims: [{ edge: "top", values: [3600, 2700], x1: 50, y1: 50, x2: 950, y2: 50 }],
  };
  const plan = { title: "测试方案", demolish: ["w3"], build: [{ x1: 500, y1: 350, x2: 950, y2: 350 }], newRooms: [{ label: "书房", bbox: [500, 350, 950, 650] }] };
  const furniture = [
    { type: "bed", bbox: [520, 80, 800, 320] },
    { type: "dining", bbox: [120, 380, 420, 620] },
  ];
  const arch = renderArchitectural(structure);
  const layout = renderLayout(structure, plan, furniture);
  const layoutOrig = renderLayout(structure, null, furniture);
  const assert = (c, m) => { if (!c) throw new Error(`render-arch self-check failed: ${m}`); };
  assert(arch.includes("原始建筑图") && arch.includes("3600") && arch.includes("承重"), "architecture has title + dim value");
  assert(!arch.includes("data-id"), "architecture has no id badges");
  assert(layout.includes("平面布置图") && layout.includes(C.demolish) && layout.includes("床") && layout.includes("餐桌"), "layout has walls/furniture");
  assert(layoutOrig.includes("现状"), "original layout title");
  const layoutClean = renderLayout(structure, plan, furniture, { noLabels: true });
  assert(!layoutClean.includes(">床<") && !layoutClean.includes(">客厅<") && layoutClean.includes(C.build), "noLabels removes text labels but keeps walls/furniture glyphs");
  console.log("render-arch self-check OK");
}

if (process.argv[1]?.endsWith("render-arch.js")) demo();
