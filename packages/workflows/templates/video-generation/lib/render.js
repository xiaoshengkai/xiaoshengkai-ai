import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { getAudioDuration } from "./bgm.js";
import { createDateLogger } from "../../../../shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..", "..");
const LOG_DIR = path.join(ROOT_DIR, "logs", "workflows");
const GSAP_GSAP = path.join(ROOT_DIR, "node_modules", "gsap", "dist", "gsap.min.js");
const HYPERFRAMES_BIN = path.join(ROOT_DIR, "node_modules", ".bin", "hyperframes");
const ANIMATION_TEMPLATE = path.resolve(__dirname, "..", "templates", "animation.html");
const TEMPLATE_DIR = path.resolve(__dirname, "..");
const FONTS_DIR = path.join(TEMPLATE_DIR, "fonts");
const RENDER_TIMEOUT_MS = 300000;

const FONT_FACES = [
  { family: "Noto Sans SC", weight: 400, file: "noto-sans-sc-chinese-simplified-400-normal.woff2" },
  { family: "Noto Sans SC", weight: 500, file: "noto-sans-sc-chinese-simplified-500-normal.woff2" },
  { family: "Noto Sans SC", weight: 700, file: "noto-sans-sc-chinese-simplified-700-normal.woff2" },
  { family: "Noto Sans SC", weight: 900, file: "noto-sans-sc-chinese-simplified-900-normal.woff2" },
  { family: "Archivo", weight: 500, file: "archivo-latin-500-normal.woff2" },
  { family: "Archivo", weight: 700, file: "archivo-latin-700-normal.woff2" },
  { family: "Archivo", weight: 900, file: "archivo-latin-900-normal.woff2" },
  { family: "Alfa Slab One", weight: 400, file: "alfa-slab-one-latin-400-normal.woff2" },
  { family: "Be Vietnam Pro", weight: 500, style: "italic", file: "be-vietnam-pro-latin-500-italic.woff2" },
  { family: "Be Vietnam Pro", weight: 500, file: "be-vietnam-pro-latin-500-normal.woff2" },
  { family: "Be Vietnam Pro", weight: 600, file: "be-vietnam-pro-latin-600-normal.woff2" },
  { family: "Be Vietnam Pro", weight: 700, style: "italic", file: "be-vietnam-pro-latin-700-italic.woff2" },
  { family: "Be Vietnam Pro", weight: 700, file: "be-vietnam-pro-latin-700-normal.woff2" },
  { family: "Be Vietnam Pro", weight: 800, style: "italic", file: "be-vietnam-pro-latin-800-italic.woff2" },
  { family: "Be Vietnam Pro", weight: 800, file: "be-vietnam-pro-latin-800-normal.woff2" },
  { family: "Be Vietnam Pro", weight: 900, style: "italic", file: "be-vietnam-pro-latin-900-italic.woff2" },
  { family: "Be Vietnam Pro", weight: 900, file: "be-vietnam-pro-latin-900-normal.woff2" },
  { family: "Inter", weight: 200, file: "inter-latin-200-normal.woff2" },
  { family: "Inter", weight: 300, file: "inter-latin-300-normal.woff2" },
  { family: "Inter", weight: 400, file: "inter-latin-400-normal.woff2" },
  { family: "Inter", weight: 500, file: "inter-latin-500-normal.woff2" },
  { family: "Inter", weight: 700, file: "inter-latin-700-normal.woff2" },
  { family: "Inter", weight: 800, file: "inter-latin-800-normal.woff2" },
  { family: "Inter", weight: 900, file: "inter-latin-900-normal.woff2" },
  { family: "Inter Tight", weight: 400, file: "inter-tight-latin-400-normal.woff2" },
  { family: "Inter Tight", weight: 500, file: "inter-tight-latin-500-normal.woff2" },
  { family: "Inter Tight", weight: 700, file: "inter-tight-latin-700-normal.woff2" },
  { family: "Inter Tight", weight: 800, file: "inter-tight-latin-800-normal.woff2" },
  { family: "Inter Tight", weight: 900, file: "inter-tight-latin-900-normal.woff2" },
  { family: "Lora", weight: 400, style: "italic", file: "lora-latin-400-italic.woff2" },
  { family: "Lora", weight: 500, style: "italic", file: "lora-latin-500-italic.woff2" },
  { family: "Lora", weight: 600, style: "italic", file: "lora-latin-600-italic.woff2" },
  { family: "Lora", weight: 700, style: "italic", file: "lora-latin-700-italic.woff2" },
  { family: "Space Mono", weight: 400, file: "space-mono-latin-400-normal.woff2" },
  { family: "Space Mono", weight: 700, file: "space-mono-latin-700-normal.woff2" },
];

