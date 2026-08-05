import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { ERRORS } from "./errors.js";

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function generateBGM(bgmPrompt, executionDir, bgmFilePath) {
  const outPath = path.join(executionDir, "bgm.mp3");

  if (bgmFilePath && fs.existsSync(bgmFilePath)) {
    fs.copyFileSync(bgmFilePath, outPath);
    return { bgmFile: outPath, "bgm.mp3": "bgm.mp3" };
  }

  if (fs.existsSync(outPath)) {
    return { bgmFile: outPath, "bgm.mp3": "bgm.mp3" };
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${MINIMAX_BASE_URL}/music_generation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "music-2.6",
          prompt: bgmPrompt || "轻快电子",
          is_instrumental: true,
          output_format: "url",
          audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 2 },
        }),
      });
      const result = await res.json();
      if (result.base_resp?.status_code !== 0) {
        throw new Error(`BGM 生成失败: ${result.base_resp?.status_msg}`);
      }
      const downloadUrl = result.data?.audio;
      if (!downloadUrl) throw new Error("BGM 下载链接获取失败");
      const audioRes = await fetch(downloadUrl);
      const buffer = Buffer.from(await audioRes.arrayBuffer());
      fs.writeFileSync(outPath, buffer);
      return { bgmFile: outPath, "bgm.mp3": "bgm.mp3" };
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