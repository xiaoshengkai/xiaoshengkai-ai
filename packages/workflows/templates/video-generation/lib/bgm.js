import fs from "node:fs";

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";

export async function generateBGM(bgmPrompt, workDir) {
  const apiKey = process.env.MINIMAX_API_KEY;
  const res = await fetch(`${MINIMAX_BASE_URL}/music_generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "music-2.6",
      prompt: bgmPrompt,
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
  const outPath = `${workDir}/bgm.mp3`;
  fs.writeFileSync(outPath, buffer);
  return outPath;
}