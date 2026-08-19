import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// providers.json / selection.json 统一读取器
// 原则：providers.json 为真源，env 只作为默认值兜底
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_DIR = path.resolve(__dirname, "..", "..", "..", "data", "settings");
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

export function getBaseUrl(provider, envKey, fallback = "") {
  const cfg = readProviders()[provider];
  if (cfg?.baseURL) return cfg.baseURL;
  return process.env[envKey] || fallback;
}
