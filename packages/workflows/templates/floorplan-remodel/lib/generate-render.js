import fs from "node:fs";
import sharp from "sharp";
import { generateImage } from "@app/shared/llm/index.js";
import { withTimeout } from "@app/shared/utils.js";
import { areaM2 } from "./metrics.js";

/**
 * 户型效果图（多视角人视点）+ 俯视平面图（鸟瞰渲染）生成：
 * - 效果图：每方案 N 个关键空间视角（客餐厅/主卧/厨卫），纯文本 prompt + 结构化家具描述
 * - 俯视平面图：以「去文字」的平面布置图 SVG 栅格化 PNG 作图生图参考 + 文本布局锚定
 * 幂等复用、单张失败降级（写 error 字段，不废方案）。
 */

const STYLE_PROMPTS = {
  "现代简约": "现代简约风格，白灰基调，线条利落，极简家具，明亮通透，中性色配少量点缀",
  "奶油风": "奶油风，奶咖色系，圆润柔和家具，温润木色地板，柔光氛围，温馨治愈",
  "原木日式": "原木日式风格，浅原木色家具，藤编与棉麻，留白干净，自然温暖，禅意安静",
  "北欧": "北欧风格，浅色木地板，白色墙面，绿植点缀，简洁实用家具，明亮自然光",
  "中古风": "中古风，胡桃木家具，藤编元素，复古绿与黄铜点缀，温润做旧质感，暖光氛围",
  "侘寂风": "侘寂风，低饱和大地色，微水泥质感墙面，原木与陶器，极简留白，静谧禅意",
  "新中式": "新中式风格，深木色家具，水墨意境，格栅与屏风元素，留白克制，东方雅致",
  "轻奢风": "轻奢风格，金属线条与大理石，丝绒家具，高级灰与香槟金，精致通透",
  "法式复古": "法式复古风，奶油色墙面，石膏线条，复古木家具与铁艺，浪漫慵懒，暖黄灯光",
  "工业风": "工业风格，水泥灰墙面，黑色金属框架，皮革与木质，粗犷硬朗，暖色工业灯",
  "极简黑白灰": "极简黑白灰风格，黑白灰三色，无多余装饰，几何线条，克制高级",
};
const DEFAULT_STYLE = "现代简约";

const FURN_ZH = { bed: "床", sofa: "沙发", dining: "餐桌", toilet: "马桶", sink: "洗手台", shower: "淋浴", bathtub: "浴缸", kitchen: "橱柜", desk: "书桌", wardrobe: "衣柜", tv: "电视柜", fridge: "冰箱", washer: "洗衣机", table: "茶几", stool: "椅凳", storage: "收纳" };

export function stylePrompt(style) {
  return STYLE_PROMPTS[style] || STYLE_PROMPTS[DEFAULT_STYLE];
}

async function download(url, dest) {
  const res = await withTimeout(fetch(url, { signal: AbortSignal.timeout(120000) }), 120000, "渲染图下载");
  if (!res.ok) throw new Error(`图片下载失败 (${res.status})`);
  fs.writeFileSync(dest, Buffer.from(await withTimeout(res.arrayBuffer(), 30000, "图片读取")));
}

function roomKind(label) {
  const s = String(label || "");
  if (/客厅|餐厅|起居/.test(s)) return "客餐厅";
  if (/卧室|主卧|次卧|儿童|睡/.test(s)) return "卧室";
  if (/厨房/.test(s)) return "厨房";
  if (/卫生间|淋浴|浴室|洗手|卫/.test(s)) return "卫生间";
  if (/书房|办公|电竞|多功能|学习|舱/.test(s)) return "书房";
  if (/阳台/.test(s)) return "阳台";
  return null;
}

function roomAreaSqM(room, structure) {
  if (room.bbox && structure.mmPerPx) return areaM2(room.bbox, structure.mmPerPx);
  const m = String(room.area || "").match(/([\d.]+)/);
  return m ? Number(m[1]) : null;
}

// 房间 id / newRooms 下标 → 家具类型数组（raw plan.furniture）
function furnitureByRoom(plan) {
  const map = {};
  for (const fr of plan?.furniture || []) {
    const key = fr?.roomId || (fr?.nr != null ? `nr:${fr.nr}` : null);
    if (!key) continue;
    map[key] = (fr.items || []).map(it => it.type).filter(Boolean);
  }
  return map;
}

