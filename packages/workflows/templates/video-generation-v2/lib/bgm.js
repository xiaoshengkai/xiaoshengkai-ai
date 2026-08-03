import fs from "node:fs";
import path from "node:path";
import { getDurationSec } from "./tts.js";
import { ERRORS } from "./errors.js";

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function generateBGM(scriptJson, executionDir) {
  const startTime = Date.now();
  let bgmPrompt = "轻快电子";
  if (scriptJson) {
    try {
      const script = typeof scriptJson === "string" ? JSON.parse(scriptJson) : scriptJson;
      bgmPrompt = script.bgm_prompt || "轻快电子";
    } catch { /* use default */ }
  }

  const outPath = path.join(executionDir, "bgm.mp3");

  if (fs.existsSync(outPath)) {
    try {
      const dur = await getDurationSec(outPath);
      console.log(`[bgm] 复用 (${dur.toFixed(2)}s, ${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
      return { bgmFile: outPath, duration: dur, "bgm.mp3": path.basename(outPath) };
    } catch { /* 文件损坏，重新生成 */ }
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
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

      const dur = await getDurationSec(outPath);
      console.log(`[bgm] 完成 (${dur.toFixed(2)}s, ${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
      return { bgmFile: outPath, duration: dur, "bgm.mp3": path.basename(outPath) };
    } catch (e) {
      if (attempt < maxRetries - 1) {
        console.log(`[bgm] 重试 ${attempt + 1}/${maxRetries}`);
        await sleep(2000);
      } else {
        throw ERRORS.BGM_FAILED(e.message);
      }
    }
  }
}