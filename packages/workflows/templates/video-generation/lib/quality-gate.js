/**
 * video-generation 成片质量自检（quality-check 步骤，借鉴 vibe-knowledge-video 质量门）：
 * - ffmpeg 从 output.mp4 均匀抽 16 帧拼 4×4 总览图（preview-sheet.jpg），供人看图
 * - vision LLM（selection.vision）按毛病对照表看图 → issues 清单
 * - vision 失败/超时 → 降级：拼图照出、issues 空 + degraded=true（质量门是增益不是门禁，不卡交付）
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { callMultimodalLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { getAudioDuration } from "./bgm.js";
import { LOG_DIR } from "../../../lib/state.js";
import { createDateLogger } from "@app/shared/logger.js";

const QUALITY_PROMPT = `你是短视频质检员。这张图是竖屏短视频的 16 帧等间隔总览拼图（4×4，从左到右、从上到下为时间顺序）。
逐格对照以下毛病清单检查：
1. 主体太小：主要视觉元素占画面不足三成，小小缩在中间
2. 文字重叠/溢出：文字互相压住、超出边界、被裁切
3. 配图感：整幕像通用装饰图，换到任何视频都能用（抽象粒子/随机图形/纯氛围）
4. 场景雷同：相邻两格构图、配色、布局几乎一样
5. 空幕：某格几乎空白或只有底色
6. 视觉崩溃：文字挤压变形、排版错乱、元素飞出容器
7. 字号过小：正文小到手机上看不清（画面角落的装饰性小字不算）

输出严格 JSON（无其他文字）：
{ "pass": true, "issues": [{ "severity": "high|medium|low", "frame": 3, "problem": "问题描述", "fix": "修改建议" }] }

pass 标准：不存在 high 级问题。frame 是 1-16 的格子序号（按时间顺序）。只报真实存在的问题，不确定的不报。`;

export async function runQualityGate(executionDir, title) {
  const execId = path.basename(executionDir);
  const logger = createDateLogger("workflows", LOG_DIR, execId);
  const startTime = Date.now();

  const outputPath = path.join(executionDir, "output.mp4");
  const sheetPath = path.join(executionDir, "preview-sheet.jpg");

  if (!fs.existsSync(outputPath)) {
    return { output: "未找到 output.mp4，跳过质检", sheet: null, issues: [], pass: null, degraded: true };
  }

  // ── 1. 抽帧拼图（16 帧总览） ──
  try {
    const dur = getAudioDuration(outputPath);
    const fps = Math.max(16 / dur, 0.05);
    const ffmpegPath = ffmpegInstaller.path;
    execSync(
      `"${ffmpegPath}" -y -i "${outputPath}" -vf "fps=${fps.toFixed(4)},scale=270:480,tile=4x4" -frames:v 1 -q:v 3 "${sheetPath}"`,
      { stdio: ["inherit", "inherit", "pipe"] }
    );
    logger.info(`[quality-gate] 拼图完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s, 视频 ${dur.toFixed(0)}s)`);
  } catch (e) {
    const stderr = e.stderr?.toString() || "";
    logger.warn(`[quality-gate] 拼图失败: ${stderr || e.message}`);
    return { output: "抽帧拼图失败，跳过质检", sheet: null, issues: [], pass: null, degraded: true };
  }

  // ── 2. vision 自检（失败降级，不卡交付） ──
  try {
    const sheetBase64 = `data:image/jpeg;base64,${fs.readFileSync(sheetPath).toString("base64")}`;
    const userPrompt = `对照毛病清单检查这条短视频的 16 帧总览图。视频标题: ${title || "（未知）"}。只输出 JSON。`;

    const { text } = await callMultimodalLLM({
      system: QUALITY_PROMPT,
      user: userPrompt,
      images: [sheetBase64],
      maxTokens: 8000,
    });

    const result = parseJSON(text);
    const issues = Array.isArray(result?.issues) ? result.issues : [];
    const pass = typeof result?.pass === "boolean" ? result.pass : issues.filter(i => i.severity === "high").length === 0;
    const summary = pass
      ? `质检通过（${issues.length} 条低级别提示）`
      : `发现 ${issues.length} 个问题（high: ${issues.filter(i => i.severity === "high").length}）`;

    logger.info(`[quality-gate] vision 自检完成: ${summary} (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
    return { output: summary, sheet: "preview-sheet.jpg", issues, pass, degraded: false };
  } catch (e) {
    logger.warn(`[quality-gate] vision 自检降级: ${e.message}`);
    return { output: "拼图已生成，AI 看图检查不可用（降级）", sheet: "preview-sheet.jpg", issues: [], pass: null, degraded: true };
  }
}
