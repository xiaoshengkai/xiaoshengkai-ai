import { fileURLToPath } from "node:url";

export function pxToMm(px, mmPerPx) {
  return Number(px) * (Number(mmPerPx) || 0);
}

// bbox: [x1,y1,x2,y2] 像素 → 平方米
export function areaM2(bbox, mmPerPx) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !mmPerPx) return null;
  const wMm = pxToMm(Math.abs(bbox[2] - bbox[0]), mmPerPx);
  const hMm = pxToMm(Math.abs(bbox[3] - bbox[1]), mmPerPx);
  return Number((wMm * hMm / 1e6).toFixed(2));
}

// label → 房间类型（面积下限用）；未知返回 null
export function roomTypeByLabel(label) {
  const s = String(label || "");
  if (/马桶|卫生间|卫|淋浴|浴室/.test(s)) return "toilet";
  if (/卧室|主卧|次卧|儿童房|睡/.test(s)) return "bedroom";
  if (/书房|办公|电竞|多功能|学习|衣帽间/.test(s)) return "study";
  return null;
}

export function demo() {
  const assert = (c, m) => { if (!c) throw new Error(`metrics self-check failed: ${m}`); };
  assert(pxToMm(100, 13.413) === 1341.3, "pxToMm");
  assert(areaM2([0, 0, 100, 200], 10) === 2, "areaM2 1m x 2m = 2㎡");
  assert(roomTypeByLabel("独立马桶间") === "toilet", "马桶间 → toilet");
  assert(roomTypeByLabel("玻璃书房") === "study", "书房 → study");
  assert(roomTypeByLabel("未知") === null, "未知 → null");
  console.log("metrics self-check OK");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) demo();
