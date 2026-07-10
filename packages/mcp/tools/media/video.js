import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { execSync, exec } from "node:child_process";
import { loadStyleMD, loadAnimationTemplate, sleep, escHtml } from "./utils.js";
import { createTTSTask, pollTTSTask, generateBGM, getAudioDuration } from "./audio.js";
import { downloadSubtitles, renderSubtitles } from "./html-builder.js";

const TASK_DIR = path.join(os.tmpdir(), "hf-tasks");
const DEEPSEEK_MODEL = process.env.DEEPSEEK_FLASH_MODEL || "deepseek-v4-flash";

const ROOT_DIR = path.resolve(path.dirname(path.dirname(new URL(import.meta.url).pathname)), "..", "..", "..");
const GSAP_GSAP = path.join(ROOT_DIR, "node_modules", "gsap", "dist", "gsap.min.js");
const GSAP_DRAWSVG = path.join(ROOT_DIR, "node_modules", "gsap", "dist", "DrawSVGPlugin.min.js");
const HYPERFRAMES_BIN = path.join(ROOT_DIR, "node_modules", ".bin", "hyperframes");

function writeTaskState(workDir, state) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, "task.json"), JSON.stringify(state));
}

function updateTask(workDir, update) {
  const taskFile = path.join(workDir, "task.json");
  if (!fs.existsSync(taskFile)) return;
  const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
  Object.assign(state, update);
  fs.writeFileSync(taskFile, JSON.stringify(state));
}

