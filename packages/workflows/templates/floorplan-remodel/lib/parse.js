import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { callMultimodalLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { renderStructure } from "./render.js";
import { loadWallMask, snapPoint, nearMask, snapPerimeter } from "./snap.js";

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function getImageSize(imagePath) {
  try {
    const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", imagePath], { encoding: "utf-8" });
    const w = Number((out.match(/pixelWidth:\s*(\d+)/) || [])[1]);
    const h = Number((out.match(/pixelHeight:\s*(\d+)/) || [])[1]);
    if (w > 0 && h > 0) return { imgW: w, imgH: h };
  } catch { /* fall through */ }
  return { imgW: null, imgH: null };
}

function buildSystem(imgW, imgH) {
  return `你是户型图结构化识别专家。观察用户上传的户型图，输出严格 JSON（不要 markdown 围栏）。
坐标系：原图像素坐标，x∈[0,${imgW}]，y∈[0,${imgH}]，y 向下。
{
  "walls": [{ "id": "w1", "x1": <px>, "y1": <px>, "x2": <px>, "y2": <px>, "bearing": <true/false>, "confidence": <0-1> }],
  "rooms": [{ "id": "r1", "label": "<图上房间名>", "center": [x, y], "area": "<图上标注面积，如 12㎡；无则 null>", "bbox": [x1, y1, x2, y2] }],
  "openings": [{ "id": "d1", "type": "door|window", "wallId": "<所属墙id>", "pos": <0-1 沿墙起点到终点比例> }],
  "dims": [{ "edge": "top|bottom|left|right", "values": [<该排尺寸标注的毫米数，按从左到右/从上到下顺序>], "x1": <该排标注覆盖的起点x>, "y1": <起点y>, "x2": <终点x>, "y2": <终点y> }],
  "notes": "<朝向等说明，一句话>"
}
识别规则：
- 每面直墙一条线段，端点精确贴合墙线中心；线段必须沿图中黑色墙体的中心线描摹
- 尺寸标注线（图外围带箭头和数字的细线）不是墙！坐标严禁参考标注线，必须落在墙体像素上
- 外墙与加粗黑墙 bearing=true，室内薄隔墙 bearing=false
- 承重判断不确定时 confidence<0.7（下游会把低置信墙按承重处理，宁可保守）
- rooms.bbox 取房间墙线内边界矩形；center 取几何中心
- 门=带弧线开口，窗=墙上细线开口
- dims：只录图上清晰可见的尺寸标注排（如顶部 2670/3415/1070），values 按标注原文数字，x1y1x2y2 取该排尺寸线两端对应的墙体像素位置；看不清就不录`;
}

function validate(structure) {
  const errors = [];
  if (!structure || typeof structure !== "object") return ["输出不是 JSON 对象"];
  if (!Array.isArray(structure.walls) || structure.walls.length === 0) errors.push("walls 为空");
  if (!Array.isArray(structure.rooms) || structure.rooms.length === 0) errors.push("rooms 为空");
  (structure.walls || []).forEach((w, i) => {
    if (!["x1", "y1", "x2", "y2"].every(k => Number.isFinite(Number(w?.[k])))) errors.push(`walls[${i}] 坐标不完整`);
  });
  return errors;
}

function normalize(structure, imgW, imgH) {
  const clampC = v => Math.max(0, Math.min(1, Number(v) || 0));
  const clampX = v => imgW ? Math.max(0, Math.min(imgW, Number(v) || 0)) : Number(v) || 0;
  const clampY = v => imgH ? Math.max(0, Math.min(imgH, Number(v) || 0)) : Number(v) || 0;
  return {
    imgW, imgH,
    width: imgW || 1000,
    height: imgH || 700,
    walls: (structure.walls || []).map((w, i) => ({
      id: String(w.id || `w${i + 1}`),
      x1: clampX(w.x1), y1: clampY(w.y1), x2: clampX(w.x2), y2: clampY(w.y2),
      bearing: Boolean(w.bearing) || clampC(w.confidence) < 0.7,
      confidence: clampC(w.confidence),
    })),
    rooms: (structure.rooms || []).map((r, i) => ({
      id: String(r.id || `r${i + 1}`),
      label: String(r.label || `房间${i + 1}`),
      center: Array.isArray(r.center) ? r.center.map(Number) : [500, 350],
      area: r.area ? String(r.area) : null,
      bbox: Array.isArray(r.bbox) && r.bbox.length === 4 ? r.bbox.map(v => Number(v) || 0) : null,
    })),
    openings: (structure.openings || []).map((o, i) => ({
      id: String(o.id || `o${i + 1}`),
      type: o.type === "window" ? "window" : "door",
      wallId: String(o.wallId || ""),
      pos: clampC(o.pos),
    })),
    dims: (structure.dims || []).filter(d => Array.isArray(d.values) && d.values.length > 0).map(d => ({
      edge: String(d.edge || ""),
      values: d.values.map(Number).filter(v => v > 0),
      x1: Number(d.x1) || 0, y1: Number(d.y1) || 0, x2: Number(d.x2) || 0, y2: Number(d.y2) || 0,
    })),
    notes: String(structure.notes || ""),
  };
}

function computeMmPerPx(normalized) {
  const samples = [];
  for (const d of normalized.dims) {
    const span = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
    const total = d.values.reduce((a, b) => a + b, 0);
    if (span > 50 && total > 0) samples.push(total / span);
  }
  if (samples.length === 0) return null;
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const consistent = samples.filter(s => Math.abs(s - median) / median < 0.2);
  if (consistent.length === 0) return null;
  return Number((consistent.reduce((a, b) => a + b, 0) / consistent.length).toFixed(3));
}

async function snapWalls(normalized, imagePath) {
  if (!normalized.imgW) return { snapped: 0, missed: 0 };
  const pts = await loadWallMask(imagePath);
  const R = Math.max(80, normalized.imgW * 0.12);
  snapPerimeter(normalized.walls, pts, normalized.imgW);
  let snapped = 0, missed = 0;
  for (const w of normalized.walls) {
    const orig = { ...w };
    let ok = true;
    for (const key of [["x1", "y1"], ["x2", "y2"]]) {
      const s = snapPoint(w[key[0]], w[key[1]], pts, R);
      if (s) { w[key[0]] = Math.round(s.x); w[key[1]] = Math.round(s.y); snapped++; }
      else { missed++; ok = false; }
    }
    if (ok) {
      const vertical = Math.abs(orig.y2 - orig.y1) >= Math.abs(orig.x2 - orig.x1);
      if (vertical) { const x = Math.round((w.x1 + w.x2) / 2); w.x1 = x; w.x2 = x; }
      else { const y = Math.round((w.y1 + w.y2) / 2); w.y1 = y; w.y2 = y; }
    }
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
    const samples = 8;
    let onWall = 0;
    for (let i = 0; i <= samples; i++) {
      const x = w.x1 + (w.x2 - w.x1) * i / samples;
      const y = w.y1 + (w.y2 - w.y1) * i / samples;
      if (nearMask(x, y, pts, 8)) onWall++;
    }
    if (onWall / (samples + 1) < 0.75) { Object.assign(w, orig); w.unverified = true; missed += 2; }
  }
  return { snapped, missed };
}

function qualityChecks(normalized) {
  const checks = [];
  const { imgW, imgH, walls } = normalized;
  const tol = (imgW || 1000) * 0.02;
  let orphans = 0;
  for (const w of walls) {
    for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) {
      const connected = walls.some(o => o !== w &&
        (Math.hypot(o.x1 - x, o.y1 - y) < tol || Math.hypot(o.x2 - x, o.y2 - y) < tol));
      if (!connected) orphans++;
    }
  }
  checks.push({ rule: "墙体端点连通", pass: orphans <= 2, note: orphans > 2 ? `${orphans} 个悬空端点，识别可能漏墙` : "" });
  const noBbox = normalized.rooms.filter(r => !r.bbox).length;
  checks.push({ rule: "房间 bbox 完整", pass: noBbox === 0, note: noBbox ? `${noBbox} 个房间缺 bbox` : "" });
  const bearingRatio = walls.filter(w => w.bearing).length / Math.max(1, walls.length);
  checks.push({ rule: "承重比例合理", pass: bearingRatio > 0.2 && bearingRatio < 0.95, note: `承重占 ${(bearingRatio * 100).toFixed(0)}%` });
  if (imgW) checks.push({ rule: "坐标在图内", pass: true, note: "" });
  return checks;
}