// 效果图视角选择：客餐厅（缺则最大房间）/ 主卧 / 厨房（缺则卫生间）
function pickEffectViews(structure, plan) {
  const byRoom = furnitureByRoom(plan);
  const rooms = structure.rooms || [];
  const byArea = (a, b) => (roomAreaSqM(b, structure) || 0) - (roomAreaSqM(a, structure) || 0);
  const views = [];

  let living = rooms.filter(r => roomKind(r.label) === "客餐厅").sort(byArea)[0];
  if (!living) living = rooms.slice().sort(byArea)[0];
  if (living) views.push({ key: "living", label: "客餐厅", room: living, furniture: byRoom[living.id] || [] });

  const bed = rooms.find(r => roomKind(r.label) === "卧室");
  if (bed) views.push({ key: "master", label: "主卧", room: bed, furniture: byRoom[bed.id] || [] });

  const wet = rooms.find(r => roomKind(r.label) === "厨房") || rooms.find(r => roomKind(r.label) === "卫生间");
  if (wet) views.push({ key: "wet", label: roomKind(wet.label) === "厨房" ? "厨房" : "卫生间", room: wet, furniture: byRoom[wet.id] || [] });

  return views;
}

function effectPrompt(view, structure, styleDesc) {
  const area = roomAreaSqM(view.room, structure);
  const furn = (view.furniture || []).map(t => FURN_ZH[t] || t).filter(Boolean);
  const furnText = furn.length ? furn.join("、") : "合理布置";
  const areaText = area != null ? `约${area}㎡` : "";
  return `室内设计效果图，人视点透视（正对空间主立面，广角镜头）。空间：${view.label}${areaText ? `（${areaText}）` : ""}。${styleDesc}。家具布置：${furnText}。真实光影、材质细腻、高清渲染、画面干净无文字无水印。`;
}

// 结构化文字布局描述（鸟瞰的文本锚定，与参考图互补）
function layoutDescription(structure, plan) {
  const byRoom = furnitureByRoom(plan);
  const parts = [];
  for (const r of structure.rooms || []) {
    const types = byRoom[r.id] || [];
    parts.push(`${r.label}：${types.length ? types.map(t => FURN_ZH[t] || t).join("、") : "无家具"}`);
  }
  for (let i = 0; i < (plan.newRooms || []).length; i++) {
    const nr = plan.newRooms[i];
    const types = byRoom[`nr:${i}`] || [];
    parts.push(`${nr.label}：${types.length ? types.map(t => FURN_ZH[t] || t).join("、") : "无家具"}`);
  }
  return parts.join("；");
}

function birdviewPrompt(structure, plan, styleDesc) {
  return `家居俯视鸟瞰效果图（3D 顶视图），正上方近似俯视，家具立体带侧面高度与阴影，真实材质与光影，白墙底平面。${styleDesc}。
空间与家具布局（必须严格遵守）：${layoutDescription(structure, plan)}。
严格依据参考平面布置图：墙体位置、房间比例、门窗位置与参考图完全一致，只把线框图元替换成对应真实材质 3D 家具，禁止新增/删除/移动家具，禁止输出任何文字标注。`;
}

async function layoutPngBase64(layoutFile) {
  const png = await sharp(fs.readFileSync(layoutFile)).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * 为单套方案生成多视角效果图 + 俯视平面图。
 * 返回 { effects:[{file,label,error?}], birdview, birdviewError }。
 */
export async function generateRenderings({ structure, plan, style, layoutCleanFile, executionDir, planIdx, retryForce }) {
  const styleDesc = stylePrompt(style);
  const birdviewFile = `birdview-p${planIdx}.png`;
  const birdviewPath = `${executionDir}/${birdviewFile}`;
  const result = { birdview: birdviewFile };

  const views = pickEffectViews(structure, plan);
  const effects = await Promise.all(views.map(async (v) => {
    const file = `render-p${planIdx}-${v.key}.png`;
    const p = `${executionDir}/${file}`;
    if (!retryForce && fs.existsSync(p) && fs.statSync(p).size > 0) return { file, label: v.label };
    try {
      const urls = await generateImage(effectPrompt(v, structure, styleDesc), { aspectRatio: "16:9" });
      if (!urls[0]) throw new Error("效果图未生成");
      await download(urls[0], p);
      return { file, label: v.label };
    } catch (e) {
      return { file, label: v.label, error: e instanceof Error ? e.message : String(e) };
    }
  }));

  if (!retryForce && fs.existsSync(birdviewPath) && fs.statSync(birdviewPath).size > 0) {
    result.birdviewError = null;
  } else {
    try {
      const ref = await layoutPngBase64(layoutCleanFile);
      const urls = await generateImage(birdviewPrompt(structure, plan, styleDesc), { aspectRatio: "16:9", image_url: ref });
      if (!urls[0]) throw new Error("俯视平面图未生成");
      await download(urls[0], birdviewPath);
    } catch (e) {
      result.birdviewError = e instanceof Error ? e.message : String(e);
    }
  }

  return { effects, ...result };
}
