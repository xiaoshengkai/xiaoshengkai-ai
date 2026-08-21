import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { ERRORS } from "./errors.js";
import { sleep } from "@app/shared/utils.js";
import { generateBGM as sharedGenerateBGM } from "@app/shared/llm/index.js";

export async function generateBGM(bgmPrompt, executionDir, bgmFilePath) {
  const startTime = Date.now();
  const outPath = path.join(executionDir, "bgm.mp3");

  let dur;
  if (bgmFilePath && fs.existsSync(bgmFilePath)) {
    fs.copyFileSync(bgmFilePath, outPath);
    dur = getAudioDuration(outPath);
    console.log(`[bgm] use uploaded file (${dur.toFixed(1)}s, ${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
    return { bgmFile: outPath, duration: dur, "bgm.mp3": "bgm.mp3" };
  }

  if (fs.existsSync(outPath)) {
    dur = getAudioDuration(outPath);
    console.log(`[bgm] reuse (${dur.toFixed(1)}s, ${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
    return { bgmFile: outPath, duration: dur, "bgm.mp3": "bgm.mp3" };
  }

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sharedGenerateBGM({ prompt: bgmPrompt, outputPath: outPath });
      dur = getAudioDuration(outPath);
      console.log(`[bgm] done (${dur.toFixed(1)}s, ${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
      return { bgmFile: outPath, duration: dur, "bgm.mp3": "bgm.mp3" };
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(2000);
    }
  }
  throw ERRORS.BGM_FAILED(lastErr?.message || "unknown");
}

export function getAudioDuration(filePath) {
  const ffmpegPath = ffmpegInstaller.path;
  const stdout = execSync(`"${ffmpegPath}" -i "${filePath}" -f null - 2>&1`, { encoding: "utf-8" });
  const match = stdout.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return 60;
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 100;
}