export function register(server) {
  server.tool("generateVideo", "根据文本描述生成视频。当前暂未实现。", { prompt: z.string().min(1).describe("视频描述") }, async () => {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "文生视频功能暂未实现" }) }] };
  });

  server.tool(
    "generateHTMLPreview",
    "生成视频 HTML 预览（用 GSAP 制作动画）。完成后可用 readFile/replaceInFile 微调 HTML，无需重新生成。满意后用 renderVideo 渲染 MP4。",
    {
      prompt: z.string().min(1).describe("知识内容/视频主题"),
      style: z.string().optional().describe("视觉风格描述，如'赛博朋克霓虹灯'"),
      template: z.string().optional().describe("模板名，如'cream'。不传则使用默认 Neo-Brutalist 风格"),
      duration: z.number().optional().describe("视频目标时长（秒）"),
      voice_id: z.string().optional().default("male-qn-qingse").describe("TTS 音色 ID"),
      bgm_volume: z.number().min(0).max(1).optional().default(0.3).describe("BGM 音量"),
      download: z.boolean().optional().default(true).describe("是否下载到本地"),
      rootDir: z.string().optional().describe("下载目录，默认 ~/Downloads"),
      width: z.number().optional().default(1080).describe("视频宽度，默认 1080"),
      height: z.number().optional().default(1920).describe("视频高度，默认 1920"),
    },
    async (params) => {
      const { prompt, style, template, duration, voice_id, bgm_volume, download, rootDir, width, height } = params;
      const DOWNLOAD_DIR = rootDir || path.join(os.homedir(), "Downloads");
      const taskId = crypto.randomBytes(4).toString("hex");
      const workDir = path.join(TASK_DIR, taskId);
      const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
      const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
      const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";

      if (!MINIMAX_API_KEY) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "未配置 MINIMAX_API_KEY" }) }] };
      if (!DEEPSEEK_API_KEY) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "未配置 DEEPSEEK_API_KEY" }) }] };

      try {
        fs.mkdirSync(workDir, { recursive: true });
        writeTaskState(workDir, { taskId, status: "running", progress: 0, message: "初始化中..." });

        // 异步执行（不 await）
        startPreviewRender({
          taskId, workDir, prompt, style, template, duration, voice_id, bgm_volume, download, DOWNLOAD_DIR,
          MINIMAX_API_KEY, DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, width, height,
        }).catch(err => {
          console.error("[video] 预览生成失败:", err?.message || err);
          updateTask(workDir, { status: "failed", error: err.message });
        });

        return { content: [{ type: "text", text: JSON.stringify({ ok: true, taskId, status: "started", note: "用 checkTaskProgress(taskId, interval=18) 查询进度，完成后会返回 iframe 字段用于嵌入预览" }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }] };
      }
    },
  );

  server.tool(
    "renderVideo",
    "将 HTML 预览渲染为 MP4 视频。仅在 generateHTMLPreview 返回 status=preview_ready 时可用。",
    {
      taskId: z.string().min(1).describe("任务 ID"),
      download: z.boolean().optional().default(true).describe("是否下载到本地"),
      rootDir: z.string().optional().describe("下载目录，默认 ~/Downloads"),
    },
    async ({ taskId, download, rootDir }) => {
      const workDir = path.join(TASK_DIR, taskId);
      const taskFile = path.join(workDir, "task.json");
      if (!fs.existsSync(taskFile)) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "任务不存在或已过期" }) }] };
      const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
      console.log("[video] renderVideo state:", JSON.stringify({ taskId, status: state.status }));
      if (state.status !== "preview_ready") return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `任务状态为 ${state.status}，需要 preview_ready` }) }] };

      const DOWNLOAD_DIR = rootDir || state.downloadDir || path.join(os.homedir(), "Downloads");
      updateTask(workDir, { status: "running", progress: 50, message: "渲染中...", checkCount: 0 });

      startVideoRender({ taskId, workDir, download: download ?? true, DOWNLOAD_DIR, script: state.script }).catch(err => {
        console.error("[video] 渲染失败:", err?.message || err);
        updateTask(workDir, { status: "failed", error: err.message });
      });

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, taskId, status: "rendering", note: "用 checkTaskProgress(taskId, interval=30) 查询进度" }, null, 2) }] };
    },
  );

  server.tool(
    "checkTaskProgress",
    "查询动画预览和视频渲染任务进度。返回包含 progress(百分比)、status、iframe 字段（status=preview_ready 时 iframe 为 HTML 标签，必须直接输出到聊天中）。每次调用会等待后返回最新状态（等待时间由 interval 参数控制）。调用期间根据 progress 给用户正向反馈（如'已完成 X%，预计还需几分钟'），不要输出负面描述或催促。渲染是正常耗时操作，不要急躁。反复调用直到 status='done' 或 'failed' 后停止。status=done 时告知用户并给出文件路径，status=failed 时告知失败原因。",
    {
      taskId: z.string().min(1).describe("任务 ID"),
      interval: z.number().optional().default(30).describe("初始查询间隔（秒），后续每次递减 10%，最低为初始值的 60%"),
    },
    async ({ taskId, interval }) => {
      const workDir = path.join(TASK_DIR, taskId);
      const taskFile = path.join(workDir, "task.json");
      if (!fs.existsSync(taskFile)) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "任务不存在或已过期" }) }] };
      const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
      state.preview_path = path.join(workDir, "preview.html");
      const w = state.script?.width || 1080;
      const h = state.script?.height || 1920;
      state.iframe = `<iframe src="/preview/${taskId}" width="437.625" height="${Math.round(437.625 * h / w)}"></iframe>`;
      if (state.status === "running") {
        const base = interval * 1000;
        const min = base * 0.6;
        const count = state.checkCount || 0;

        let wait = base;
        for (let i = 0; i < count; i++) {
          wait = Math.max(wait * 0.9, min);
        }

        updateTask(workDir, { checkCount: count + 1, preview_path: path.join(workDir, "preview.html") });
        console.log("[video] checkVideoProgress:", JSON.stringify({ taskId, interval, count, wait: (wait / 1000).toFixed(1) + "s", status: state.status }));
        await sleep(wait);

        const updated = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
        updated.preview_path = path.join(workDir, "preview.html");
        const uw = updated.script?.width || 1080;
        const uh = updated.script?.height || 1920;
        updated.iframe = `<iframe src="/preview/${taskId}" width="437.625" height="${Math.round(437.625 * uh / uw)}"></iframe>`;
        return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
    },
  );

  server.tool("generateSpeech", "根据文本生成语音。当前暂未实现。", { text: z.string().min(1).describe("要转为语音的文本") }, async () => {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "文生语音功能暂未实现" }) }] };
  });
}

