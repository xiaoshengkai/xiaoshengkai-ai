import fs from "node:fs";
import path from "node:path";
import type { Providers, Selection, EgressConfig, SearchSettings } from "./types";

const DATA_DIR = path.resolve(process.cwd(), "..", "..", "data");
const SETTINGS_DIR = path.join(DATA_DIR, "settings");
const PROVIDERS_FILE = path.join(SETTINGS_DIR, "providers.json");
const SELECTION_FILE = path.join(SETTINGS_DIR, "selection.json");
const EGRESS_FILE = path.join(SETTINGS_DIR, "egress.json");
const SEARCH_FILE = path.join(SETTINGS_DIR, "search.json");

export const DEFAULT_EGRESS: EgressConfig = {
  enabled: false,
  proxy: "127.0.0.1:11080",
  whitelist: [],
};

export const DEFAULT_SEARCH: SearchSettings = {
  provider: "auto",
};

function ensureDir() {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

export function readProviders(): Providers {
  ensureDir();
  if (!fs.existsSync(PROVIDERS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PROVIDERS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function writeProviders(data: Providers) {
  ensureDir();
  fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(data, null, 2));
}

export function readSelection(): Selection {
  ensureDir();
  if (!fs.existsSync(SELECTION_FILE)) return {} as Selection;
  try {
    return JSON.parse(fs.readFileSync(SELECTION_FILE, "utf-8"));
  } catch {
    return {} as Selection;
  }
}

export function writeSelection(data: Selection) {
  ensureDir();
  fs.writeFileSync(SELECTION_FILE, JSON.stringify(data, null, 2));
}

export function readEgress(): EgressConfig {
  ensureDir();
  if (!fs.existsSync(EGRESS_FILE)) return { ...DEFAULT_EGRESS };
  try {
    return { ...DEFAULT_EGRESS, ...JSON.parse(fs.readFileSync(EGRESS_FILE, "utf-8")) };
  } catch {
    return { ...DEFAULT_EGRESS };
  }
}

export function writeEgress(data: EgressConfig) {
  ensureDir();
  fs.writeFileSync(EGRESS_FILE, JSON.stringify(data, null, 2));
}

export function readSearchSettings(): SearchSettings {
  ensureDir();
  if (!fs.existsSync(SEARCH_FILE)) return { ...DEFAULT_SEARCH };
  try {
    return { ...DEFAULT_SEARCH, ...JSON.parse(fs.readFileSync(SEARCH_FILE, "utf-8")) };
  } catch {
    return { ...DEFAULT_SEARCH };
  }
}

export function writeSearchSettings(data: SearchSettings) {
  ensureDir();
  fs.writeFileSync(SEARCH_FILE, JSON.stringify(data, null, 2));
}