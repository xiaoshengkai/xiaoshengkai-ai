import { GLYPHS } from "./render-arch.js";

/**
 * 确定性「3D 感」俯视鸟瞰渲染器（治 AI 图生图鸟瞰跑偏的根因）。
 * 纯代码从 structure.json / plans.json 渲染，墙位/比例/门窗/家具位置 100% 贴合数据。
 * 3D 感靠：地面填充 + 家具投影/侧边高光 + 门窗符号，不依赖 AI。
 */

const FLOOR = {
  "现代简约": "#ece9e2", "奶油风": "#f3e9db", "原木日式": "#e9dcc6", "北欧": "#ebe7de",
  "中古风": "#e4d6bf", "侘寂风": "#ded6ca", "新中式": "#e6dac4", "轻奢风": "#ebe5da",
  "法式复古": "#f1e6d7", "工业风": "#d9d5cf", "极简黑白灰": "#e2e2e2",
};
const FLOOR_DEFAULT = "#ece9e2";
const WALL_COLOR = "#5f574e";
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

// 墙体：保留灰、承重稍深、新墙蓝、拆墙红虚线；按墙厚画粗线
function wallEls(structure, plan, strokeW) {
  const demolish = new Set(plan?.demolish || []);
  const kept = (structure.walls || []).map(w => {
    const th = Math.max(strokeW, w.thickness || strokeW * 2.4);
    const color = w.bearing ? "#3f3a34" : WALL_COLOR;
    return `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${color}" stroke-width="${th}" stroke-linecap="square"/>`;
  }).join("\n");
  const demo = (structure.walls || []).filter(w => demolish.has(w.id)).map(w =>
    `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${DEMOLISH_COLOR}" stroke-width="${Math.max(strokeW, (w.thickness || strokeW * 2.4))}" stroke-linecap="square" stroke-dasharray="10 8"/>`
  ).join("\n");
  const build = (plan?.build || []).map(b =>
    `<line x1="${b.x1}" y1="${b.y1}" x2="${b.x2}" y2="${b.y2}" stroke="${BUILD_COLOR}" stroke-width="${Math.max(strokeW, strokeW * 2.4)}" stroke-linecap="square"/>`
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

function furn3D(type, box) {
  const [x1, y1, x2, y2] = box.map(Number);
  const w = Math.max(1, x2 - x1), h = Math.max(1, y2 - y1);
  const color = FURN_COLOR[type] || "#d9d9d9";
  const dark = shade(color, -0.24);
  const r = Math.min(6, w * 0.12, h * 0.12);
  const off = Math.max(2, Math.min(w, h) * 0.09);
  const shadow = `<rect x="${x1 + off}" y="${y1 + off}" width="${w}" height="${h}" rx="${r}" fill="#0000001c"/>`;
  const body = `<rect x="${x1}" y="${y1}" width="${w}" height="${h}" rx="${r}" fill="${color}" stroke="${dark}" stroke-width="1.5"/>`;
  const hl = `<rect x="${x1 + 1}" y="${y1 + 1}" width="${Math.max(1, w - 2)}" height="${Math.max(1, h * 0.28)}" rx="${r}" fill="#ffffff42"/>`;
  const icon = GLYPHS[type] ? `<g stroke="#00000055" stroke-width="1.2" fill="none">${GLYPHS[type](x1, y1, w, h)}</g>` : "";
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
  const floor = FLOOR[style] || FLOOR_DEFAULT;

  const body = [
    `<rect x="0" y="0" width="${W}" height="${H}" fill="${floor}"/>`,
    wallEls(structure, plan, strokeW),
    openingEls(structure, strokeW),
    newRoomEls(plan, W),
    furnitureEls(furniture),
  ].join("\n");

  const total = H + 34;
  const caption = `<text x="16" y="${H + 28}" font-size="20" font-weight="bold" fill="#333333" font-family="sans-serif">${esc(plan ? `俯视鸟瞰 · ${plan.title || plan.id}` : "俯视鸟瞰（现状）")}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${total}" font-family="sans-serif">
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
    rooms: [{ id: "r1", label: "客厅", center: [270, 350], bbox: [50, 350, 500, 650] }, { id: "r2", label: "卧室", center: [720, 200], bbox: [500, 50, 950, 350] }],
    openings: [{ id: "d1", type: "door", wallId: "w3", pos: 0.8 }],
  };
  const plan = { title: "测试方案", demolish: ["w3"], build: [{ x1: 500, y1: 350, x2: 950, y2: 350 }], newRooms: [{ label: "书房", bbox: [500, 350, 950, 650] }] };
  const furniture = [{ type: "bed", bbox: [520, 80, 800, 320] }, { type: "dining", bbox: [120, 380, 420, 620] }, { type: "toilet", bbox: [520, 380, 640, 500] }];
  const svg = renderBirdview(structure, plan, furniture, "中古风");
  const assert = (c, m) => { if (!c) throw new Error(`render-birdview self-check failed: ${m}`); };
  assert(svg.includes("俯视鸟瞰") && svg.includes(FLOOR["中古风"]), "title + floor fill");
  assert(svg.includes(DEMOLISH_COLOR) && svg.includes(BUILD_COLOR), "demolish + build walls");
  assert(svg.includes("#0000001c") && svg.includes("书房"), "furniture shadow + newRoom label");
  console.log("render-birdview self-check OK");
}

if (process.argv[1]?.endsWith("render-birdview.js")) demo();