// ═══════════════════════════════════════════════════════════════════
// 预览生成引擎
// ═══════════════════════════════════════════════════════════════════

async function startPreviewRender(opts) {
  const { taskId, workDir, prompt, style, template, duration, voice_id, bgm_volume, download, DOWNLOAD_DIR,
    MINIMAX_API_KEY, DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, width, height } = opts;
  const timings = {};
  const tStart = Date.now();

  updateTask(workDir, { progress: 5, message: "脚本生成中..." });

  const styleMD = loadStyleMD(template);
  const animationTemplate = loadAnimationTemplate();
  console.log("[video] 模板:", template || "default", "| 风格MD:", styleMD.length, "字 | 动画模板:", animationTemplate.length, "字");

  const SCRIPT_SYSTEM_PROMPT = `你是一个专业短视频生成器。根据用户输入的知识内容和风格参考，在动画骨架模板的基础上填充内容，生成完整的 HTML 文件。

动画骨架模板：
${animationTemplate}

风格参考：
${styleMD}

输出要求：
1. 在骨架模板的 <!-- AI 在此处扩展样式 --> 处扩展 CSS 样式
2. 在骨架模板的 <!-- AI 在此处填充场景 --> 处填充场景 HTML（使用 .scene 类）
3. 在骨架模板的 // AI 在此处填充 GSAP 动画代码 处填充 GSAP 动画
4. 视频尺寸为 ${width}×${height}，面向抖音等自媒体平台
5. 使用 GSAP 时间线：var tl = gsap.timeline({ paused: true })，最后 tl.play()
6. 每个场景用 <div class="scene s-xxx"> 包裹，CSS 设置 opacity: 0
7. 场景切换用 += 位置参数（相对时间线末尾），禁止使用 delay。以下是示例（仅示意，不要照抄类名和时长）：
    // 场景1显示
    tl.set('#s1', { opacity: 1 }, '+=0');
    tl.from('#s1 .title', { y: 50, opacity: 0, duration: 0.5 }, '+=0.2');
    // 停留后转场隐藏
    tl.to('#s1', { opacity: 0, duration: 0.3 }, '+=4');
    // 场景2（衔接上一个场景）
    tl.set('#s2', { opacity: 1 }, '+=0.2');
    tl.from('#s2 .card', { scale: 0.9, opacity: 0, duration: 0.5 }, '+=0.1');
8. 转场用双层 wipe：水平彩色 wipe + 纵向 wipe
9. 图表用内联 SVG + GSAP 动画（drawSVG/height/opacity）
10. 开场必须有钩子：前 3 秒用动态大字 + 悬念/问题
11. 信息密度要高：每个场景 4-5 秒，只讲 1-2 个点
12. 可用内容区约 ${width - 120}×${height - 120}（${width}×${height} 减 60px padding），所有文字/图表必须在此范围内
13. 标题字号 ≤ 72px，正文 28-36px，每行文字 ≤ 20 字
14. SVG 图表宽度 ≤ 900px，高度 ≤ 1200px
15. 旁白要口语化、自然，适合配音朗读
16. 如果指定了目标时长，通过调整场景数量来控制总时长
17. 输出完整 HTML，不要用 \`\`\`html 包裹，直接输出 JSON 格式
18. 禁止使用 jQuery/$，DOM 选择用 GSAP 内置选择器（如 gsap.to('#s1', ...)）或 document.querySelector
19. 在 <!-- AI 在此处扩展样式 --> 处定义 .subtitle 和 .subtitle-text 样式，风格与模板一致（如 Neo-Brutalist 用硬边框 pill，cream 用圆角柔色，bw 用极简黑白）
20. 表格最多 3 列，每列标题 ≤ 4 字，内容 ≤ 6 字，用 table-layout: fixed 等宽
21. 数据可视化优先用简单柱状图/折线图 SVG，避免复杂多列表格

输出格式必须是严格的 JSON：
{
  "html": "<!DOCTYPE html>\\n<html>...完整 HTML...",
  "narration": "完整旁白文本...",
  "bgm_prompt": "背景音乐风格描述...",
  "duration": 40
}`;

  const userContent = [style && `风格: ${style}`, duration && `目标时长: ${duration}秒`, `内容: ${prompt}`].filter(Boolean).join("\n");

  const scriptRes = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: SCRIPT_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.7,
    }),
  });
  const scriptResult = await scriptRes.json();
  if (!scriptRes.ok) throw new Error("脚本生成失败");

  const rawContent = scriptResult.choices?.[0]?.message?.content?.trim() || "";
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("脚本解析失败");
  const script = JSON.parse(jsonMatch[0]);
  if (!script.html || !script.narration) throw new Error("脚本缺少 html 或 narration 字段");

  timings["① 脚本生成"] = ((Date.now() - tStart) / 1000).toFixed(1) + "s";
  console.log("[video] ① 脚本生成完成，narration:", script.narration.length, "字，html:", script.html.length, "字，耗时:", timings["① 脚本生成"]);

  // 保存 HTML 到 workDir
  const previewPath = path.join(workDir, "preview.html");
  fs.writeFileSync(previewPath, script.html);
  console.log("[video] 预览已保存到 workDir:", previewPath);

  // 导出到 Downloads
  let downloadPath = null;
  if (download) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    downloadPath = path.join(DOWNLOAD_DIR, `preview_${taskId}.html`);
    fs.copyFileSync(previewPath, downloadPath);
    console.log("[video] 预览已导出:", downloadPath);
  }

  updateTask(workDir, {
    status: "preview_ready",
    progress: 50,
    message: "预览已生成，可用 renderVideo 渲染",
    timings,
    script: { ...script, html: undefined, html_len: script.html.length, width, height },
    preview_path: previewPath,
    download_path: downloadPath || null,
    downloadDir: DOWNLOAD_DIR,
  });
  console.log("[video] 预览完成", "|", JSON.stringify(timings));
}

