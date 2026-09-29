/**
 * 符号锚点解析器 — 治 generate 让文本 LLM hallucinate 像素坐标的根因
 *
 * 锚点三形态：
 * - { wall, t }        墙线段上 t∈[0,1] 比例点
 * - { room, edge, t }  房间 bbox 的 N/S/W/E 边上 t 比例点
 * - { x, y }           像素直传（v1 旧方案兼容）
 *
 * build/newRooms 由符号规格确定性解析为像素，validate 与 render 共用同一解析结果。
 */

const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));

export function resolveAnchor(a, structure) {
  if (!a || typeof a !== "object") return null;
  if (Number.isFinite(Number(a.x)) && Number.isFinite(Number(a.y)) && (a.x !== undefined || a.y !== undefined) && Object.keys(a).every(k => ["x", "y"].includes(k))) {
    return { x: Number(a.x), y: Number(a.y) };
  }
  if (a.wall) {
    const w = (structure.walls || []).find(w => w.id === a.wall);
    if (!w) return null;
    const t = clamp01(a.t);
    return { x: w.x1 + (w.x2 - w.x1) * t, y: w.y1 + (w.y2 - w.y1) * t };
  }
  if (a.room && a.edge) {
    const r = (structure.rooms || []).find(r => r.id === a.room);
    if (!r || !Array.isArray(r.bbox) || r.bbox.length !== 4) return null;
    const [x1, y1, x2, y2] = r.bbox.map(Number);
    const t = clamp01(a.t);
    switch (String(a.edge).toUpperCase()[0]) {
      case "N": return { x: x1 + (x2 - x1) * t, y: y1 };
      case "S": return { x: x1 + (x2 - x1) * t, y: y2 };
      case "W": return { x: x1, y: y1 + (y2 - y1) * t };
      case "E": return { x: x2, y: y1 + (y2 - y1) * t };
      default: return null;
    }
  }
  return null;
}

function isPixelBox(b) {
  return b && ["x1", "y1", "x2", "y2"].every(k => Number.isFinite(Number(b[k]))) && !b.from && !b.to;
}

/**
 * 把方案里的符号规格解析为像素：
 * - build: [{from,to}] 锚点对 → {x1,y1,x2,y2}；像素直传原样保留
 * - newRooms: [{label, room, rel:[0-1 x4]}] → 房间 bbox 内像素矩形；像素 bbox 直传保留
 * 解析失败的条目丢弃并记入 errors（下游按缺项报错/丢弃方案）
 */
export function resolvePlanSpecs(p, structure) {
  const errors = [];
  const buildIn = Array.isArray(p.build) ? p.build : [];
  const build = buildIn.map((b, i) => {
    if (isPixelBox(b)) return { x1: Number(b.x1), y1: Number(b.y1), x2: Number(b.x2), y2: Number(b.y2) };
    const from = resolveAnchor(b?.from, structure);
    const to = resolveAnchor(b?.to, structure);
    if (!from || !to) {
      errors.push(`build[${i}] 锚点无法解析（wall/room id 不存在或形态错误）`);
      return null;
    }
    return { x1: Math.round(from.x), y1: Math.round(from.y), x2: Math.round(to.x), y2: Math.round(to.y) };
  }).filter(Boolean);

  const newRoomsIn = Array.isArray(p.newRooms) ? p.newRooms : [];
  const newRooms = newRoomsIn.map((nr, i) => {
    if (!nr || typeof nr.label !== "string") { errors.push(`newRooms[${i}] 缺 label`); return null; }
    if (Array.isArray(nr.bbox) && nr.bbox.length === 4 && nr.bbox.every(v => Number.isFinite(Number(v))) && !nr.rel) {
      return { ...nr, bbox: nr.bbox.map(Number) };
    }
    const r = (structure.rooms || []).find(r => r.id === nr.room);
    if (!r || !Array.isArray(r.bbox) || r.bbox.length !== 4 || !Array.isArray(nr.rel) || nr.rel.length !== 4) {
      errors.push(`newRooms[${i}]（${nr.label}）缺 room 引用或 rel 相对框`);
      return null;
    }
    const [x1, y1, x2, y2] = r.bbox.map(Number);
    const [a, b, c, d] = nr.rel.map(clamp01);
    return {
      ...nr,
      bbox: [
        Math.round(x1 + (x2 - x1) * Math.min(a, c)),
        Math.round(y1 + (y2 - y1) * Math.min(b, d)),
        Math.round(x1 + (x2 - x1) * Math.max(a, c)),
        Math.round(y1 + (y2 - y1) * Math.max(b, d)),
      ],
    };
  }).filter(Boolean);

  return { build, newRooms, errors };
}
