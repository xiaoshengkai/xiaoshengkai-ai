import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { getAudioDuration } from "./bgm.js";
import { createItemLogger } from "../../../../shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..", "..");
const LOG_DIR = path.join(ROOT_DIR, "logs", "workflows");
const GSAP_GSAP = path.join(ROOT_DIR, "node_modules", "gsap", "dist", "gsap.min.js");
const HYPERFRAMES_BIN = path.join(ROOT_DIR, "node_modules", ".bin", "hyperframes");
const ANIMATION_TEMPLATE = path.resolve(__dirname, "..", "templates", "animation.html");

function runFfmpeg(args) {
  const ffmpegPath = ffmpegInstaller.path;
  execSync(`"${ffmpegPath}" ${args}`, { stdio: "inherit" });
}

export async function renderMP4(workDir, allHtml) {
  const execId = path.basename(path.resolve(workDir, ".."));
  const logger = createItemLogger(LOG_DIR, execId);
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

  if (fs.existsSync(GSAP_GSAP)) {
    html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap.*?"><\/script>/, `<script>${fs.readFileSync(GSAP_GSAP, "utf-8")}</script>`);
  }

  html = html.replace(/font-family:\s*'[^']*'/gi, "font-family: sans-serif");
  html = html.replace(/font-family:\s*"[^"]*"/gi, "font-family: sans-serif");

  let currentTime = 0;
  let trackIndex = 0;
  html = html.replace(/class="clip([^"]*)"/g, (match, attrs) => {
    const durMatch = attrs.match(/data-duration="(\d+)"/);
    const dur = durMatch ? parseInt(durMatch[1]) : 5;
    const result = `class="clip${attrs}" data-start="${currentTime}" data-track-index="${trackIndex}"`;
    currentTime += dur;
    trackIndex++;
    return result;
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
  execSync(cmd, { stdio: "inherit", cwd: workDir2, env });
  logger.info(`[render] HyperFrames 完成 (${((Date.now() - hfStart) / 1000).toFixed(1)}s)`);

  if (hasNarration || hasBgm) {
    const mixStart = Date.now();
    logger.info("[render] ffmpeg 混合音频...");
    const args = ["-y", "-i", silentPath];
    if (hasNarration) args.push("-i", narrationPath);
    if (hasBgm) args.push("-i", bgmPath);

    let filter = "";
    if (hasNarration && hasBgm) {
      filter = `[1:a]volume=1.0[n];[2:a]volume=0.3[b];[n][b]amix=inputs=2:duration=first:dropout_transition=0[out]`;
      args.push("-filter_complex", filter, "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", outputPath);
    } else if (hasNarration) {
      args.push("-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", outputPath);
    } else if (hasBgm) {
      filter = `[1:a]volume=0.3[out]`;
      args.push("-filter_complex", filter, "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", outputPath);
    }
    runFfmpeg(args.join(" "));
    fs.unlinkSync(silentPath);
    logger.info(`[render] ffmpeg 完成 (${((Date.now() - mixStart) / 1000).toFixed(1)}s)`);
  } else {
    fs.renameSync(silentPath, outputPath);
  }

  logger.info(`[render] 完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s total)`);
  return { videoFile: outputPath };
}