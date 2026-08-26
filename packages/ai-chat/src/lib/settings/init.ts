import { env } from "@/lib/utils/env";
import { readProviders, writeProviders, readSelection, writeSelection } from "./store";
import type { Providers, Selection } from "./types";

const DEFAULT_PROVIDERS: Providers = {
  deepseek: {
    enabled: true,
    baseURL: env.DEEPSEEK_BASE_URL,
    apiKey: env.DEEPSEEK_API_KEY,
    models: { chat: "deepseek-v4-pro" },
  },
  minimax: {
    enabled: true,
    baseURL: env.MINIMAX_BASE_URL,
    apiKey: env.MINIMAX_API_KEY,
    models: { chat: "MiniMax-M3", text: "MiniMax-M3", image: "image-01", tts: "speech-2.8-hd" },
  },
  glm: {
    enabled: true,
    baseURL: env.GLM_BASE_URL,
    apiKey: env.GLM_API_KEY,
    models: { chat: "glm-5.2", embedding: "embedding-3" },
  },
  qwen: {
    enabled: true,
    baseURL: env.QWEN_BASE_URL,
    apiKey: env.QWEN_API_KEY,
    models: { chat: "qwen3.8-max", image: "qwen-image-3.0-pro", music: "fun-music-v1" },
  },
};

const DEFAULT_SELECTION: Selection = {
  chat: { provider: "minimax", model: "MiniMax-M3" },
  media: { provider: "minimax", model: "image-01" },
  vector: { provider: "glm", model: "embedding-3" },
  workflow: { provider: "deepseek", model: "deepseek-v4-pro", flashModel: "deepseek-v4-flash" },
  preprocess: { provider: "minimax", model: "MiniMax-M3" },
  tts: { provider: "minimax", model: "speech-2.8-hd" },
  music: { provider: "qwen", model: "fun-music-v1" },
  vision: { provider: "minimax", model: "MiniMax-M3" },
};

export function initSettings() {
  const existing = readProviders();
  if (Object.keys(existing).length === 0) {
    writeProviders(DEFAULT_PROVIDERS);
  } else {
    // ponytail: 迁移 — 补写缺失的默认 provider（如 qwen）
    let merged = false;
    for (const [key, cfg] of Object.entries(DEFAULT_PROVIDERS)) {
      if (!existing[key]) {
        existing[key] = cfg;
        merged = true;
      }
    }
    if (merged) writeProviders(existing);
  }
  const sel = readSelection();
  if (!sel.chat) {
    writeSelection({ ...DEFAULT_SELECTION, ...sel });
  }
  // ponytail: 旧 selection 缺 tts/music/preprocess, 补默认值
  if (sel.chat) {
    if (!sel.tts) sel.tts = { provider: "minimax", model: "speech-2.8-hd" };
    if (!sel.music) sel.music = { provider: "qwen", model: "fun-music-v1" };
    delete (sel as Record<string, unknown>).bgm;
    if (!sel.preprocess) sel.preprocess = { provider: "minimax", model: "MiniMax-M3" };
    if (!sel.vision) sel.vision = { provider: "minimax", model: "MiniMax-M3" };
    if (!sel.workflow) sel.workflow = DEFAULT_SELECTION.workflow;
    writeSelection(sel);
  }
  // ponytail: 旧默认 model 升级 (v0.8.1 glm-5 → v0.8.2 glm-5.2)
  let upgraded = false;
  for (const key of ["chat", "workflow", "media"] as const) {
    if (sel[key]?.model === "glm-5") {
      sel[key] = { ...sel[key], model: "glm-5.2" };
      upgraded = true;
    }
  }
  if (upgraded) writeSelection(sel);
}