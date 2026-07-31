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

export async function renderMP4(workDir) {
  const previewPath = path.join(workDir, "preview.html");
  const narrationPath = path.join(workDir, "narration.mp3");
  const bgmPath = path.join(workDir, "bgm.mp3");

  if (!fs.existsSync(previewPath)) throw new Error("preview.html 不存在");

  const hasNarration = fs.existsSync(narrationPath);
  const hasBgm = fs.existsSync(bgmPath);

  const workDir2 = path.join(workDir, "render");
  fs.mkdirSync(workDir2, { recursive: true });

  const htmlPath = path.join(workDir2, "index.html");
  let html = fs.readFileSync(previewPath, "utf-8");

  // 替换 GSAP CDN 为本地文件（HyperFrames 离线渲染需要）
  if (fs.existsSync(GSAP_GSAP)) {
    html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap.*?"><\/script>/, `<script>${fs.readFileSync(GSAP_GSAP, "utf-8")}</script>`);
  }

  // 自动注入 data-start 和 data-track-index
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

  // 注入音频
  if (hasNarration) {
    const narrationDur = getAudioDuration(narrationPath);
    html = html.replace("</body>", `<audio data-start="0" data-duration="${narrationDur}" data-track-index="${trackIndex}" data-volume="1.0" src="${narrationPath}" preload="auto"></audio>\n</body>`);
    trackIndex++;
  }
  if (hasBgm) {
    html = html.replace("</body>", `<audio data-start="0" data-duration="${currentTime}" data-track-index="${trackIndex}" data-volume="0.3" src="${bgmPath}" preload="auto" loop></audio>\n</body>`);
  }

  fs.writeFileSync(htmlPath, html);

  // HyperFrames 渲染
  const cpuCores = cpus().length;
  const ffmpegDir = path.dirname(ffmpegInstaller.path);
  const ffprobeDir = path.dirname(ffprobeInstaller.path);
  const env = { ...process.env, PATH: `${ffmpegDir}:${ffprobeDir}:${process.env.PATH}` };
  const cmd = `"${HYPERFRAMES_BIN}" render "${workDir2}" --output "${path.join(workDir, "output.mp4")}" --width 1080 --height 1920 --fps 24 --workers ${Math.min(cpuCores, 4)} --player-auto-start`;
  console.log("[render]", cmd);
  execSync(cmd, { stdio: "inherit", cwd: workDir2, env });

  const outputPath = path.join(workDir, "output.mp4");
  return { videoFile: outputPath };
}