import fs from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { getDurationSec } from "./tts.js";
import { ERRORS } from "./errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..", "..");
const GSAP_GSAP = path.join(ROOT_DIR, "node_modules", "gsap", "dist", "gsap.min.js");
const HYPERFRAMES_BIN = path.join(ROOT_DIR, "node_modules", ".bin", "hyperframes");

const RENDER_FPS = 24;
const RENDER_TIMEOUT_MS = 300000;
const SCENE_GAP_SEC = 0.3;

export async function renderScenes(scriptJson, executionDir) {
  const totalStart = Date.now();
  let script;
  if (typeof scriptJson === "string") {
    try { script = JSON.parse(scriptJson); } catch { return { output: "script 解析失败" }; }
  } else {
    script = scriptJson;
  }

  let durations = {};
  const durationsPath = path.join(executionDir, "voice", "durations.json");
  if (fs.existsSync(durationsPath)) {
    durations = JSON.parse(fs.readFileSync(durationsPath, "utf-8"));
  }

  const clipsDir = path.join(executionDir, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });

  const manifest = [];
  let failed = 0;
  const lastIdx = script.scenes.length - 1;

  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    const sceneStart = Date.now();
    const ttsDuration = durations[scene.id] || 5;
    const visualDuration = ttsDuration + (i < lastIdx ? SCENE_GAP_SEC : 3);

    const clipPath = path.join(clipsDir, `scene-${scene.id}.mp4`);

    if (fs.existsSync(clipPath)) {
      try {
        const actualDur = await getDurationSec(clipPath);
        const diff = Math.abs(actualDur - visualDuration);
        console.log(`[render] ${scene.id}: 复用 (${actualDur.toFixed(2)}s, ${((Date.now() - sceneStart) / 1000).toFixed(1)}s elapsed)`);
        manifest.push({
          sceneId: scene.id,
          path: clipPath,
          templateId: scene.templateId,
          targetDuration: visualDuration,
          actualDuration: actualDur,
          alignmentDiff: diff,
          warning: diff > 2 ? "时长偏差过大" : null,
        });
        continue;
      } catch { /* 文件损坏，重新渲染 */ }
    }

    try {
      const rawClip = await renderTemplateClip(scene, executionDir, i);

      await fitClipToDuration(rawClip, visualDuration, clipPath, RENDER_FPS);

      const actualDur = await getDurationSec(clipPath);
      const diff = Math.abs(actualDur - visualDuration);
      console.log(`[render] ${scene.id}: ${scene.templateId} → ${visualDuration.toFixed(2)}s (${((Date.now() - sceneStart) / 1000).toFixed(1)}s elapsed)`);

      manifest.push({
        sceneId: scene.id,
        path: clipPath,
        templateId: scene.templateId,
        targetDuration: visualDuration,
        actualDuration: actualDur,
        alignmentDiff: diff,
        warning: diff > 2 ? "时长偏差过大" : null,
      });
    } catch (e) {
      console.error(`[render] ${scene.id}: 失败 (${((Date.now() - sceneStart) / 1000).toFixed(1)}s) - ${e.message}`);
      failed++;
      manifest.push({
        sceneId: scene.id,
        path: null,
        templateId: scene.templateId,
        targetDuration: visualDuration,
        error: e.message,
      });
    }
  }

  fs.writeFileSync(path.join(clipsDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const total = script.scenes.length;
  const done = total - failed;
  console.log(`[render] 完成: ${done}/${total} 场景 (${((Date.now() - totalStart) / 1000).toFixed(1)}s total)`);
  return {
    output: `渲染完成: ${done}/${total} 个场景${failed > 0 ? `，${failed} 个失败` : ""}`,
    manifest,
  };
}

async function renderTemplateClip(scene, executionDir, index) {
  const templateDir = path.resolve(__dirname, "templates", scene.templateId);
  if (!fs.existsSync(path.join(templateDir, "index.html"))) {
    throw new Error(`模板不存在: ${scene.templateId}`);
  }

  const entryFile = fs.existsSync(path.join(templateDir, "compositions/portrait.html"))
    ? "compositions/portrait.html"
    : "index.html";

  const workDir = path.join(executionDir, "render", `scene-${scene.id}`);
  fs.mkdirSync(workDir, { recursive: true });

  // 复制模板文件到工作目录
  fs.cpSync(templateDir, workDir, { recursive: true });

  // 复制字体到 workDir 父目录（让 HTML 的 ../fonts/ 能解析）
  const fontsDir = path.resolve(__dirname, "..", "fonts");
  const renderParentDir = path.dirname(workDir);
  if (fs.existsSync(fontsDir) && !fs.existsSync(path.join(renderParentDir, "fonts"))) {
    fs.cpSync(fontsDir, path.join(renderParentDir, "fonts"), { recursive: true });
  }

  // 替换 GSAP CDN
  const htmlPath = path.join(workDir, entryFile);
  let html = fs.readFileSync(htmlPath, "utf-8");
  if (fs.existsSync(GSAP_GSAP)) {
    html = html.replace(
      /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap.*?"><\/script>/,
      `<script>${fs.readFileSync(GSAP_GSAP, "utf-8")}</script>`
    );
  }

  // 写变量文件（HyperFrames --variables-file 注入 window.__hyperframes.getVariables()）
  const varsFile = path.join(workDir, "variables.json");
  const vars = { ...scene.inputs };
  fs.writeFileSync(varsFile, JSON.stringify(vars), "utf8");

  // 删除 HTML 里原始的 data-composition-variables（让 --variables-file 独占控制）
  html = html.replace(/\s*data-composition-variables='[^']*'/, "");
  fs.writeFileSync(htmlPath, html);

  // 渲染
  const cpuCores = cpus().length;
  const ffmpegDir = path.dirname(ffmpegInstaller.path);
  const ffprobeDir = path.dirname(ffprobeInstaller.path);
  const env = { ...process.env, PATH: `${ffmpegDir}:${ffprobeDir}:${process.env.PATH}` };

  const outPath = path.join(executionDir, "render", `scene-${scene.id}-raw.mp4`);
  const cmd = `"${HYPERFRAMES_BIN}" render "${workDir}" --composition "${entryFile}" --output "${outPath}" --variables-file "${varsFile}" --width 1080 --height 1920 --fps ${RENDER_FPS} --workers ${Math.min(cpuCores, 4)} --player-auto-start`;

  console.log(`[render] ${cmd}`);

  try {
    execSync(cmd, { stdio: "inherit", cwd: workDir, env, timeout: RENDER_TIMEOUT_MS });
  } catch (e) {
    throw ERRORS.RENDER_FAILED(scene.id, e.message);
  }

  return outPath;
}

function fitClipToDuration(inPath, targetSec, outPath, fps = 24) {
  return new Promise((resolve, reject) => {
    const args = ["-y", "-i", inPath];
    const target = Math.max(0.1, targetSec);

    const probe = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", inPath,
    ]);
    let probeOut = "";
    probe.stdout.on("data", (d) => (probeOut += d.toString()));
    probe.on("close", (code) => {
      if (code !== 0) return reject(new Error("ffprobe failed"));
      const inDur = parseFloat(probeOut.trim());
      if (target > inDur + 0.02) {
        const ext = target - inDur;
        args.push("-vf", `tpad=stop_mode=clone:stop_duration=${ext.toFixed(3)}`);
      }
      args.push("-t", target.toFixed(3), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(fps), outPath);

      const proc = spawn("ffmpeg", args);
      proc.on("close", (c) => c === 0 ? resolve() : reject(new Error("ffmpeg failed")));
      proc.on("error", reject);
    });
    probe.on("error", reject);
  });
}