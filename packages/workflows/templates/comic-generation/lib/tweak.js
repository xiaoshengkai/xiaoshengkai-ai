/**
 * comic-generation 微调（tweak）：图生图重生成选中页
 * 把当前页图作参考图 + 累积反馈 → generateImage 覆盖该页
 * 与 video 的"重生成脚本升版本"不同，comic 直接重生成图片，rerun=false
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage } from "@app/shared/llm/index.js";
import { createDateLogger } from "@app/shared/logger.js";
import { DATA_DIR, LOG_DIR, readState, writeState } from "../../../lib/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const ASSETS_DIR = path.join(PROJECT_ROOT, "data", "workflows", "assets");

// ponytail: 固定 seed 保持逐页风格一致
const SEED = 42;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
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

    const targets = genPages.filter(p => selected.length === 0 || selected.includes(p.page));
    logger.info(`[tweak] 重生成 ${targets.length} 页 (selected=${selected.length || "全部"})`);

    // 驱动通用 loading：步骤进入 running，前端现有 step-running 机制自动显示
    state.status = "running";
    genStep.status = "running";
    genStep.startedAt = new Date().toISOString();
    writeState(dir, state);

    for (const g of targets) {
      const story = storyPages.find(s => s.page === g.page) || {};
      const filePath = path.join(dir, g.file);
      if (!fs.existsSync(filePath)) {
        logger.warn(`[tweak] ${g.file} 不存在，跳过`);
        continue;
      }

      // 参考图优先级：上传/粘贴图 > 角色参考图 > 当前页(兜底)。不再默认用当前坏页，避免错误被保留
      const uploaded = (state.tweakTask?.images || []).filter(p => p && fs.existsSync(p));
      const charImgPath = path.join(ASSETS_DIR, "characters", `${state.params?.characterRef}.png`);
      const refSource = uploaded.length ? uploaded[0] : (fs.existsSync(charImgPath) ? charImgPath : filePath);
      const refB64 = `data:image/png;base64,${fs.readFileSync(refSource).toString("base64")}`;
      const parts = [];
      if (styleDesc) parts.push(`画风：${styleDesc}`);
      if (story.imagePrompt) parts.push(`画面：${story.imagePrompt}`);
      const storyDialogue = Array.isArray(story.dialogue) ? story.dialogue.join("\n") : (story.dialogue || "");
      if (storyDialogue) parts.push(`对白气泡文字（必须准确无误地画进画面，气泡内标注说话人名字）：\n${storyDialogue}`);
      parts.push("每个说话人仅一个气泡，气泡尾部指向该人物；左人左泡、右人右泡，不得合并/重复/颠倒。");
      parts.push("画面干净，无多余黑点、污渍、杂线。");
      parts.push(`修改反馈（仅针对本页，按以下调整）：\n${feedback}`);
      const prompt = parts.join("\n\n");
      logger.info(`[tweak] 第 ${g.page} 页 提交AI图片prompt (aspectRatio=2:3, seed=${SEED}, 参考图base64长度=${refB64.length}):\n${prompt}`);

      const t0 = Date.now();
      const urls = await generateImage(prompt, { aspectRatio: "2:3", image_url: refB64, seed: SEED });
      const url = urls[0];
      if (!url) throw new Error(`第 ${g.page} 页重生成未产生图片`);
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
