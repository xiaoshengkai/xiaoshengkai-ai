/**
 * vibe-video 渲染步骤：puppeteer 逐帧截图 → ffmpeg stdin 管道直写 MP4
 * （不落 PNG 序列：1.6G 服务器内存/磁盘友好；逐帧低内存常量占用）
 * 帧入口由骨架保证确定性：window.__RENDER_MODE__=true 停掉预览 rAF 循环，画面只由 render(t) 决定。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import puppeteer from "puppeteer-core";
import { findChromeExecutable } from "./browser.js";
import { LOG_DIR } from "../../../lib/state.js";
import { createDateLogger } from "@app/shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const JPEG_QUALITY = 92;

export async function renderVideo(executionDir, htmlFile) {
  const execId = path.basename(executionDir);
  const logger = createDateLogger("workflows", LOG_DIR, execId);
  const startTime = Date.now();

  const htmlPath = path.join(executionDir, htmlFile || "index.html");
  const outputPath = path.join(executionDir, "output.mp4");
  if (!fs.existsSync(htmlPath)) throw new Error(`未找到 ${htmlFile || "index.html"}`);

  /* ── 启动浏览器，读元数据 ── */
  const browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0", timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    const meta = await page.evaluate(() => window.getRenderMeta());
    const { W, H, duration, fps } = { W: meta.W, H: meta.H, duration: meta.duration, fps: meta.fps || 30 };
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.evaluate(() => { window.__RENDER_MODE__ = true; });

    const totalFrames = Math.max(1, Math.ceil(duration * fps));
    logger.info(`[render] 开始: ${W}x${H} @${fps}fps, ${totalFrames} 帧, ${duration}s`);

    /* ── ffmpeg 管道 ── */
    const ffmpegPath = ffmpegInstaller.path;
    const ffargs = [
      "-y",
      "-f", "image2pipe",
      "-framerate", String(fps),
      "-i", "-",
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ];
    const ffmpeg = spawn(ffmpegPath, ffargs, { stdio: ["pipe", "inherit", "pipe"] });
    let ffmpegErr = "";
    ffmpeg.stderr.on("data", d => {
      ffmpegErr += d.toString();
      if (ffmpegErr.length > 8000) ffmpegErr = ffmpegErr.slice(-4000);
    });
    const ffmpegDone = new Promise((resolve, reject) => {
      ffmpeg.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}: ${ffmpegErr.slice(-500)}`)));
      ffmpeg.on("error", reject);
    });

    /* ── 逐帧渲染（背压感知写入） ── */
    const frameStart = Date.now();
    for (let i = 0; i < totalFrames; i++) {
      const t = i / fps;
      await page.evaluate(t => window.render(t), t);
      const buf = await page.screenshot({ type: "jpeg", quality: JPEG_QUALITY, optimizeForSpeed: true });
      if (!ffmpeg.stdin.write(buf)) {
        await new Promise(resolve => ffmpeg.stdin.once("drain", resolve));
      }
      if (i > 0 && i % 300 === 0) {
        const elapsed = (Date.now() - frameStart) / 1000;
        const rate = i / elapsed;
        const eta = (totalFrames - i) / rate;
        logger.info(`[render] 进度 ${i}/${totalFrames} (${(100 * i / totalFrames).toFixed(1)}%, ${(rate).toFixed(1)} 帧/s, 剩余 ~${Math.ceil(eta / 60)} 分钟)`);
      }
    }
    ffmpeg.stdin.end();
    await ffmpegDone;

    const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
    const sizeMB = (fs.statSync(outputPath).size / 1048576).toFixed(1);
    logger.info(`[render] 完成: ${outputPath} (${sizeMB}MB, ${totalFrames} 帧, ${elapsedMin} 分钟)`);
    return {
      videoFile: "output.mp4",
      durationSec: duration,
      fps,
      width: W,
      height: H,
      frames: totalFrames,
    };
  } finally {
    await browser.close();
  }
}
