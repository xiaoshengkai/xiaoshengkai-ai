/**
 * comic-generation 微调（tweak）：图生图「编辑」选中页
 * 底图固定为当前页（保持构图，只应用修改）；上传图交给 vision 模型读成文字描述问题
 * 与 video 的"重生成脚本升版本"不同，comic 直接编辑图片，rerun=false
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage, callMultimodalLLM } from "@app/shared/llm/index.js";
import { createDateLogger } from "@app/shared/logger.js";
import { DATA_DIR, LOG_DIR, readState, writeState } from "../../../lib/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const ASSETS_DIR = path.join(PROJECT_ROOT, "data", "workflows", "assets");

// ponytail: 固定 seed 保持逐页风格一致
const SEED = 42;

const EXT_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
}

function toDataUrl(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = EXT_MIME[ext] || "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

// 上传图路径可能是 /api/uploads/<filename>（前端 upload API 返回），转成本地文件
function resolveUploadPath(p, projectRoot = PROJECT_ROOT) {
  if (!p) return null;
  const m = String(p).match(/^\/api\/uploads\/(.+)$/);
  if (m) return path.join(projectRoot, "data", "static", "images", m[1]);
  return fs.existsSync(p) ? p : null;
}

export function replaceComicPage(execDir, pageNo, imagePath, projectRoot = PROJECT_ROOT) {
  const state = readState(execDir);
  const genStep = state.steps?.find(s => s.id === "generate-pages");
  const pages = genStep?.output?.pages;
  if (!Array.isArray(pages)) return { ok: false, error: "暂无漫画页" };

  const page = pages.find(p => Number(p.page) === Number(pageNo));
  if (!page?.file) return { ok: false, error: `第 ${pageNo} 页不存在` };

  const src = resolveUploadPath(imagePath, projectRoot);
  if (!src || !fs.existsSync(src)) return { ok: false, error: "替换图片不存在" };

  const dest = path.join(execDir, page.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  page.replaced = true;
  page.replacedAt = new Date().toISOString();
  state.tweakCount = (state.tweakCount || 0) + 1;
  writeState(execDir, state);
  return { ok: true, file: page.file };
}

/** 上传图交给 vision 模型读成「修改意图」文字，失败降级返回空（不阻断微调） */
async function describeUploadedImages(imagePaths) {
  const parts = [];
  for (const p of imagePaths || []) {
    const local = resolveUploadPath(p);
    if (!local || !fs.existsSync(local)) continue;
    try {
      const { text } = await callMultimodalLLM({
        system: "你是漫画微调助手。用户上传了一张图片来描述想修改的问题（可能是圈出/标注了要改的地方）。请准确、具体地转述图中体现的修改意图。",
        user: "描述这张图里用户想表达的修改意见",
        images: [toDataUrl(local)],
        format: null,
      });
      if (text) parts.push(text);
    } catch (e) {
      // ponytail: vision 读图失败不阻断微调，仅忽略上传图
      console.warn(`[tweak] vision 读图失败，忽略上传图: ${e.message}`);
    }
  }
  return parts.join("\n");
}

