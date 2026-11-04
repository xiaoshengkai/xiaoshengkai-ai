import { callLLM as callDeepSeek } from "./providers/deepseek.js";
import {
  callLLM as callMiniMax,
  generateImage as generateMiniMaxImage,
  generateTTS as generateMiniMaxTTS,
} from "./providers/minimax.js";
import { callLLM as callGLM } from "./providers/glm.js";
import { callLLM as callQwen, generateImage as generateQwenImage, generateBGM as generateQwenBGM, generateMusic as generateQwenMusic } from "./providers/qwen.js";
import { generateImage as generateVolcImage } from "./providers/volcengine.js";
import { readSelection, assertProviderEnabled } from "./config.js";
import { withTimeout } from "../utils.js";

// 工作流文字生成 selection（每次 fresh-read，切 provider/model 无需重启）
function readWorkflowSelection() {
  try {
    const sel = readSelection();
    if (sel.workflow?.provider) return sel.workflow;
  } catch { /* ignore */ }
  return { provider: process.env.LLM_PROVIDER || "deepseek", model: "" };
}

export function getWorkflowProvider() {
  return readWorkflowSelection().provider;
}

const CALLERS = {
  minimax: callMiniMax,
  deepseek: callDeepSeek,
  glm: callGLM,
  qwen: callQwen,
};

export async function callLLM(params) {
  const { provider, model } = readWorkflowSelection();
  const caller = CALLERS[provider];
  if (!caller) throw new Error(`Unsupported workflow provider: ${provider}`);
  assertProviderEnabled(provider);
  try {
    return await withTimeout(caller({ ...params, model: params.model || model }), 420000, `${provider} 文本生成`);
  } catch (e) {
    logFetchCause(provider, e);
    throw e;
  }
}

// "fetch failed" 是 undici 的笼统包装，真因在 cause 链（ECONNRESET / 网关重置 / TLS）——打出来再抛
function logFetchCause(provider, e) {
  if (!/fetch failed|terminated|socket/i.test(e?.message || "")) return;
  const cause = e.cause;
  const parts = [
    `provider=${provider}`,
    cause?.code ? `code=${cause.code}` : "",
    cause?.errno ? `errno=${cause.errno}` : "",
    cause?.message ? `cause=${cause.message}` : "",
  ].filter(Boolean).join(" ");
  console.error(`[llm] 网络层失败: ${parts || "(cause 为空)"} | url-host=${cause?.host || ""}`);
}

// ─── 多模态模型（视觉评估：selection.vision）───────────────────────────

export function getMultimodalProvider() {
  return readModuleSelection("vision", { provider: "minimax", model: "MiniMax-M3" });
}

export async function callMultimodalLLM(params) {
  const { provider, model } = getMultimodalProvider();
  try {
    return await CALLERS[provider]({ ...params, model: params.model || model });
  } catch (e) {
    logFetchCause(provider, e);
    throw e;
  }
}

// ─── 模块选择读取器（media/tts/bgm）────────────────────────────────────

function readModuleSelection(module, fallback) {
  try {
    const sel = readSelection();
    if (sel[module]?.provider) return sel[module];
  } catch { /* ignore */ }
  return fallback;
}

// ─── 图片生成分发器（selection.media）──────────────────────────────────

const IMAGE_GENERATORS = {
  minimax: generateMiniMaxImage,
  qwen: generateQwenImage,
  volcengine: generateVolcImage,
};

export async function generateImage(prompt, opts = {}) {
  const { provider, model } = readModuleSelection("media", { provider: "minimax", model: "image-01" });
  const gen = IMAGE_GENERATORS[provider];
  if (!gen) throw new Error(`不支持的图片 provider: ${provider}`);
  assertProviderEnabled(provider);
  const actualModel = opts.model || model;
  console.log(`[image] 图片生成: provider=${provider}, model=${actualModel}, n=${opts.n || 1}`);
  return gen(prompt, { ...opts, model: actualModel });
}

// ─── TTS / 音乐分发器（selection.tts / selection.music）─────────────────

const TTS_PROVIDERS = { minimax: generateMiniMaxTTS };

export async function generateTTS(params) {
  const { provider, model } = readModuleSelection("tts", { provider: "minimax", model: "speech-2.8-hd" });
  const gen = TTS_PROVIDERS[provider];
  if (!gen) throw new Error(`不支持的 TTS provider: ${provider}`);
  assertProviderEnabled(provider);
  const actualModel = params.model || model;
  console.log(`[tts] provider=${provider}, model=${actualModel}`);
  return gen({ ...params, model: actualModel });
}

// 纯背景音乐（工作流用，落盘）
const BGM_PROVIDERS = { qwen: generateQwenBGM };

export async function generateBGM(params) {
  const { provider, model } = readModuleSelection("music", { provider: "qwen", model: "fun-music-v1" });
  const gen = BGM_PROVIDERS[provider];
  if (!gen) throw new Error(`不支持的 BGM provider: ${provider}`);
  assertProviderEnabled(provider);
  const actualModel = params.model || model;
  console.log(`[music] provider=${provider}, model=${actualModel}`);
  return gen({ ...params, model: actualModel });
}

// 整首歌（含人声/歌词，MCP 工具用，返回 URL）
const MUSIC_PROVIDERS = { qwen: generateQwenMusic };

export async function generateMusic(params) {
  const { provider, model } = readModuleSelection("music", { provider: "qwen", model: "fun-music-v1" });
  const gen = MUSIC_PROVIDERS[provider];
  if (!gen) throw new Error(`不支持的整首歌 provider: ${provider}（仅 qwen/fun-music-v1）`);
  assertProviderEnabled(provider);
  const actualModel = params.model || model;
  console.log(`[music] provider=${provider}, model=${actualModel}`);
  return gen({ ...params, model: actualModel });
}
