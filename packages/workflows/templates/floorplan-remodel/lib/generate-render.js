import fs from "node:fs";
import sharp from "sharp";
import { generateImage } from "@app/shared/llm/index.js";
import { withTimeout } from "@app/shared/utils.js";

/**
 * 户型效果图 + 俯视平面图（鸟瞰渲染）生成：
 * - 效果图：人视点透视，纯文本 prompt
 * - 俯视平面图：以平面布置图 SVG 栅格化 PNG 作图生图参考（锁空间布局），鸟瞰 3D
 * 复用 comic generate-pages 的 generateImage → fetch → 落盘 模式；幂等、失败降级。
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

export function stylePrompt(style) {
  return STYLE_PROMPTS[style] || STYLE_PROMPTS[DEFAULT_STYLE];
}

async function download(url, dest) {
  const res = await withTimeout(fetch(url, { signal: AbortSignal.timeout(120000) }), 120000, "渲染图下载");
  if (!res.ok) throw new Error(`图片下载失败 (${res.status})`);
  fs.writeFileSync(dest, Buffer.from(await withTimeout(res.arrayBuffer(), 30000, "图片读取")));
}

function effectPrompt(structure, plan, styleDesc) {
  const rooms = (structure.rooms || []).map(r => r.label).join("、");
  return `室内设计效果图，人视点透视广角。${styleDesc}。户型空间：${rooms}。${plan.summary || ""}。真实光影、材质细腻、高清渲染。`;
}

function birdviewPrompt(structure, plan, styleDesc) {
  return `家居俯视鸟瞰效果图（3D 顶视图），正上方近似俯视，家具立体带侧面高度与阴影，真实材质与光影，白墙底平面。${styleDesc}。严格依据参考平面布置图的空间布局与家具位置绘制，不得改动房间结构。`;
}

async function layoutPngBase64(layoutFile) {
  const png = await sharp(fs.readFileSync(layoutFile)).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * 为单套方案生成效果图 + 俯视平面图。
 * 返回 { render, birdview } 文件名；单张失败写 error 字段，不抛（方案本身仍有效）。
 */
export async function generateRenderings({ structure, plan, style, layoutFile, executionDir, planIdx, retryForce }) {
  const renderFile = `render-p${planIdx}.png`;
  const birdviewFile = `birdview-p${planIdx}.png`;
  const renderPath = `${executionDir}/${renderFile}`;
  const birdviewPath = `${executionDir}/${birdviewFile}`;
  const styleDesc = stylePrompt(style);
  const result = { render: renderFile, birdview: birdviewFile };

  if (!retryForce && fs.existsSync(renderPath) && fs.statSync(renderPath).size > 0) {
    result.renderError = null;
  } else {
    try {
      const urls = await generateImage(effectPrompt(structure, plan, styleDesc), { aspectRatio: "16:9" });
      if (!urls[0]) throw new Error("效果图未生成");
      await download(urls[0], renderPath);
    } catch (e) {
      result.renderError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!retryForce && fs.existsSync(birdviewPath) && fs.statSync(birdviewPath).size > 0) {
    result.birdviewError = null;
  } else {
    try {
      const ref = await layoutPngBase64(layoutFile);
      const urls = await generateImage(birdviewPrompt(structure, plan, styleDesc), { aspectRatio: "16:9", image_url: ref });
      if (!urls[0]) throw new Error("俯视平面图未生成");
      await download(urls[0], birdviewPath);
    } catch (e) {
      result.birdviewError = e instanceof Error ? e.message : String(e);
    }
  }

  return result;
}
