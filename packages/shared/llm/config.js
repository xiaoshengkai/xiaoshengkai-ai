import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// providers.json / selection.json 统一读取器
// 原则：providers.json 为真源，env 只作为默认值兜底
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ponytail: LLM_SETTINGS_DIR 测试缝隙，生产不设置，默认用仓库 data/settings
const SETTINGS_DIR = process.env.LLM_SETTINGS_DIR
  || path.resolve(__dirname, "..", "..", "..", "data", "settings");
const PROVIDERS_PATH = path.join(SETTINGS_DIR, "providers.json");
const SELECTION_PATH = path.join(SETTINGS_DIR, "selection.json");

export function readProviders() {
  try {
    return JSON.parse(fs.readFileSync(PROVIDERS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function readSelection() {
  try {
    return JSON.parse(fs.readFileSync(SELECTION_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function getApiKey(provider, envKey) {
  const cfg = readProviders()[provider];
  if (cfg?.apiKey) return cfg.apiKey;
  return process.env[envKey] || "";
}

export function getAccessKey(provider, envKey) {
  const cfg = readProviders()[provider];
  if (cfg?.accessKey) return cfg.accessKey;
  return process.env[envKey] || "";
}

export function getSecretKey(provider, envKey) {
  const cfg = readProviders()[provider];
  if (cfg?.secretKey) return cfg.secretKey;
  return process.env[envKey] || "";
}

export function getBaseUrl(provider, envKey, fallback = "") {
  const cfg = readProviders()[provider];
  if (cfg?.baseURL) return cfg.baseURL;
  return process.env[envKey] || fallback;
}

// 读取 provider 默认模型（providers.json models.<kind> > env > fallback）
export function getProviderModel(provider, kind, envKey, fallback = "") {
  const cfg = readProviders()[provider];
  if (cfg?.models?.[kind]) return cfg.models[kind];
  if (envKey && process.env[envKey]) return process.env[envKey];
  return fallback;
}

// 禁用 provider 拒绝调用（fresh-read，保存即生效）
export function assertProviderEnabled(provider) {
  const cfg = readProviders()[provider];
  if (cfg && cfg.enabled === false) {
    throw new Error(`Provider "${provider}" is disabled`);
  }
}
