import axios from "axios";
import { config } from "../config.js";
import { fetchPrices } from "./sina.js";
import { fetchAll10Year } from "./kline.js";
import { fetchMacroIndicators } from "./macro.js";

const FOREX_URL = "https://open.er-api.com/v6/latest/USD";

async function fetchForex() {
  try {
    const res = await axios.get(FOREX_URL, { timeout: 10000 });
    if (res.data && res.data.rates && res.data.rates.CNY) {
      return res.data.rates.CNY;
    }
  } catch (err) {
    console.log("[FOREX] 主汇率源失败:", err.message);
  }
  return null;
}

export async function fetchAllPrices() {
  const [categories, usdCny, year10, macroIndicators] = await Promise.all([
    fetchPrices(),
    fetchForex(),
    fetchAll10Year(),
    fetchMacroIndicators(),
  ]);

  const { ozToGram } = config;

  for (const cat of categories) {
    for (const item of cat.items) {
      const kKey = `${cat.key}::${item.sinaSymbol}`;
      const r = year10[kKey] || { high: null, low: null };

      item.high52 = item.high52 != null ? item.high52 : r.high;
      item.low52 = item.low52 != null ? item.low52 : r.low;

      if (item.cnyUnit && item.price != null && usdCny != null) {
        item.priceCny = (item.price / ozToGram) * usdCny;
        if (item.high52 != null) item.highCny = (item.high52 / ozToGram) * usdCny;
        if (item.low52 != null) item.lowCny = (item.low52 / ozToGram) * usdCny;
      } else {
        item.priceCny = null;
        item.highCny = null;
        item.lowCny = null;
      }
    }
  }

  console.log(`[FETCH] 数据汇总完成，汇率: ${usdCny != null ? usdCny.toFixed(4) : "获取失败"}`);

  return { categories, usdCny, macroIndicators, timestamp: new Date() };
}