export async function tweak(executionId) {
  const logger = createDateLogger("workflows", LOG_DIR, executionId);
  logger.info("[tweak] comic 开始");

  try {
    const dir = path.join(DATA_DIR, executionId);
    const state = readState(dir);

    const feedback = state.tweakTask?.feedback || "";
    if (!feedback) return { ok: false, error: "未找到 feedback" };

    // 累积反馈（"过去提到过的内容"）
    state.tweakHistory = [...(state.tweakHistory || []), feedback];
    const allFeedback = state.tweakHistory.filter(Boolean).join("\n");

    const selected = state.tweakTask?.pages || [];
    logger.info(`[tweak] 本次 feedback(提交AI): ${feedback}`);
    logger.info(`[tweak] 累积历史 allFeedback(仅记录不提交):\n${allFeedback}`);
    logger.info(`[tweak] selected 页: ${selected.length ? selected.join(",") : "全部"}`);

    // 分镜（每页 imagePrompt/dialogue）
    const scriptStep = state.steps.find(s => s.id === "script");
    let storyPages = [];
    try {
      const out = typeof scriptStep?.output === "string" ? JSON.parse(scriptStep.output) : scriptStep?.output;
      if (out?.pagesJson) storyPages = JSON.parse(out.pagesJson);
      else if (out?.script) storyPages = (typeof out.script === "string" ? JSON.parse(out.script) : out.script).pages || [];
    } catch { /* ignore */ }

    const genStep = state.steps.find(s => s.id === "generate-pages");
    const genPages = genStep?.output?.pages || [];
    if (genPages.length === 0) return { ok: false, error: "暂无漫画页" };

    const styleMeta = readJson(path.join(ASSETS_DIR, "styles", `${state.params?.styleId}.json`));
    const styleDesc = styleMeta?.description || "";

    // 上传图 → vision 读成文字描述（并入修改要求）
    const visionDesc = await describeUploadedImages(state.tweakTask?.images || []);

    const targets = genPages.filter(p => selected.length === 0 || selected.includes(p.page));
    logger.info(`[tweak] 编辑 ${targets.length} 页 (selected=${selected.length || "全部"})`);

    // 驱动通用 loading：步骤进入 running，前端现有 step-running 机制自动显示
    state.status = "running";
    genStep.status = "running";
    genStep.startedAt = new Date().toISOString();
    writeState(dir, state);

    const charImgPath = path.join(ASSETS_DIR, "characters", `${state.params?.characterRef}.png`);

    for (const g of targets) {
      const story = storyPages.find(s => s.page === g.page) || {};
      const filePath = path.join(dir, g.file);

      const storyDialogue = Array.isArray(story.dialogue) ? story.dialogue.join("\n") : (story.dialogue || "");

      // 底图：当前页优先（编辑）；当前页不存在（生成失败过）回退角色参考图（全新生成）
      const pageExists = fs.existsSync(filePath);
      const baseSource = pageExists ? filePath : (fs.existsSync(charImgPath) ? charImgPath : null);
      if (!baseSource) {
        logger.warn(`[tweak] 第 ${g.page} 页无底图可用，跳过`);
        continue;
      }
      const refB64 = toDataUrl(baseSource);

      const parts = [];
      if (styleDesc) parts.push(`画风：${styleDesc}`);
      if (pageExists) {
        parts.push("这是一张已经生成的漫画页。请保持整体构图、人物造型、背景、分格、布局完全不变，只做用户要求的局部修改。");
      } else {
        // 该页生成失败过，全新生成（角色参考图锁一致性）
        if (story.imagePrompt) parts.push(`画面：${story.imagePrompt}`);
        parts.push("人物位置按分镜设定；每个对白气泡靠近对应说话人。");
      }
      if (storyDialogue) parts.push(`对白气泡文字应为（如本次修改涉及文字）：\n${storyDialogue}`);
      parts.push(`修改要求：\n${feedback}`);
      if (visionDesc) parts.push(`用户上传参考图描述：\n${visionDesc}`);
      parts.push("每个说话人仅一个气泡，气泡尾部指向该人物；左人左泡、右人右泡，不得合并/重复/颠倒。");
      parts.push("画面干净，无多余黑点、污渍、杂线。");
      const prompt = parts.join("\n\n");
      logger.info(`[tweak] 第 ${g.page} 页 提交AI图片prompt (aspectRatio=2:3, seed=${SEED}, 底图=${pageExists ? "当前页" : "角色参考图"}, 参考图base64长度=${refB64.length}):\n${prompt}`);

      const t0 = Date.now();
      const urls = await generateImage(prompt, { aspectRatio: "2:3", image_url: refB64, seed: SEED });
      const url = urls[0];
      if (!url) throw new Error(`第 ${g.page} 页编辑未产生图片`);
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`第 ${g.page} 页图片下载失败 (${res.status})`);
      fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
      logger.info(`[tweak] 第 ${g.page} 页完成 (${((Date.now() - t0) / 1000).toFixed(1)}s) url=${url} file=${g.file}`);
    }

    state.tweakCount = (state.tweakCount || 0) + 1;
    genStep.status = "completed";
    state.status = "completed";
    writeState(dir, state);
    logger.info("[tweak] comic 完成");
    return { ok: true, rerun: false };
  } catch (e) {
    logger.error(`[tweak] 失败: ${e.message}`);
    try {
      const st = readState(path.join(DATA_DIR, executionId));
      const gs = st.steps.find(s => s.id === "generate-pages");
      if (gs) gs.status = "completed";
      st.status = "completed";
      writeState(path.join(DATA_DIR, executionId), st);
    } catch { /* ignore */ }
    return { ok: false, error: e.message };
  }
}
