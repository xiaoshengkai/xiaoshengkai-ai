import axios from "axios";
import { config } from "../config.js";
import { sleep } from "../../shared/utils.js";

const SINA_URL = "https://hq.sinajs.cn";

async function fetchWithRetry(url, options = {}, retries = config.retryCount) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        ...options,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ...(options.headers || {}),
        },
      });
      return response.data;
    } catch (err) {
      if (i < retries) {
        console.log(
          `[SINA] 请求失败，${config.retryDelayMs / 1000}s 后重试 (${i + 1}/${retries})...`
        );
        await sleep(config.retryDelayMs);
      } else {
        throw err;
      }
    }
  }
}

async function fetchRaw() {
  const allItems = [];
  for (const cat of config.categories) {
    for (const item of cat.items) {
      allItems.push({ ...item, categoryKey: cat.key });
    }
  }

  const hfItems = allItems.filter(i => i.sinaType === "hf");
  const sItems = allItems.filter(i => i.sinaType === "s");
  const rtItems = allItems.filter(i => i.sinaType === "rt");

  const results = {};

  if (hfItems.length > 0) {
    const symbols = hfItems.map(i => `hf_${i.sinaSymbol}`).join(",");
    const raw = await fetchWithRetry(`${SINA_URL}/list=${symbols}`, {
      responseType: "arraybuffer",
      headers: { Referer: "https://finance.sina.com.cn" },
    });
    const text = new TextDecoder("GBK").decode(raw);
    for (const line of text.trim().split("\n")) {
      const parsed = parseHfLine(line);
      if (parsed) results[parsed.symbol] = parsed;
    }
  }

  if (sItems.length > 0) {
    const symbols = sItems.map(i => `s_${i.sinaSymbol}`).join(",");
    const raw = await fetchWithRetry(`${SINA_URL}/list=${symbols}`, {
      responseType: "arraybuffer",
      headers: { Referer: "https://finance.sina.com.cn" },
    });
    const text = new TextDecoder("GBK").decode(raw);
    for (const line of text.trim().split("\n")) {
      const parsed = parseSLine(line);
      if (parsed) results[parsed.symbol] = parsed;
    }
  }

  if (rtItems.length > 0) {
    for (const item of rtItems) {
      const raw = await fetchWithRetry(`${SINA_URL}/list=rt_${item.sinaSymbol}`, {
        responseType: "arraybuffer",
        headers: { Referer: "https://finance.sina.com.cn" },
      });
      const text = new TextDecoder("GBK").decode(raw);
      const parsed = parseRtLine(text, item.sinaSymbol);
      if (parsed) results[item.sinaSymbol] = parsed;
    }
  }

  return results;
}

function parseHfLine(line) {
  const match = line.match(/var hq_str_hf_(\w+)="(.+)"/);
  if (!match) return null;
  const parts = match[2].split(",");
  const price = parseFloat(parts[0]);
  const prevClose = parseFloat(parts[7]) || null;
  if (isNaN(price)) return null;
  return { symbol: match[1], price, prevClose: isNaN(prevClose) ? null : prevClose };
}

function parseSLine(line) {
  const match = line.match(/var hq_str_s_(\w+)="(.+)"/);
  if (!match) return null;
  const parts = match[2].split(",");
  const price = parseFloat(parts[1]);
  const change = parseFloat(parts[2]) || null;
  if (isNaN(price)) return null;
  return {
    symbol: match[1],
    price,
    change,
    prevClose: change != null ? price - change : null,
  };
}

function parseRtLine(text, symbol) {
  const match = text.match(/="(.+)"/);
  if (!match) return null;
  const parts = match[1].split(",");
  const price = parseFloat(parts[2]);
  const prevClose = parseFloat(parts[6]) || null;
  const high52 = parseFloat(parts[15]) || null;
  const low52 = parseFloat(parts[16]) || null;
  if (isNaN(price)) return null;
  return {
    symbol,
    price,
    prevClose: isNaN(prevClose) ? null : prevClose,
    high52: isNaN(high52) ? null : high52,
    low52: isNaN(low52) ? null : low52,
  };
}

export async function fetchPrices() {
  console.log("[SINA] 正在拉取实时行情...");
  const rawData = await fetchRaw();

  const categories = config.categories.map(cat => ({
    key: cat.key,
    label: cat.label,
    items: cat.items.map(item => {
      const raw = rawData[item.sinaSymbol];
      if (!raw) {
        return { ...item, price: null, prevClose: null, change: null, error: true };
      }

      let change = null;
      if (raw.prevClose != null && raw.prevClose !== 0) {
        change = ((raw.price - raw.prevClose) / raw.prevClose) * 100;
      }

      return {
        ...item,
        price: raw.price,
        prevClose: raw.prevClose,
        change,
        high52: raw.high52 || null,
        low52: raw.low52 || null,
        error: false,
      };
    }),
  }));

  const total = categories.reduce((s, c) => s + c.items.length, 0);
  const ok = categories.reduce((s, c) => s + c.items.filter(i => !i.error).length, 0);
  console.log(`[SINA] 实时行情完成 ${ok}/${total} 个品种`);

  return categories;
}