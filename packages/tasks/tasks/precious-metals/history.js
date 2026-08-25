import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "..", "..", "..", "data", "precious-metals");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const MACRO_FILE = path.join(DATA_DIR, "macro.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadJson(file) {
  ensureDir();
  if (!fs.existsSync(file)) {
    return { records: [] };
  }
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw);
    return data.records ? data : { records: [] };
  } catch {
    return { records: [] };
  }
}

export function saveHistory(data) {
  ensureDir();
  const history = loadJson(HISTORY_FILE);

  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const record = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    categories: {},
    usdCny: data.usdCny != null ? +data.usdCny.toFixed(4) : null,
  };

  for (const cat of data.categories) {
    record.categories[cat.key] = cat.items.map(item => ({
      name: item.name,
      price: item.price != null ? +item.price.toFixed(2) : null,
      priceCny: item.priceCny != null ? +item.priceCny.toFixed(2) : null,
      change: item.change != null ? +item.change.toFixed(2) : null,
      high52: item.high52 != null ? +item.high52.toFixed(2) : null,
      low52: item.low52 != null ? +item.low52.toFixed(2) : null,
    }));
  }

  history.records.push(record);

  if (history.records.length > 365) {
    history.records = history.records.slice(-365);
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
  console.log(`[HISTORY] 市场行情已保存 (共 ${history.records.length} 条记录)`);
}

export function saveMacroHistory(macroIndicators, usdCny) {
  ensureDir();
  const macroHistory = loadJson(MACRO_FILE);

  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const record = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    usdCny: usdCny != null ? +usdCny.toFixed(4) : null,
    indicators: macroIndicators.map(ind => ({
      key: ind.key,
      name: ind.name,
      value: ind.value,
      date: ind.date,
      prevValue: ind.prevValue,
      history: ind.history,
    })),
  };

  macroHistory.records.push(record);

  if (macroHistory.records.length > 365) {
    macroHistory.records = macroHistory.records.slice(-365);
  }

  fs.writeFileSync(MACRO_FILE, JSON.stringify(macroHistory, null, 2), "utf-8");
  console.log(`[HISTORY] 宏观数据已保存 (共 ${macroHistory.records.length} 条记录)`);
}

export function loadHistory() {
  return loadJson(HISTORY_FILE);
}

export function loadMacroHistory() {
  return loadJson(MACRO_FILE);
}