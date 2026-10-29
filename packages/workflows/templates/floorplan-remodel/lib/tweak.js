/**
 * floorplan-remodel 微调（tweak）：图生图「编辑」单张效果图 / 替换单张图
 * 与 comic 一致走 engine 级 /execution/:id/tweak（tweak-auto.js 编排）：
 *   mode=ai      → tweak(executionId)：当前效果图作底图 + feedback 局部修改（rerun=false，直接覆盖产物）
 *   mode=replace → replaceComicPage(dir, file, imagePath)：上传图直接替换
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage } from "@app/shared/llm/index.js";
import { withTimeout } from "@app/shared/utils.js";
import { createDateLogger } from "@app/shared/logger.js";
import { DATA_DIR, LOG_DIR, readState, writeState } from "../../../lib/state.js";
import { stylePrompt, pickEffectViews, effectPrompt, birdviewPrompt, aspectRatioFor, SEED_BASE } from "./generate-render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

const EXT_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

function toDataUrl(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = EXT_MIME[ext] || "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function resolveUploadPath(p) {
  if (!p) return null;
  const m = String(p).match(/^\/api\/uploads\/(.+)$/);
  if (m) return path.join(PROJECT_ROOT, "data", "static", "images", m[1]);
  return fs.existsSync(p) ? p : null;
}

// 名称沿用 comic 的 replaceComicPage（tweak-auto.js 硬编码此名）；此处语义 = 替换单张效果图文件
export function replaceComicPage(execDir, file, imagePath) {
  const src = resolveUploadPath(imagePath);
  if (!src || !fs.existsSync(src)) return { ok: false, error: "替换图片不存在" };
  const dest = path.join(execDir, file);
  fs.copyFileSync(src, dest);
  const state = readState(execDir);
  state.tweakCount = (state.tweakCount || 0) + 1;
  writeState(execDir, state);
  return { ok: true, file };
}

export async function tweak(executionId) {
  const logger = createDateLogger("workflows", LOG_DIR, executionId);
  const dir = path.join(DATA_DIR, executionId);
  const state = readState(dir);
  const feedback = state.tweakTask?.feedback || "";
  const targets = state.tweakTask?.pages || []; // 效果图文件名数组（如 render-p1-living.png）

  const structure = JSON.parse(fs.readFileSync(path.join(dir, "structure.json"), "utf-8"));
  const plans = JSON.parse(fs.readFileSync(path.join(dir, "plans.json"), "utf-8"));
  const styleDesc = stylePrompt(state.params?.style || "");

  let edited = 0;
  for (const file of targets) {
    const effMatch = String(file).match(/^render-p(\d+)-(\w+)\.png$/);
    const bvMatch = String(file).match(/^birdview-p(\d+)\.png$/);
    if (effMatch) {
      const planIdx = parseInt(effMatch[1], 10);
      const key = effMatch[2];
      const plan = plans[planIdx - 1];
      const view = plan ? pickEffectViews(structure, plan).find(v => v.key === key) : null;
      const filePath = path.join(dir, file);
      if (!view || !fs.existsSync(filePath)) { logger.warn(`[tweak] 目标不存在或无视角信息: ${file}`); continue; }

      const basePrompt = effectPrompt(view, structure, styleDesc);
      const refB64 = toDataUrl(filePath);
      const prompt = `${basePrompt}\n\n这是一张已生成的效果图，保持整体构图、视角、风格不变，只做用户要求的局部修改。\n\n修改要求：\n${feedback}`;
      logger.info(`[tweak] 编辑效果图 ${file} (planIdx=${planIdx}, key=${key})`);

      const urls = await generateImage(prompt, { aspectRatio: "16:9", image_url: refB64, seed: SEED_BASE + planIdx * 10 + keySeed(key) });
      const url = urls[0];
      if (!url) throw new Error(`${file} 编辑未产生图片`);
      const res = await withTimeout(fetch(url, { signal: AbortSignal.timeout(120000) }), 120000, "图片下载");
      if (!res.ok) throw new Error(`${file} 图片下载失败 (${res.status})`);
      fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
      edited++;
    } else if (bvMatch) {
      const planIdx = parseInt(bvMatch[1], 10);
      const plan = plans[planIdx - 1];
      const filePath = path.join(dir, file);
      if (!plan || !fs.existsSync(filePath)) { logger.warn(`[tweak] 鸟瞰目标不存在: ${file}`); continue; }

      const basePrompt = birdviewPrompt(structure, plan, styleDesc);
      const refB64 = toDataUrl(filePath);
      const prompt = `${basePrompt}\n\n这是一张已生成的鸟瞰图，保持整体布局、房间比例、家具位置、风格不变，只做用户要求的局部修改。\n\n修改要求：\n${feedback}`;
      const aspect = aspectRatioFor(structure.imgW || structure.width, structure.imgH || structure.height);
      logger.info(`[tweak] 编辑鸟瞰 ${file} (planIdx=${planIdx})`);

      const urls = await generateImage(prompt, { aspectRatio: aspect, image_url: refB64, seed: SEED_BASE + planIdx * 10 + 3 });
      const url = urls[0];
      if (!url) throw new Error(`${file} 编辑未产生图片`);
      const res = await withTimeout(fetch(url, { signal: AbortSignal.timeout(120000) }), 120000, "图片下载");
      if (!res.ok) throw new Error(`${file} 图片下载失败 (${res.status})`);
      fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
      edited++;
    } else {
      logger.warn(`[tweak] 跳过不支持的目标: ${file}`);
    }
  }

  state.tweakCount = (state.tweakCount || 0) + 1;
  writeState(dir, state);
  logger.info(`[tweak] floorplan 完成，编辑 ${edited} 张`);
  return { ok: true, rerun: false };
}

function keySeed(key) {
  return { living: 0, master: 1, wet: 2 }[key] ?? 0;
}
