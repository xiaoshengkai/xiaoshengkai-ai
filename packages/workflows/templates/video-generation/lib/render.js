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
const GSAP_DRAWSVG = path.join(ROOT_DIR, "node_modules", "gsap", "dist", "DrawSVGPlugin.min.js");
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

  // 注入 GSAP 脚本（替换 CDN 为本地文件，hyperframes 离线渲染需要）
  if (fs.existsSync(GSAP_GSAP)) {
    html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap.*?"><\/script>/, `<script>${fs.readFileSync(GSAP_GSAP, "utf-8")}</script>`);
  }
  if (fs.existsSync(GSAP_DRAWSVG)) {
    html = html.replace("</head>", `<script>${fs.readFileSync(GSAP_DRAWSVG, "utf-8")}</script></head>`);
  }

  // 注入音频（跳过不存在的文件）
  if (hasNarration) {
    const narrationDur = getAudioDuration(narrationPath);
    html = html.replace("</head>", `<audio id="narration" src="${narrationPath}" preload="auto"></audio></head>`);
  }
  if (hasBgm) {
    html = html.replace("</head>", `<audio id="bgm" src="${bgmPath}" preload="auto" loop></audio></head>`);
  }

  // 注入播放控制脚本（仅在有旁白时）
  if (hasNarration) {
    html = html.replace("</body>", `<script>
const narration = document.getElementById('narration');
const bgm = document.getElementById('bgm');
let started = false;
function start() {
  if (started) return;
  started = true;
  narration.play();
  if (bgm) { bgm.volume = 0.3; bgm.play(); }
}
document.addEventListener('click', start);
narration.addEventListener('ended', () => {
  if (bgm) bgm.pause();
  setTimeout(() => window.close(), 1000);
});
</script></body>`);
  }

  fs.writeFileSync(htmlPath, html);

  // HyperFrames 渲染
  const cpuCores = cpus().length;
  const cmd = `"${HYPERFRAMES_BIN}" render "${htmlPath}" --output "${path.join(workDir, "output.mp4")}" --width 1080 --height 1920 --fps 24 --workers ${Math.min(cpuCores, 4)} --player-ready-timeout=5000 --protocol-timeout=900000 --player-auto-start`;
  console.log("[render]", cmd);
  execSync(cmd, { stdio: "inherit", cwd: workDir2 });

  const outputPath = path.join(workDir, "output.mp4");
  return { videoFile: outputPath };
}