/**
 * video-generation 成片质量自检（quality-check 步骤，借鉴 vibe-knowledge-video 质量门）：
 * - ffmpeg 从 output.mp4 均匀抽 16 帧拼 4×4 总览图（preview-sheet.jpg），供人看图
 * - 按 storyboard beats 关键拍（hook/title/model/reveal/outro）抽 5 张原尺寸静帧（vibe --stills 实践：小格看细节不够）
 * - vision LLM（selection.vision）按毛病对照表看图 → issues 清单；问题帧号自动补抽原尺寸帧
 * - vision 失败/超时 → 降级：拼图/静帧照出、issues 空 + degraded=true（质量门是增益不是门禁，不卡交付）
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { callMultimodalLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { getVideoDuration } from "./media-utils.js";
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

/** 解析 storyboard JSON（失败/空返回 null，走等分兜底） */
function parseBeats(storyboardJson) {
  if (!storyboardJson || !String(storyboardJson).trim()) return null;
  try {
    const sb = typeof storyboardJson === "string" ? JSON.parse(storyboardJson) : storyboardJson;
    return Array.isArray(sb?.beats) ? sb.beats : null;
  } catch {
    return null;
  }
}

/** 5 个关键静帧时刻：beats 的 role 选取（钩子/主题/机制中位/揭晓/结尾），按实际片长缩放；无分镜等分兜底 */
function pickKeyStillTimes(beats, dur) {
  const even = [0.08, 0.28, 0.5, 0.72, 0.9].map(f => +(f * dur).toFixed(1));
  if (!beats?.length) return even;

  let t = 0;
  const starts = [];
  for (const b of beats) {
    starts.push(t);
    t += (b.durationSec || 3);
  }
  const total = Math.max(t, 0.1);
  const scale = dur / total;

  const withIdx = beats.map((b, i) => ({ b, i }));
  const firstRole = (role) => withIdx.find(x => (x.b.role || "") === role);
  const lastRole = (role) => {
    const list = withIdx.filter(x => (x.b.role || "") === role);
    return list[list.length - 1];
  };
  const models = withIdx.filter(x => (x.b.role || "") === "model");

  const picks = [
    firstRole("hook"),
    firstRole("title"),
    models[Math.floor(models.length / 2)] || models[0],
    firstRole("reveal"),
    lastRole("outro") || lastRole("landing"),
  ].filter(Boolean);

  const times = picks.map(x => +(Math.min((starts[x.i] + 0.6) * scale, dur - 0.3)).toFixed(1));

  // 去掉过近的时刻，不足 5 个用等分点补齐
  const result = [];
  for (const time of [...times, ...even]) {
    if (result.length >= 5) break;
    if (result.every(r => Math.abs(r - time) > dur * 0.04)) result.push(time);
  }
  return result.slice(0, 5);
}

function extractStill(ffmpegPath, videoPath, sec, outPath) {
  try {
    execSync(
      `"${ffmpegPath}" -y -ss ${Math.max(0, sec).toFixed(2)} -i "${videoPath}" -frames:v 1 -q:v 2 "${outPath}"`,
      { stdio: ["inherit", "inherit", "pipe"] }
    );
    return fs.existsSync(outPath);
  } catch {
    return false;
  }
}

export async function runQualityGate(executionDir, title, storyboardJson) {
  const execId = path.basename(executionDir);
  const logger = createDateLogger("workflows", LOG_DIR, execId);
  const startTime = Date.now();

  const outputPath = path.join(executionDir, "output.mp4");
  const sheetPath = path.join(executionDir, "preview-sheet.jpg");

  if (!fs.existsSync(outputPath)) {
    return { output: "未找到 output.mp4，跳过质检", sheet: null, stills: [], issues: [], pass: null, degraded: true };
  }

  const dur = getVideoDuration(outputPath);
  const ffmpegPath = ffmpegInstaller.path;

  // ── 1. 抽帧拼图（16 帧总览） ──
  try {
    const fps = Math.max(16 / dur, 0.05);
    execSync(
      `"${ffmpegPath}" -y -i "${outputPath}" -vf "fps=${fps.toFixed(4)},scale=270:480,tile=4x4" -frames:v 1 -q:v 3 "${sheetPath}"`,
      { stdio: ["inherit", "inherit", "pipe"] }
    );
    logger.info(`[quality-gate] 拼图完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s, 视频 ${dur.toFixed(0)}s)`);
  } catch (e) {
    const stderr = e.stderr?.toString() || "";
    logger.warn(`[quality-gate] 拼图失败: ${stderr || e.message}`);
    return { output: "抽帧拼图失败，跳过质检", sheet: null, stills: [], issues: [], pass: null, degraded: true };
  }

  // ── 2. 关键拍原尺寸静帧（vibe --stills 实践：小格拼图看不清细节） ──
  // 先清旧帧：tweak 重渲染后避免上一版静帧残留误导看图
  for (const f of fs.readdirSync(executionDir)) {
    if (/^preview-(still|issue)-.*\.(jpg|png)$/.test(f)) {
      try { fs.unlinkSync(path.join(executionDir, f)); } catch { /* ignore */ }
    }
  }
  const beats = parseBeats(storyboardJson);
  const stillTimes = pickKeyStillTimes(beats, dur);
  const stills = [];
  for (const sec of stillTimes) {
    const name = `preview-still-${Math.round(sec)}s.jpg`;
    if (extractStill(ffmpegPath, outputPath, sec, path.join(executionDir, name))) stills.push(name);
  }
  if (stills.length > 0) {
    logger.info(`[quality-gate] 原尺寸静帧 ${stills.length} 张（${beats ? "按分镜关键拍" : "等分兜底"}）`);
  }

  // ── 3. vision 自检（失败降级，不卡交付） ──
  let issues = [];
  let pass = null;
  let degraded = true;
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
    issues = Array.isArray(result?.issues) ? result.issues : [];
    pass = typeof result?.pass === "boolean" ? result.pass : issues.filter(i => i.severity === "high").length === 0;
    degraded = false;
  } catch (e) {
    logger.warn(`[quality-gate] vision 自检降级: ${e.message}`);
  }

  // ── 4. 问题帧补抽原尺寸静帧（vision 帧号 1-16 → 时刻；high/medium 优先，去近重） ──
  if (!degraded && issues.length > 0) {
    const seen = [...stillTimes];
    const frames = new Set();
    for (const i of [...issues].sort((a, b) => (a.severity === "high" ? -1 : 1) - (b.severity === "high" ? -1 : 1))) {
      const frame = Number(i.frame);
      if (!Number.isInteger(frame) || frame < 1 || frame > 16 || frames.has(frame)) continue;
      const sec = +((frame - 0.5) * dur / 16).toFixed(1);
      if (seen.some(s => Math.abs(s - sec) < dur * 0.04)) continue;
      frames.add(frame);
      if (frames.size > 4) break;
      const name = `preview-issue-f${frame}.jpg`;
      if (extractStill(ffmpegPath, outputPath, sec, path.join(executionDir, name))) {
        i.still = name;
        seen.push(sec);
      }
    }
  }

  const summary = degraded
    ? "拼图与静帧已生成，AI 看图检查不可用（降级）"
    : pass
      ? `质检通过（${issues.length} 条低级别提示）`
      : `发现 ${issues.length} 个问题（high: ${issues.filter(i => i.severity === "high").length}）`;

  logger.info(`[quality-gate] 完成: ${summary} (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
  return { output: summary, sheet: "preview-sheet.jpg", stills, issues, pass, degraded };
}