// ═══════════════════════════════════════════════════════════════════
// 视频渲染引擎
// ═══════════════════════════════════════════════════════════════════

async function startVideoRender(opts) {
  const { taskId, workDir, download, DOWNLOAD_DIR, script } = opts;
  const timings = {};
  const tStart = Date.now();
  const SKIP_AUDIO = true;

  updateTask(workDir, { progress: 55, message: "音频合成中..." });

  let narrationPath, bgmPath;
  const totalSceneDuration = script.duration || 40;
  if (SKIP_AUDIO) {
    narrationPath = path.join(workDir, "narration.mp3");
    execSync(`"${ffmpegInstaller.path}" -f lavfi -i anullsrc=r=32000:cl=mono -t ${totalSceneDuration} "${narrationPath}"`);
    bgmPath = null;
  } else {
    const voice_id = "male-qn-qingse";
    const ttsTaskId = await createTTSTask(script.narration, voice_id);
    const [bgmResult, narrationResult] = await Promise.all([
      script.bgm_prompt
        ? generateBGM(script.bgm_prompt, workDir).catch(e => { console.log("[video] BGM 失败:", e.message); return null; })
        : Promise.resolve(null),
      pollTTSTask(ttsTaskId, workDir),
    ]);
    bgmPath = bgmResult;
    narrationPath = narrationResult;
  }
  timings["② 音频"] = ((Date.now() - tStart) / 1000).toFixed(1) + "s";

  const narrationDuration = getAudioDuration(narrationPath);
  console.log("[video] ③ 旁白时长:", narrationDuration.toFixed(1), "s");

  updateTask(workDir, { progress: 60, message: "转换 HyperFrames 格式中..." });

  // 复制本地 GSAP 到 workDir（headless 浏览器无法访问 CDN）
  fs.copyFileSync(GSAP_GSAP, path.join(workDir, "gsap.min.js"));
  fs.copyFileSync(GSAP_DRAWSVG, path.join(workDir, "DrawSVGPlugin.min.js"));

  // 渲染前同步 workDir → Downloads
  const taskFile = path.join(workDir, "task.json");
  const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
  if (state.download_path) {
    fs.copyFileSync(path.join(workDir, "preview.html"), state.download_path);
  }

  const previewPath = path.join(workDir, "preview.html");
  const html = fs.readFileSync(previewPath, "utf-8");
  const subtitles = generateSubtitles(script.narration, narrationDuration);
  console.log("[video] ⑤ 开始转换 HyperFrames...");
  const hfHtml = await convertToHyperFrames(html, narrationDuration, bgmPath, subtitles, script.width, script.height, workDir);
  console.log(`[video] ⑤ HyperFrames 转换完成: ${hfHtml.length} 字, 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s`);

  const indexPath = path.join(workDir, "index.html");
  fs.writeFileSync(indexPath, hfHtml);
  console.log("[video] ④ HyperFrames 格式已生成");

  timings["④ 转换"] = ((Date.now() - tStart) / 1000).toFixed(1) + "s";
  updateTask(workDir, { progress: 65, message: "HyperFrames 渲染中..." });

  const outputPath = path.join(workDir, "output.mp4");
  const env = { ...process.env, PATH: `${path.dirname(ffmpegInstaller.path)}:${path.dirname(ffprobeInstaller.path)}:${process.env.PATH}`, PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS: "900000" };
  console.log("[video] ⑦ HyperFrames 渲染中，workDir:", workDir);

  console.log("[video] ⑥ 渲染输入:", JSON.stringify({
    taskId, htmlSize: html.length, narrationDuration: narrationDuration.toFixed(1),
    totalFrames: Math.round(narrationDuration * 24),
  }));
  await renderWithProgress(workDir, outputPath, env);
  timings["⑦ 渲染"] = ((Date.now() - tStart) / 1000).toFixed(1) + "s";
  updateTask(workDir, { progress: 90, message: "渲染完成，保存中..." });

  const ts = Date.now();
  const finalName = `video_${ts}.mp4`;
  const finalPath = path.join(DOWNLOAD_DIR, finalName);
  if (download) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    fs.copyFileSync(outputPath, finalPath);
  }

  timings["总耗时"] = ((Date.now() - tStart) / 1000).toFixed(1) + "s";
  const result = {
    taskId, status: "done", progress: 100, message: "完成",
    path: download ? finalPath : outputPath,
    duration: Math.round(narrationDuration),
    timings,
  };
  writeTaskState(workDir, result);
  console.log("[video] 全部完成", "|", JSON.stringify(timings));

  setTimeout(() => { try { fs.rmSync(workDir, { recursive: true }); } catch {} }, 60000);
}

