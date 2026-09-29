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

// label → 房间类型（面积下限用）；衣帽间/阳台等无下限；未知返回 null
export function roomTypeByLabel(label) {
  const s = String(label || "");
  if (/马桶|卫生间|卫|淋浴|浴室|洗手/.test(s)) return "toilet";
  if (/衣帽间|阳台|休闲|地台|储藏|玄关/.test(s)) return null;
  if (/书房|办公|电竞|多功能|学习|舱/.test(s)) return "study";
  if (/卧室|主卧|次卧|儿童房|睡/.test(s)) return "bedroom";
  return null;
}

// 建筑面积兜底比例尺：外围 extent 像素面积 → mm/px（图无尺寸标注时用）
export function mmPerPxFromArea(areaM2, extent) {
  const a = Number(areaM2);
  if (!extent || !Number.isFinite(a) || a <= 0) return null;
  const wPx = extent.right - extent.left, hPx = extent.bottom - extent.top;
  if (wPx <= 0 || hPx <= 0) return null;
  return Number(Math.sqrt((a * 1e6) / (wPx * hPx)).toFixed(3));
}

export function demo() {
  const assert = (c, m) => { if (!c) throw new Error(`metrics self-check failed: ${m}`); };
  assert(pxToMm(100, 13.413) === 1341.3, "pxToMm");
  assert(areaM2([0, 0, 100, 200], 10) === 2, "areaM2 1m x 2m = 2㎡");
  assert(roomTypeByLabel("独立马桶间") === "toilet", "马桶间 → toilet");
  assert(roomTypeByLabel("玻璃书房") === "study", "书房 → study");
  assert(roomTypeByLabel("未知") === null, "未知 → null");
  assert(mmPerPxFromArea(89, { left: 0, right: 1000, top: 0, bottom: 1000 }) === 9.434, "mmPerPxFromArea 89㎡/1000x1000px");
  assert(mmPerPxFromArea(0, { left: 0, right: 10, top: 0, bottom: 10 }) === null, "mmPerPxFromArea 无效面积");
  console.log("metrics self-check OK");
}

if (process.argv[1]?.endsWith("metrics.js")) demo();
