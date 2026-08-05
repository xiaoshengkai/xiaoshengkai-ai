import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { getAudioDuration } from "./bgm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..", "..");
const GSAP_GSAP = path.join(ROOT_DIR, "node_modules", "gsap", "dist", "gsap.min.js");
const HYPERFRAMES_BIN = path.join(ROOT_DIR, "node_modules", ".bin", "hyperframes");
const ANIMATION_TEMPLATE = path.resolve(__dirname, "..", "templates", "animation.html");

function runFfmpeg(args) {
  const ffmpegPath = ffmpegInstaller.path;
  execSync(`"${ffmpegPath}" ${args}`, { stdio: "inherit" });
}

export async function renderMP4(workDir, allHtml) {
  const startTime = Date.now();
  const narrationPath = path.join(workDir, "narration.mp3");
  const bgmPath = path.join(workDir, "bgm.mp3");
  const outputPath = path.join(workDir, "output.mp4");

  const hasNarration = fs.existsSync(narrationPath);
  const hasBgm = fs.existsSync(bgmPath);

  const workDir2 = path.join(workDir, "render");
  fs.mkdirSync(workDir2, { recursive: true });

  // 用 animation 模板包装场景 HTML
  let html = allHtml || "";
  if (html && !html.includes("<!DOCTYPE") && !html.trim().startsWith("<html")) {
    const template = fs.readFileSync(ANIMATION_TEMPLATE, "utf-8");
    html = template.replace("<!-- AI 在此处填充场景 -->", html);
  }

  if (fs.existsSync(GSAP_GSAP)) {
    html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap.*?"><\/script>/, `<script>${fs.readFileSync(GSAP_GSAP, "utf-8")}</script>`);
  }

  // 注入 data-start 和 data-track-index（纯画面，不注入音频）
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

  // HyperFrames 渲染纯画面
  const cpuCores = cpus().length;
  const ffmpegDir = path.dirname(ffmpegInstaller.path);
  const ffprobeDir = path.dirname(ffprobeInstaller.path);
  const env = { ...process.env, PATH: `${ffmpegDir}:${ffprobeDir}:${process.env.PATH}` };

  const silentPath = path.join(workDir, "output-silent.mp4");
  const cmd = `"${HYPERFRAMES_BIN}" render "${workDir2}" --output "${silentPath}" --width 1080 --height 1920 --fps 24 --workers ${Math.min(cpuCores, 4)} --player-auto-start`;
  console.log("[render] HyperFrames:", cmd);
  execSync(cmd, { stdio: "inherit", cwd: workDir2, env });

  // 用 ffmpeg 混合音频
  if (hasNarration || hasBgm) {
    console.log("[render] 混合音频...");
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
  } else {
    fs.renameSync(silentPath, outputPath);
  }

  console.log(`[render] 完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
  return { videoFile: outputPath };
}