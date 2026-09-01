import fs from "node:fs";
import { getApiKey, getBaseUrl, getProviderModel } from "../config.js";
import { sleep } from "../../utils.js";

export async function callLLM({ system, user, model, temperature = 0.7, maxTokens = 8000, format = 'json_object', images = [] }) {
  const apiKey = getApiKey("minimax", "MINIMAX_API_KEY");
  if (!apiKey) throw new Error("未配置 MINIMAX_API_KEY");

  const baseURL = getBaseUrl("minimax", "MINIMAX_BASE_URL", "https://api.minimaxi.com/v1");
  const actualModel = model || getProviderModel("minimax", "chat", "MINIMAX_CHAT_MODEL", "MiniMax-M3");
  console.log(`[minimax] 当前调用: model=${actualModel} baseURL=${baseURL}`);

  const userContent = images.length > 0
    ? [{ type: "text", text: user }, ...images.map(d => ({ type: "image_url", image_url: { url: d, detail: "default" } }))]
    : user;

  const body = {
    model: actualModel,
    thinking: { type: "disabled" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (format) body.response_format = { type: format };

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.log(`[minimax] callLLM: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    throw new Error(`MiniMax API 错误 (${res.status}): ${data.error?.message || "未知错误"}`);
  }
  const msg = data.choices?.[0]?.message || {};
  console.log(`[minimax] usage: ${JSON.stringify(data.usage)}`);
  return {
    text: msg.content || "",
    usage: {
      totalTokens: data.usage?.totalTokens || data.usage?.total_tokens || 0,
      completionTokens: data.usage?.completionTokens || data.usage?.completion_tokens || 0,
    },
  };
}

export async function generateImage(prompt, { aspectRatio = "1:1", model, image_url, n = 1, watermark = false, seed } = {}) {
  const apiKey = getApiKey("minimax", "MINIMAX_API_KEY");
  if (!apiKey) throw new Error("未配置 MINIMAX_API_KEY");

  const baseURL = getBaseUrl("minimax", "MINIMAX_BASE_URL", "https://api.minimaxi.com/v1");
  const actualModel = model || getProviderModel("minimax", "image", "MINIMAX_IMAGE_MODEL", "image-01");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const body = {
    model: actualModel,
    prompt,
    aspect_ratio: aspectRatio,
    n,
    prompt_optimizer: false,
    aigc_watermark: watermark,
    response_format: "url",
  };
  if (seed != null) body.seed = seed;
  if (image_url) {
    body.subject_reference = [{ type: "character", image_file: Array.isArray(image_url) ? image_url[0] : image_url }];
  }

  const res = await fetch(`${baseURL}/image_generation`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  clearTimeout(timeout);

  const result = await res.json();
  if (result.base_resp?.status_code !== 0) {
    throw new Error(result.base_resp?.status_msg || "图片生成失败");
  }

  const urls = result.data?.image_urls || [];
  if (urls.length === 0) throw new Error("未获取到图片 URL");
  return urls;
}

// ─── TTS 语音合成（异步：创建→轮询→下载）───────────────────────────────

// ponytail: MiniMax TTS 现在返回 tar 归档（_with_meta.tar，含 .mp3/.extra/.titles），
// 从 tar 里解出 .mp3 条目（512 字节头 + octal 尺寸）
function extractMp3FromTar(buf) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const name = buf.slice(off, off + 100).toString("utf-8").replace(/\0.*$/, "");
    const size = parseInt(buf.slice(off + 124, off + 136).toString("utf-8").trim(), 8) || 0;
    if (!name) break;
    if (name.endsWith(".mp3")) return buf.slice(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

export async function generateTTS({ text, voiceId, model = "speech-2.8-hd", outputPath }) {
  const apiKey = getApiKey("minimax", "MINIMAX_API_KEY");
  if (!apiKey) throw new Error("未配置 MINIMAX_API_KEY");

  const baseURL = getBaseUrl("minimax", "MINIMAX_BASE_URL", "https://api.minimaxi.com/v1");

  const createRes = await fetch(`${baseURL}/t2a_async_v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model,
      text,
      voice_setting: { voice_id: voiceId, speed: 1, vol: 1, pitch: 1 },
      audio_setting: { audio_sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 2 },
    }),
  });
  const createResult = await createRes.json();
  if (createResult.base_resp?.status_code !== 0) {
    throw new Error(`TTS 任务创建失败: ${createResult.base_resp?.status_msg}`);
  }
  const taskId = createResult.task_id;

  for (let i = 0; i < 300; i++) {
    await sleep(2000);
    const pollRes = await fetch(`${baseURL}/query/t2a_async_query_v2?task_id=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30000),
    });
    const pollResult = await pollRes.json();
    const status = (pollResult.status || "").toLowerCase();
    if (i % 15 === 0) console.log(`[tts] 轮询 ${i + 1}/300 status=${status}`);

    if (status === "success") {
      const fileRes = await fetch(`${baseURL}/files/retrieve?file_id=${pollResult.file_id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30000),
      });
      const fileResult = await fileRes.json();
      const downloadUrl = fileResult.file?.download_url;
      if (!downloadUrl) throw new Error("TTS 下载链接获取失败");
      const audioRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(120000) });
      let buffer = Buffer.from(await audioRes.arrayBuffer());
      if (!(buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33)) {
        const mp3 = extractMp3FromTar(buffer);
        if (mp3 && mp3.length > 0) buffer = mp3;
      }
      if (buffer.length < 3 || buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) {
        throw new Error(`TTS 下载文件头无效 (前 3 字节: ${buffer.slice(0, 3).toString("hex")}，期望 ID3 头)`);
      }
      fs.writeFileSync(outputPath, buffer);
      return { path: outputPath };
    }
    if (status === "failed") throw new Error("TTS 任务失败");
    if (status === "expired") throw new Error("TTS 任务已过期");
  }
  throw new Error("TTS 任务超时");
}
