import { GLYPHS } from "./render-arch.js";

/**
 * 确定性「3D 质感」俯视鸟瞰渲染器 v2（治 AI 图生图鸟瞰跑偏的根因，同时逼近酷家乐质感）。
 * 纯代码从 structure.json / plans.json 渲染，墙位/比例/门窗/家具位置 100% 贴合数据。
 * 质感靠：木纹/瓷砖 SVG pattern 地板 + 墙体顶面高光(bevel) + 家具渐变材质 + 高斯模糊投影。
 */

const FLOOR = {
  "现代简约": "#e8e2d4", "奶油风": "#f2e5d2", "原木日式": "#e3d0b0", "北欧": "#e7dfcf",
  "中古风": "#d9c3a0", "侘寂风": "#ddd2c2", "新中式": "#dfcfa8", "轻奢风": "#e6ddd0",
  "法式复古": "#eedfc8", "工业风": "#cfcac2", "极简黑白灰": "#dedede",
};
const FLOOR_DEFAULT = "#e8e2d4";
const TILE_BASE = "#e9edf1";
const WALL_COLOR = "#6b6259";
const WALL_BEARING = "#4a423a";
const BUILD_COLOR = "#2f6da8";
const DEMOLISH_COLOR = "#e0483e";

const FURN_COLOR = {
  bed: "#f1e3cd", sofa: "#c7b599", dining: "#d9c39a", toilet: "#f6f6f6", sink: "#f6f6f6",
  shower: "#dcecf4", bathtub: "#f6f6f6", kitchen: "#cfc7b6", desk: "#c9a06a", wardrobe: "#dcc9a6",
  tv: "#9a9a9a", fridge: "#dfe4e8", washer: "#e6ebef", table: "#c9a06a", stool: "#c9a06a", storage: "#cdc1a9",
};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wallById(structure, id) {
  return (structure.walls || []).find(w => w.id === id);
}

function isTileRoom(label) {
  return /厨房|卫生间|卫|淋浴|洗手|浴室|阳台/.test(String(label || ""));
}

// 全局 defs：木纹/瓷砖 pattern + 投影模糊 + 每类家具渐变
function defs(style) {
  const wood = FLOOR[style] || FLOOR_DEFAULT;
  const woodDark = shade(wood, -0.14);
  const grads = Object.entries(FURN_COLOR).map(([type, color]) => {
    const light = shade(color, 0.16);
    const dark = shade(color, -0.3);
    return `<linearGradient id="fp-${type}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>`;
  }).join("\n");
  return `<defs>
<pattern id="fp-wood" width="72" height="9" patternUnits="userSpaceOnUse">
  <rect width="72" height="9" fill="${wood}"/>
  <line x1="0" y1="2" x2="72" y2="2" stroke="${woodDark}" stroke-width="0.6"/>
  <line x1="20" y1="0" x2="20" y2="9" stroke="${woodDark}" stroke-width="0.3" opacity="0.5"/>
  <line x1="52" y1="0" x2="52" y2="9" stroke="${woodDark}" stroke-width="0.3" opacity="0.4"/>
  <line x1="0" y1="6.5" x2="72" y2="6.5" stroke="${shade(wood, -0.06)}" stroke-width="0.4"/>
</pattern>
<pattern id="fp-tile" width="38" height="38" patternUnits="userSpaceOnUse">
  <rect width="38" height="38" fill="${TILE_BASE}"/>
  <path d="M0 0H38 M0 0V38" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.2"/>
  <rect x="1" y="1" width="36" height="36" fill="none" stroke="#00000008" stroke-width="1"/>
</pattern>
<filter id="fp-blur" x="-30%" y="-30%" width="160%" height="160%">
  <feGaussianBlur stdDeviation="3"/>
</filter>
${grads}
</defs>`;
}

// 地板：全图木纹，厨卫/阳台盖瓷砖
function floorEls(structure, W, H) {
  const els = [`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#fp-wood)"/>`];
  for (const r of structure.rooms || []) {
    if (!isTileRoom(r.label) || !Array.isArray(r.bbox) || r.bbox.length !== 4) continue;
    const [x1, y1, x2, y2] = r.bbox.map(Number);
    els.push(`<rect x="${x1}" y="${y1}" width="${Math.max(0, x2 - x1)}" height="${Math.max(0, y2 - y1)}" fill="url(#fp-tile)"/>`);
  }
  return els.join("\n");
}