// generateSubtitles — 按中文语速（4 字/秒）拆分旁白为字幕段
function generateSubtitles(narration, totalDuration) {
  const sentences = narration.split(/(?<=[。！？，、；：\n])/);
  const charsPerSecond = 4;
  const subtitles = [];
  let currentTime = 0;

  for (const sentence of sentences) {
    const text = sentence.trim();
    if (!text) continue;
    const dur = Math.max(text.length / charsPerSecond, 1.5);
    subtitles.push({ start: currentTime, end: currentTime + dur, text });
    currentTime += dur;
  }
  return subtitles;
}

// convertToHyperFrames — 将 standalone HTML 转换为 HyperFrames 格式
async function convertToHyperFrames(html, totalDuration, bgmPath, subtitles, width = 1080, height = 1920, workDir) {
  const W = width;
  const H = height;
  const actualDuration = totalDuration || 60;

  // 提取 <style> 内容
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  const css = styleMatch ? styleMatch[1] : "";

  // 拉取 Google Fonts CSS，下载字体文件到 workDir，改写为本地路径
  const fontLinks = [...html.matchAll(/<link[^>]*fonts\.googleapis\.com[^>]*href="([^"]+)"[^>]*\/?>/g)];
  const fontStyles = [];
  for (const m of fontLinks) {
    try {
      const res = await fetch(m[1]);
      let css = await res.text();
      // 下载字体文件到 workDir，改写 CSS 中的 url 为本地路径
      const fontUrlMatches = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)];
      for (const fm of fontUrlMatches) {
        try {
          const fontRes = await fetch(fm[1]);
          const fontName = fm[1].split('/').pop()?.split('?')[0] || 'font.woff2';
          fs.writeFileSync(path.join(workDir, fontName), Buffer.from(await fontRes.arrayBuffer()));
          css = css.replace(fm[1], fontName);
        } catch {}
      }
      fontStyles.push(css);
    } catch {}
  }

  // 提取 <script> 内容（GSAP 代码）
  const scriptMatches = [...html.matchAll(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/g)];
  const gsapCode = scriptMatches.map(m => m[1].trim()).filter(Boolean).join("\n");

  // 提取 body 内容
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  const bodyHTML = bodyMatch ? bodyMatch[1] : "";

  const sceneHTML = `<div id="scene-0" class="clip" data-start="0" data-duration="${actualDuration}">\n${bodyHTML}\n</div>`;

  // 生成字幕 clips
  const subtitleClips = (subtitles || []).map((s) => {
    const dur = (s.end - s.start).toFixed(1);
    return `<div class="clip subtitle" data-start="${s.start.toFixed(1)}" data-duration="${dur}">
  <span class="subtitle-text">${escHtml(s.text)}</span>
</div>`;
  });

  const audioTracks = [];
  audioTracks.push(`<audio id="narration" class="clip" data-start="0" data-duration="${actualDuration}" data-track-index="0" data-volume="1" src="narration.mp3"></audio>`);
  if (bgmPath) {
    audioTracks.push(`<audio id="bgm" class="clip" data-start="0" data-duration="${actualDuration}" data-track-index="1" data-volume="0.3" src="bgm.mp3"></audio>`);
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${fontStyles.join("\n")}
.subtitle{position:absolute;bottom:120px;left:80px;right:80px;text-align:center;z-index:100}
.subtitle .subtitle-text{display:inline-block;padding:10px 24px;background:rgba(0,0,0,0.65);color:#fff;border-radius:4px;font-size:28px;line-height:1.5}
${css}
#stage{width:${W}px;height:${H}px;position:relative;overflow:hidden}
</style>
</head>
<body>
<div id="stage" data-composition-id="video" data-start="0" data-width="${W}" data-height="${H}" data-duration="${actualDuration}">
${sceneHTML}
${subtitleClips.join("\n")}
${audioTracks.join("\n")}
</div>
<script src="gsap.min.js"></script>
<script src="DrawSVGPlugin.min.js"></script>
<script>
${gsapCode}
window.__timelines = window.__timelines || {};
window.__timelines.video = tl;
</script>
</body>
</html>`;
}

// renderWithProgress — 异步渲染，解析 hyperframes 进度并更新 task.json
async function renderWithProgress(workDir, outputPath, env) {
  return new Promise((resolve, reject) => {
    const child = exec(`"${HYPERFRAMES_BIN}" render "${workDir}" -o "${outputPath}" --workers ${os.cpus().length} --fps 24 --protocol-timeout=900000 --browser-timeout=300 --player-ready-timeout=5000`, {
      cwd: workDir,
      env,
      timeout: 30 * 60 * 1000,
    });
    child.stdout.on("data", (d) => {
      const text = d.toString();
      console.log("[video] ⑦", text.trim());
      if (text.includes("Compiling composition")) {
        console.log(`[video] ⑦ 编译开始: ${new Date().toLocaleString("zh-CN", { hour12: false })}`);
      }
      if (text.includes("composition metadata resolved")) {
        console.log(`[video] ⑦ 编译完成: ${new Date().toLocaleString("zh-CN", { hour12: false })}`);
      }
      const pctMatch = text.match(/(\d+)%/);
      if (pctMatch) {
        const pct = parseInt(pctMatch[1]);
        const mapped = 65 + Math.round(pct * 0.35);
        updateTask(workDir, { progress: mapped, message: text.trim() });
      }
    });
    child.stderr.on("data", (d) => console.log("[video] ⑦", d.toString().trim()));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`hyperframes exit ${code}`)));
    child.on("error", reject);
  });
}