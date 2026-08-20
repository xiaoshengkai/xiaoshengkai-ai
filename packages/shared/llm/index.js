import { callLLM as callDeepSeek } from "./providers/deepseek.js";
import {
  callLLM as callMiniMax,
  generateImage as generateMiniMaxImage,
  generateTTS as generateMiniMaxTTS,
  generateBGM as generateMiniMaxBGM,
} from "./providers/minimax.js";
import { callLLM as callGLM } from "./providers/glm.js";
import { callLLM as callQwen, generateImage as generateQwenImage } from "./providers/qwen.js";
import { readSelection, assertProviderEnabled } from "./config.js";

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
  return caller({ ...params, model: params.model || model });
}

// ─── 多态模型（多模态：文本+图片+视频）──────────────────────────────────

const MULTIMODAL_MODELS = { minimax: "MiniMax-M3", qwen: "qwen3.8-max" };

export function getMultimodalProvider() {
  const provider = getWorkflowProvider();
  if (MULTIMODAL_MODELS[provider]) return { provider, model: MULTIMODAL_MODELS[provider] };
  return { provider: "minimax", model: "MiniMax-M3" };
}

export async function callMultimodalLLM(params) {
  const { provider, model } = getMultimodalProvider();
  return CALLERS[provider]({ ...params, model: params.model || model });
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

// ─── TTS / BGM 分发器（selection.tts / selection.bgm）──────────────────

const TTS_PROVIDERS = { minimax: generateMiniMaxTTS };
const BGM_PROVIDERS = { minimax: generateMiniMaxBGM };

export async function generateTTS(params) {
  const { provider, model } = readModuleSelection("tts", { provider: "minimax", model: "speech-2.8-hd" });
  const gen = TTS_PROVIDERS[provider];
  if (!gen) throw new Error(`不支持的 TTS provider: ${provider}`);
  assertProviderEnabled(provider);
  const actualModel = params.model || model;
  console.log(`[tts] provider=${provider}, model=${actualModel}`);
  return gen({ ...params, model: actualModel });
}

export async function generateBGM(params) {
  const { provider, model } = readModuleSelection("bgm", { provider: "minimax", model: "music-2.6" });
  const gen = BGM_PROVIDERS[provider];
  if (!gen) throw new Error(`不支持的 BGM provider: ${provider}`);
  assertProviderEnabled(provider);
  const actualModel = params.model || model;
  console.log(`[bgm] provider=${provider}, model=${actualModel}`);
  return gen({ ...params, model: actualModel });
}