// 墙体：深色粗线 + 顶/左面高光(bevel)
function wall3D(w, th, color) {
  const vertical = Math.abs(w.y2 - w.y1) >= Math.abs(w.x2 - w.x1);
  const hl = Math.max(1.5, th * 0.25);
  const ox = vertical ? -th / 2 + hl / 2 : 0;
  const oy = vertical ? 0 : -th / 2 + hl / 2;
  return `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${color}" stroke-width="${th}" stroke-linecap="square"/>` +
    `<line x1="${w.x1 + ox}" y1="${w.y1 + oy}" x2="${w.x2 + ox}" y2="${w.y2 + oy}" stroke="#ffffff" stroke-width="${hl}" opacity="0.22" stroke-linecap="square"/>`;
}

function wallEls(structure, plan, strokeW) {
  const demolish = new Set(plan?.demolish || []);
  const kept = (structure.walls || []).map(w => {
    const th = Math.max(strokeW, w.thickness || strokeW * 2.4);
    return wall3D(w, th, w.bearing ? WALL_BEARING : WALL_COLOR);
  }).join("\n");
  const demo = (structure.walls || []).filter(w => demolish.has(w.id)).map(w =>
    `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${DEMOLISH_COLOR}" stroke-width="${Math.max(strokeW, (w.thickness || strokeW * 2.4))}" stroke-linecap="square" stroke-dasharray="10 8"/>`
  ).join("\n");
  const build = (plan?.build || []).map(b =>
    wall3D(b, Math.max(strokeW, strokeW * 2.4), BUILD_COLOR)
  ).join("\n");
  return kept + "\n" + demo + "\n" + build;
}

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
    const half = o.len ? Math.max(gapW * 1.6, Math.min(o.len / 2, gapW * 4)) : (o.type === "door" ? gapW * 3 : gapW * 3.6);
    const gx1 = cx - ux * half, gy1 = cy - uy * half;
    const gx2 = cx + ux * half, gy2 = cy + uy * half;
    els.push(`<line x1="${gx1}" y1="${gy1}" x2="${gx2}" y2="${gy2}" stroke="#ffffff" stroke-width="${gapW * 2.4}"/>`);
    if (o.type === "window") {
      const off = gapW * 0.8;
      els.push(`<line x1="${gx1 + nx * off}" y1="${gy1 + ny * off}" x2="${gx2 + nx * off}" y2="${gy2 + ny * off}" stroke="#8fb3c7" stroke-width="${gapW * 0.5}"/>`);
      els.push(`<line x1="${gx1 - nx * off}" y1="${gy1 - ny * off}" x2="${gx2 - nx * off}" y2="${gy2 - ny * off}" stroke="#8fb3c7" stroke-width="${gapW * 0.5}"/>`);
    } else {
      els.push(`<path d="M ${gx2} ${gy2} A ${half * 2} ${half * 2} 0 0 1 ${gx2 - uy * half * 2} ${gy2 + ux * half * 2}" fill="none" stroke="#b09a85" stroke-width="${gapW * 0.35}"/>`);
    }
  }
  return els.join("\n");
}

function newRoomEls(plan, W) {
  return (plan?.newRooms || []).filter(nr => Array.isArray(nr.bbox)).map(nr => {
    const [x1, y1, x2, y2] = nr.bbox.map(Number);
    const fs2 = Math.max(12, W * 0.014);
    return `<rect x="${x1}" y="${y1}" width="${Math.max(0, x2 - x1)}" height="${Math.max(0, y2 - y1)}" fill="#2f6da81a" stroke="${BUILD_COLOR}" stroke-width="1.5" stroke-dasharray="6 4"/>
<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2}" text-anchor="middle" font-size="${fs2}" fill="${BUILD_COLOR}" font-weight="bold" paint-order="stroke" stroke="#ffffff" stroke-width="3">${esc(nr.label || "")}</text>`;
  }).join("\n");
}