export async function parseFloorPlan(imagePath, executionDir) {
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error("缺少户型图，请先上传");
  const ext = path.extname(imagePath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error("不支持的图片格式，请上传 png/jpg/webp");
  const imgFile = `floorplan${ext}`;
  fs.copyFileSync(imagePath, path.join(executionDir, imgFile));
  const { imgW, imgH } = getImageSize(imagePath);
  if (!imgW) throw new Error("无法读取图片尺寸，请换 png/jpg 格式重试");
  const dataUrl = `data:${mime};base64,${fs.readFileSync(imagePath).toString("base64")}`;

  let lastErrors = [];
  const candidates = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryHint = lastErrors.length ? `\n上次输出有问题：${lastErrors.join("；")}。请修正后重新输出完整 JSON。` : "";
    const { text } = await callMultimodalLLM({
      system: buildSystem(imgW, imgH) + retryHint,
      user: "识别这张户型图，直接输出 JSON，不要冗长推理。",
      images: [dataUrl],
      temperature: 0.2,
      maxTokens: 16000,
    });
    let parsed;
    try {
      parsed = parseJSON(text);
    } catch (e) {
      lastErrors = [e instanceof Error ? e.message : String(e)];
      continue;
    }
    lastErrors = validate(parsed);
    if (lastErrors.length === 0) candidates.push(normalize(parsed, imgW, imgH));
  }
  if (candidates.length === 0) throw new Error(`户型图识别失败：${lastErrors.join("；")}。请换更清晰的户型图重试`);

  let normalized = null;
  let snapStats = null;
  for (const c of candidates) {
    c.mmPerPx = computeMmPerPx(c);
    const stats = await snapWalls(c, imagePath);
    if (!normalized || stats.missed < snapStats.missed) { normalized = c; snapStats = stats; }
  }
  const checks = qualityChecks(normalized);
  checks.push({
    rule: "墙体像素吸附",
    pass: snapStats.missed <= Math.ceil(normalized.walls.length * 0.4),
    note: `${snapStats.snapped} 个端点吸附到墙像素，${snapStats.missed} 个未找到`,
  });
  fs.writeFileSync(path.join(executionDir, "structure.json"), JSON.stringify(normalized, null, 2));
  fs.writeFileSync(path.join(executionDir, "quality.json"), JSON.stringify({ parse: checks }, null, 2));
  fs.writeFileSync(path.join(executionDir, "structure.svg"),
    renderStructure(normalized, { base64: fs.readFileSync(path.join(executionDir, imgFile)).toString("base64"), mime }));
  const warnings = checks.filter(c => !c.pass).map(c => c.note || c.rule);
  return {
    pages: [{ page: 1, file: "structure.svg" }],
    structureJson: JSON.stringify(normalized),
    output: `识别到 ${normalized.walls.length} 面墙（承重 ${normalized.walls.filter(w => w.bearing).length} 面）、${normalized.rooms.length} 个房间${normalized.mmPerPx ? `，比例尺 ${normalized.mmPerPx}mm/px` : ""}。请核对红线与原图墙体是否贴合，有误请重试。${warnings.length ? ` 质检提示：${warnings.join("；")}` : ""}`,
  };
}
