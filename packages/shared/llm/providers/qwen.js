import fs from "node:fs";
import { getApiKey, getBaseUrl, getProviderModel } from "../config.js";

export async function callLLM({ system, user, model, temperature = 0.7, maxTokens = 8000, format = 'json_object', images = [] }) {
  const apiKey = getApiKey("qwen", "QWEN_API_KEY");
  if (!apiKey) throw new Error("未配置 QWEN_API_KEY");

  const baseURL = getBaseUrl("qwen", "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1");
  const actualModel = model || getProviderModel("qwen", "chat", "QWEN_CHAT_MODEL", "qwen3.8-max");
  console.log(`[qwen] 当前调用: model=${actualModel} baseURL=${baseURL}`);

  const userContent = images.length > 0
    ? [{ type: "text", text: user }, ...images.map(d => ({ type: "image_url", image_url: { url: d } }))]
    : user;

  const body = {
    model: actualModel,
    enable_thinking: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (format) body.response_format = { type: format };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  let res;
  let data;
  try {
    res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    data = await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Qwen 调用超时（180s）");
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    console.log(`[qwen] callLLM: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    throw new Error(`Qwen API 错误 (${res.status}): ${data.error?.message || "未知错误"}`);
  }
  console.log(`[qwen] usage: ${JSON.stringify(data.usage)}`);
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: {
      totalTokens: data.usage?.totalTokens || data.usage?.total_tokens || 0,
      completionTokens: data.usage?.completionTokens || data.usage?.completion_tokens || 0,
    },
  };
}

// ─── 图片生成（Qwen-Image，DashScope 原生接口，同步）───────────────────────

// 比例 → qwen size（宽*高），qwen-image-3.0 支持 512²~2048²、比例 1:8~8:1
// ponytail: 1K 档（短边 ≤1024、≤1MP），对齐 MiniMax image-01 预设，控制成本 ¥0.25/张
const ASPECT_TO_SIZE = {
  "1:1": "1024*1024",
  "16:9": "1280*720",
  "9:16": "720*1280",
  "4:3": "1152*864",
  "3:4": "864*1152",
  "3:2": "1248*832",
  "2:3": "832*1248",
  "21:9": "1344*576",
};

export async function generateImage(prompt, { aspectRatio = "1:1", model = "qwen-image-3.0-pro", image_url, n = 1, watermark = false, negativePrompt, seed } = {}) {
  if (n > 6) throw new Error("qwen-image 单次最多 6 张，请减小 n");
  const apiKey = getApiKey("qwen", "QWEN_API_KEY");
  if (!apiKey) throw new Error("未配置 QWEN_API_KEY");

  // 图片原生接口 host 跟 chat 的 compatible-mode 是同一个 host（workspace 域名随 baseURL 走）
  const baseURL = getBaseUrl("qwen", "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1");
  const imageUrl = `${baseURL.replace(/\/compatible-mode\/v1\/?$/, "")}/api/v1/services/aigc/multimodal-generation/generation`;

  const content = image_url
    ? [{ image: Array.isArray(image_url) ? image_url[0] : image_url }, { text: prompt }]
    : [{ text: prompt }];

  const parameters = {
    prompt_extend: false,
    enable_thinking: false,
    watermark,
    size: ASPECT_TO_SIZE[aspectRatio] || "1024*1024",
    n,
  };
  if (negativePrompt) parameters.negative_prompt = negativePrompt;
  if (seed != null) parameters.seed = seed;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(imageUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: { messages: [{ role: "user", content }] },
        parameters,
      }),
    });
    const data = await res.json();
    const images = data.output?.choices?.[0]?.message?.content?.map(c => c.image).filter(Boolean) || [];
    if (!res.ok || images.length === 0) {
      throw new Error(data.message || data.code || `Qwen 图片生成失败 (${res.status})`);
    }
    return images;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("图片生成超时（120s）");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── 音乐生成（Fun-Music，DashScope 原生接口，同步）───────────────────────

async function callMusicApi({ model, prompt, lyrics, gender, isInstrumental }) {
  const apiKey = getApiKey("qwen", "QWEN_API_KEY");
  if (!apiKey) throw new Error("未配置 QWEN_API_KEY");
  const baseURL = getBaseUrl("qwen", "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1");
  const url = `${baseURL.replace(/\/compatible-mode\/v1\/?$/, "")}/api/v1/services/audio/music/generation`;

  const input = {};
  if (isInstrumental) {
    input.is_instrumental = true;
    if (prompt) input.prompt = prompt;
  } else {
    if (lyrics) input.lyrics = lyrics;
    if (prompt) input.prompt = prompt;
    if (gender) input.gender = gender;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input }),
    });
    const data = await res.json();
    const audioUrl = data.output?.audio?.url;
    if (!audioUrl) throw new Error(data.message || data.code || `Qwen 音乐生成失败 (${res.status})`);
    return audioUrl;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("音乐生成超时（180s）");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// 纯背景音乐（工作流用）：下载落盘
export async function generateBGM({ prompt, model = "fun-music-v1", outputPath }) {
  const audioUrl = await callMusicApi({ model, prompt: prompt || "轻快电子", isInstrumental: true });
  const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(120000) });
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  return { path: outputPath };
}

// 整首歌（MCP 工具用）：返回音频 URL（24h 有效）
export async function generateMusic({ prompt, lyrics, gender, isInstrumental = false, model = "fun-music-v1" }) {
  const audioUrl = await callMusicApi({ model, prompt, lyrics, gender, isInstrumental });
  return { url: audioUrl };
}
