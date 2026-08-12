const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";
import { sleep } from "../../../../shared/utils.js";

export async function createTTSTask(text, voiceId) {
  const apiKey = process.env.MINIMAX_API_KEY;
  const res = await fetch(`${MINIMAX_BASE_URL}/t2a_async_v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "speech-2.8-hd",
      text,
      voice_setting: { voice_id: voiceId, speed: 1, vol: 1, pitch: 1 },
      audio_setting: { audio_sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 2 },
    }),
  });
  const result = await res.json();
  if (result.base_resp?.status_code !== 0) {
    throw new Error(`TTS 任务创建失败: ${result.base_resp?.status_msg}`);
  }
  return result.task_id;
}

export async function pollTTSTask(taskId, workDir) {
  const apiKey = process.env.MINIMAX_API_KEY;
  const maxAttempts = 300;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const res = await fetch(`${MINIMAX_BASE_URL}/query/t2a_async_query_v2?task_id=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const result = await res.json();
    const status = (result.status || "").toLowerCase();

    if (i % 10 === 0) {
      console.log(`[tts] 轮询中... status=${result.status} 已等待 ${i * 2}s`);
    }

    if (status === "success") {
      const fileRes = await fetch(`${MINIMAX_BASE_URL}/files/retrieve?file_id=${result.file_id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const fileResult = await fileRes.json();
      const downloadUrl = fileResult.file?.download_url;
      if (!downloadUrl) throw new Error("TTS 下载链接获取失败");
      const audioRes = await fetch(downloadUrl);
      const buffer = Buffer.from(await audioRes.arrayBuffer());
      if (buffer.length < 3 || buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) {
        throw new Error(`TTS 下载文件头无效 (前 3 字节: ${buffer.slice(0, 3).toString("hex")}，期望 ID3 头)`);
      }
      const outPath = `${workDir}/narration.mp3`;
      const fs = await import("node:fs");
      fs.writeFileSync(outPath, buffer);
      return outPath;
    }
    if (status === "failed") throw new Error("TTS 任务失败");
    if (status === "expired") throw new Error("TTS 任务已过期");
  }
  throw new Error("TTS 任务超时");
}

export async function generateTTS(text, voiceId, workDir, enableTts) {
  console.log(`[tts] enableTts="${enableTts}"`);
  if (enableTts === "no") {
    console.log("[tts] skipped by engine");
    return { output: "TTS disabled" };
  }
  const startTime = Date.now();
  console.log(`[tts] 开始 (${text.length} 字)`);
  const taskId = await createTTSTask(text, voiceId);
  const result = await pollTTSTask(taskId, workDir);
  console.log(`[tts] 完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
  return result;
}