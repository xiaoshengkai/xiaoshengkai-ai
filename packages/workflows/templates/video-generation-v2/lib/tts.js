import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ERRORS } from "./errors.js";

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function getDurationSec(filePath) {
  return new Promise((resolve, reject) => {
    if (filePath.toLowerCase().endsWith(".mp3")) {
      const proc = spawn("ffprobe", [
        "-v", "error", "-count_packets", "-select_streams", "a:0",
        "-show_entries", "stream=nb_read_packets,sample_rate", "-of", "json", filePath,
      ]);
      let out = "";
      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.on("close", (code) => {
        if (code !== 0) return reject(new Error("ffprobe failed"));
        try {
          const data = JSON.parse(out);
          const stream = data?.streams?.[0];
          const packets = parseInt(stream?.nb_read_packets ?? "", 10);
          const sampleRate = parseInt(stream?.sample_rate ?? "", 10);
          if (packets > 0 && sampleRate > 0) {
            const samplesPerFrame = sampleRate >= 32000 ? 1152 : 576;
            return resolve((packets * samplesPerFrame) / sampleRate);
          }
        } catch { /* fall through */ }
        // fallback: format duration
        resolveFallback(filePath, resolve, reject);
      });
      proc.on("error", reject);
    } else {
      resolveFallback(filePath, resolve, reject);
    }
  });
}

function resolveFallback(filePath, resolve, reject) {
  const proc = spawn("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ]);
  let out = "";
  proc.stdout.on("data", (d) => (out += d.toString()));
  proc.on("close", (code) => {
    if (code !== 0) return reject(new Error("ffprobe failed"));
    const d = parseFloat(out.trim());
    if (isNaN(d)) reject(new Error(`ffprobe returned non-numeric duration for ${filePath}: ${out}`));
    else resolve(d);
  });
  proc.on("error", reject);
}

async function createTTSTask(text, voiceId) {
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

async function pollTTSTask(taskId, outPath) {
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
      fs.writeFileSync(outPath, buffer);
      return;
    }
    if (status === "failed") throw new Error("TTS 任务失败");
    if (status === "expired") throw new Error("TTS 任务已过期");
  }
  throw new Error("TTS 任务超时");
}

async function generateSceneTTS(text, voiceId, outPath, retries = 4) {
  const delays = [1000, 2000, 4000];
  let lastErr;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const taskId = await createTTSTask(text, voiceId);
      await pollTTSTask(taskId, outPath);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < delays.length) {
        console.log(`[tts] 重试 ${attempt + 1}/${retries}，等待 ${delays[attempt]}ms`);
        await sleep(delays[attempt]);
      }
    }
  }
  throw lastErr;
}

export async function generateTTSForScenes(scriptJson, voiceId, executionDir) {
  const totalStart = Date.now();
  let script;
  if (typeof scriptJson === "string") {
    try { script = JSON.parse(scriptJson); } catch { return { output: "script 解析失败" }; }
  } else {
    script = scriptJson;
  }

  const voiceDir = path.join(executionDir, "voice");
  fs.mkdirSync(voiceDir, { recursive: true });

  const durations = {};
  const results = [];
  let failed = 0;

  for (const scene of script.scenes) {
    const sceneStart = Date.now();
    const outPath = path.join(voiceDir, `scene-${scene.id}.mp3`);

    // 缓存：文件存在就跳过
    if (fs.existsSync(outPath)) {
      try {
        const dur = await getDurationSec(outPath);
        durations[scene.id] = dur;
        console.log(`[tts] ${scene.id}: 复用 (${dur.toFixed(2)}s, ${((Date.now() - sceneStart) / 1000).toFixed(1)}s elapsed)`);
        results.push({ sceneId: scene.id, status: "done", path: outPath, duration: dur });
        continue;
      } catch { /* 文件损坏，重新生成 */ }
    }

    try {
      console.log(`[tts] ${scene.id}: 生成中 (${scene.narration.length} 字)...`);
      await generateSceneTTS(scene.narration, voiceId, outPath);
      const dur = await getDurationSec(outPath);
      durations[scene.id] = dur;
      console.log(`[tts] ${scene.id}: ${dur.toFixed(2)}s (${((Date.now() - sceneStart) / 1000).toFixed(1)}s elapsed)`);
      results.push({ sceneId: scene.id, status: "done", path: outPath, duration: dur });
    } catch (e) {
      console.error(`[tts] ${scene.id}: 失败 (${((Date.now() - sceneStart) / 1000).toFixed(1)}s) - ${e.message}`);
      failed++;
      results.push({ sceneId: scene.id, status: "failed", error: e.message });
    }
  }

  fs.writeFileSync(path.join(voiceDir, "durations.json"), JSON.stringify(durations, null, 2));

  const total = script.scenes.length;
  const done = total - failed;
  console.log(`[tts] 完成: ${done}/${total} 场景 (${((Date.now() - totalStart) / 1000).toFixed(1)}s total)`);
  if (failed > 0) {
    throw ERRORS.TTS_PARTIAL_FAILED(failed, total);
  }
  return {
    output: `TTS 完成: ${done}/${total} 个场景${failed > 0 ? `，${failed} 个失败` : ""}`,
    durations,
    results,
  };
}