function buildFontFaceBlock() {
  return FONT_FACES.map(f => {
    const style = f.style || "normal";
    return `@font-face{font-family:'${f.family}';font-style:${style};font-weight:${f.weight};src:url('fonts/${f.file}') format('woff2');}`;
  }).join("\n");
}

const FONT_FACE_BLOCK = buildFontFaceBlock();

function localizeFonts(html, workDir) {
  html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']https?:\/\/[^"']*["'][^>]*\/?>/gi, "");
  html = html.replace(/<link[^>]*href=["']https?:\/\/[^"']*["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi, "");
  html = html.replace(/@import\s+url\(["']?https?:\/\/[^"')]*["']?\)\s*;?/gi, "");
  html = html.replace(/<script[^>]*src=["']https?:\/\/[^"']*["'][^>]*>\s*<\/script>/gi, "");

  html = html.replace("</head>", `\n<style>\n${FONT_FACE_BLOCK}\n</style>\n</head>`);

  const destFonts = path.join(workDir, "fonts");
  if (fs.existsSync(FONTS_DIR) && !fs.existsSync(destFonts)) {
    fs.cpSync(FONTS_DIR, destFonts, { recursive: true });
  }

  return html;
}

function runFfmpeg(args) {
  const ffmpegPath = ffmpegInstaller.path;
  try {
    execSync(`"${ffmpegPath}" ${args}`, { stdio: ["inherit", "inherit", "pipe"] });
  } catch (e) {
    const stderr = e.stderr?.toString() || "";
    throw new Error(`ffmpeg 失败: ${stderr || e.message}`);
  }
}

function dedupeCss(css) {
  if (!css) return "";
  const map = new Map();
  const lines = css.split("\n");
  for (const line of lines) {
    const m = line.match(/^(\.[\w-]+)\s*\{\s*(.+)\s*\}$/);
    if (m) {
      const key = m[2].trim();
      if (!map.has(key)) map.set(key, []);
      const existing = map.get(key);
      if (!existing.includes(m[1])) {
        existing.push(m[1]);
      }
    }
  }
  const result = [];
  for (const [value, selectors] of map) {
    if (selectors.length > 1) {
      result.push(`${selectors.join(", ")} { ${value} }`);
    } else {
      result.push(`${selectors[0]} { ${value} }`);
    }
  }
  return result.join("\n");
}

export async function renderMP4(workDir, allHtml, globalCss, globalJsAnimation, scenesJson) {
  const execId = path.basename(workDir);
  const logger = createDateLogger("workflows", LOG_DIR, execId);
  const startTime = Date.now();
  const narrationPath = path.join(workDir, "narration.mp3");
  const bgmPath = path.join(workDir, "bgm.mp3");
  const outputPath = path.join(workDir, "output.mp4");

  const hasNarration = fs.existsSync(narrationPath);
  const hasBgm = fs.existsSync(bgmPath);
  logger.info(`[render] 开始 (narration=${hasNarration}, bgm=${hasBgm})`);

  const workDir2 = path.join(workDir, "render");
  fs.mkdirSync(workDir2, { recursive: true });

  let html = allHtml || "";
  if (html && !html.includes("<!DOCTYPE") && !html.trim().startsWith("<html")) {
    const template = fs.readFileSync(ANIMATION_TEMPLATE, "utf-8");
    html = template.replace("<!-- AI 在此处填充场景 -->", html);
  }

  const scenes = scenesJson ? JSON.parse(scenesJson) : [];
  const allCss = [globalCss, ...scenes.map(s => s.css || "")].filter(Boolean).join("\n");
  const allJs = [globalJsAnimation, ...scenes.map(s => s.jsAnimation || "")].filter(Boolean).join("\n");

  const dedupedCss = dedupeCss(allCss);

  if (dedupedCss) {
    html = html.replace("/* GLOBAL_CSS_INJECTION */", dedupedCss);
  }
  if (allJs) {
    html = html.replace("// GLOBAL_JS_INJECTION", allJs);
  }

  if (fs.existsSync(GSAP_GSAP)) {
    html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap.*?"><\/script>/, `<script>${fs.readFileSync(GSAP_GSAP, "utf-8")}</script>`);
  }

  html = localizeFonts(html, workDir2);

  let currentTime = 0;
  let trackIndex = 0;
  html = html.replace(/(<div[^>]*class=["']clip(?:\s|["'])[^>]*>)/g, (match) => {
    const durMatch = match.match(/data-duration=["']?(\d+)["']?/);
    const dur = durMatch ? parseInt(durMatch[1]) : 5;
    const result = match.replace('>', ` data-start="${currentTime}" data-track-index="${trackIndex}">`);
    currentTime += dur;
    trackIndex++;
    return result;
  });

  // 设置 stage 总时长（HyperFrames 需要）
  html = html.replace(/<div[^>]*id=["']stage["'][^>]*>/g, (match) => {
    if (match.includes('data-duration=')) return match;
    return match.replace('>', ` data-duration="${currentTime}">`);
  });

  const htmlPath = path.join(workDir2, "index.html");
  fs.writeFileSync(htmlPath, html);
  logger.info(`[render] HTML 生成 (${((Date.now() - startTime) / 1000).toFixed(1)}s, ${html.length} 字节)`);

  const cpuCores = cpus().length;
  const ffmpegDir = path.dirname(ffmpegInstaller.path);
  const ffprobeDir = path.dirname(ffprobeInstaller.path);
  const env = { ...process.env, PATH: `${ffmpegDir}:${ffprobeDir}:${process.env.PATH}` };

  const hfStart = Date.now();
  const silentPath = path.join(workDir, "output-silent.mp4");
  const cmd = `"${HYPERFRAMES_BIN}" render "${workDir2}" --output "${silentPath}" --width 1080 --height 1920 --fps 24 --workers ${Math.min(cpuCores, 4)} --player-auto-start`;
  logger.info("[render] HyperFrames 开始...");
  try {
    execSync(cmd, { stdio: ["inherit", "inherit", "pipe"], cwd: workDir2, env, timeout: RENDER_TIMEOUT_MS });
  } catch (e) {
    const stderr = e.stderr?.toString() || "";
    throw new Error(`HyperFrames 渲染失败: ${stderr || e.message}`);
  }
  logger.info(`[render] HyperFrames 完成 (${((Date.now() - hfStart) / 1000).toFixed(1)}s)`);

  const videoDur = getAudioDuration(silentPath);

  if (hasNarration || hasBgm) {
    const mixStart = Date.now();
    logger.info("[render] ffmpeg 混合音频...");
    const args = ["-y", "-i", silentPath];
    if (hasNarration) args.push("-i", narrationPath);
    if (hasBgm) {
      const bgmDur = getAudioDuration(bgmPath);
      if (bgmDur < videoDur) {
        args.push("-stream_loop", "-1");
        logger.info(`[render] BGM 循环 (${bgmDur.toFixed(1)}s < video ${videoDur.toFixed(1)}s)`);
      }
      args.push("-i", bgmPath);
    }

    let filter = "";
    if (hasNarration && hasBgm) {
      filter = `[1:a]volume=1.0[n];[2:a]volume=0.3[b];[n][b]amix=inputs=2:duration=shortest:dropout_transition=0[out]`;
      args.push("-filter_complex", filter, "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", outputPath);
    } else if (hasNarration) {
      args.push("-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", outputPath);
    } else if (hasBgm) {
      filter = `[1:a]volume=0.3[out]`;
      args.push("-filter_complex", filter, "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", outputPath);
    }
    runFfmpeg(args.join(" "));
    fs.unlinkSync(silentPath);
    logger.info(`[render] ffmpeg 完成 (${((Date.now() - mixStart) / 1000).toFixed(1)}s)`);
  } else {
    fs.renameSync(silentPath, outputPath);
  }

  logger.info(`[render] 完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s total)`);

  // 保存视频版本
  try {
    const { saveVideoVersion } = await import("../../../engine.js");
    const statePath = path.join(workDir, "state.json");
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      // 首次渲染：如果还没有历史记录，初始化 v0
      if (!state.scriptHistory && state.template === "video-generation") {
        const scriptStep = state.steps.find(s => s.id === "script");
        if (scriptStep?.output?.script) {
          const scriptsDir = path.join(workDir, "scripts");
          if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
          const s = typeof scriptStep.output.script === "string" ? JSON.parse(scriptStep.output.script) : scriptStep.output.script;
          fs.writeFileSync(path.join(scriptsDir, "v0.json"), JSON.stringify(s, null, 2));
          state.scriptHistory = [{ version: 0, at: state.startedAt || new Date().toISOString(), feedback: "初次生成", videoFile: null }];
          state.currentScriptVersion = 0;
          state.tweakCount = 0;
          state.tweakLimit = 99999;
          fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        }
      }
      const ver = state.currentScriptVersion ?? 0;
      saveVideoVersion(execId, ver, outputPath);
      logger.info(`[render] 视频版本 v${ver} 已保存`);
    }
  } catch (e) {
    logger.warn(`[render] 保存视频版本失败: ${e.message}`);
  }

  return { videoFile: outputPath };
}