// 家具：渐变材质 + 高斯模糊投影 + 顶部高光 + 图标
function furn3D(type, box) {
  const [x1, y1, x2, y2] = box.map(Number);
  const w = Math.max(1, x2 - x1), h = Math.max(1, y2 - y1);
  const color = FURN_COLOR[type] || "#d9d9d9";
  const dark = shade(color, -0.34);
  const r = Math.min(6, w * 0.12, h * 0.12);
  const off = Math.max(2, Math.min(w, h) * 0.1);
  const shadow = `<rect x="${x1 + off}" y="${y1 + off}" width="${w}" height="${h}" rx="${r}" fill="#000000" opacity="0.3" filter="url(#fp-blur)"/>`;
  const body = `<rect x="${x1}" y="${y1}" width="${w}" height="${h}" rx="${r}" fill="url(#fp-${type})" stroke="${dark}" stroke-width="1"/>`;
  const hl = `<rect x="${x1 + 1}" y="${y1 + 1}" width="${Math.max(1, w - 2)}" height="${Math.max(1, h * 0.24)}" rx="${r}" fill="#ffffff" opacity="0.32"/>`;
  const icon = GLYPHS[type] ? `<g stroke="#00000055" stroke-width="1.1" fill="none">${GLYPHS[type](x1, y1, w, h)}</g>` : "";
  return shadow + body + hl + icon;
}

function furnitureEls(furniture) {
  return (furniture || []).map(f => {
    if (!f || !Array.isArray(f.bbox) || f.bbox.length !== 4) return "";
    return furn3D(f.type, f.bbox);
  }).join("\n");
}

export function renderBirdview(structure, plan, furniture, style = "") {
  const W = structure.imgW || structure.width || 1000;
  const H = structure.imgH || structure.height || 700;
  const strokeW = Math.max(4, W * 0.006);

  const body = [
    defs(style),
    floorEls(structure, W, H),
    wallEls(structure, plan, strokeW),
    openingEls(structure, strokeW),
    newRoomEls(plan, W),
    furnitureEls(furniture),
  ].join("\n");

  const total = H + 34;
  const caption = `<text x="16" y="${H + 28}" font-size="20" font-weight="bold" fill="#333333" font-family="sans-serif">${esc(plan ? `俯视鸟瞰 · ${plan.title || plan.id}` : "俯视鸟瞰（现状）")}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${total}" viewBox="0 0 ${W} ${total}" font-family="sans-serif">
<rect width="${W}" height="${total}" fill="#ffffff"/>
${body}
${caption}
</svg>`;
}

export function demo() {
  const structure = {
    imgW: 1000, imgH: 700, mmPerPx: 7,
    walls: [
      { id: "w1", x1: 50, y1: 50, x2: 950, y2: 50, bearing: true, thickness: 10 },
      { id: "w2", x1: 50, y1: 50, x2: 50, y2: 650, bearing: true, thickness: 10 },
      { id: "w3", x1: 500, y1: 50, x2: 500, y2: 350, bearing: false, thickness: 6 },
    ],
    rooms: [
      { id: "r1", label: "客厅", center: [270, 350], bbox: [50, 350, 500, 650] },
      { id: "r2", label: "卧室", center: [720, 200], bbox: [500, 50, 950, 350] },
      { id: "r3", label: "卫生间", center: [720, 600], bbox: [500, 500, 950, 650] },
    ],
    openings: [{ id: "d1", type: "door", wallId: "w3", pos: 0.8 }],
  };
  const plan = { title: "测试方案", demolish: ["w3"], build: [{ x1: 500, y1: 350, x2: 950, y2: 350 }], newRooms: [{ label: "书房", bbox: [500, 350, 950, 650] }] };
  const furniture = [{ type: "bed", bbox: [520, 80, 800, 320] }, { type: "dining", bbox: [120, 380, 420, 620] }, { type: "toilet", bbox: [540, 520, 640, 630] }];
  const svg = renderBirdview(structure, plan, furniture, "中古风");
  const assert = (c, m) => { if (!c) throw new Error(`render-birdview self-check failed: ${m}`); };
  assert(svg.includes("俯视鸟瞰") && svg.includes('id="fp-wood"'), "title + wood pattern");
  assert(svg.includes('id="fp-tile"') && svg.includes('id="fp-blur"'), "tile pattern + blur filter");
  assert(svg.includes("fp-bed") && svg.includes("feGaussianBlur"), "furniture gradient + gaussian blur");
  assert(svg.includes(DEMOLISH_COLOR) && svg.includes(BUILD_COLOR), "demolish + build walls");
  assert(svg.includes('width="1000"') && svg.includes('height='), "svg has explicit width/height");
  console.log("render-birdview self-check OK");
}

if (process.argv[1]?.endsWith("render-birdview.js")) demo();
