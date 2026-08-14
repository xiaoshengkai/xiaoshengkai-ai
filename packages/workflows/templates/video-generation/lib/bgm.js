import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { ERRORS } from "./errors.js";
import { sleep } from "../../../../shared/utils.js";

function getConfig() {
  const defaults = {
    baseURL: process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1",
    model: "music-2.6",
  };
  try {
    const settingsDir = path.resolve(process.cwd(), "..", "..", "..", "data", "settings");
    const providersPath = path.join(settingsDir, "providers.json");
    const selectionPath = path.join(settingsDir, "selection.json");
    if (fs.existsSync(providersPath)) {
      const p = JSON.parse(fs.readFileSync(providersPath, "utf-8"));
      if (p.minimax?.baseURL) defaults.baseURL = p.minimax.baseURL;
    }
    if (fs.existsSync(selectionPath)) {
      const s = JSON.parse(fs.readFileSync(selectionPath, "utf-8"));
      if (s.bgm?.model) defaults.model = s.bgm.model;
    }
  } catch { /* fallback to defaults */ }
  return defaults;
}

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

  const cfg = getConfig();
  const apiKey = process.env.MINIMAX_API_KEY;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${cfg.baseURL}/music_generation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
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