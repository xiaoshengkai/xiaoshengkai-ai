import axios from "axios";
import { config } from "../config.js";

const GLOBAL_KLINE_URL =
  "https://stock2.finance.sina.com.cn/futures/api/json_v2.php/GlobalFuturesService.getGlobalFuturesDailyKLine";
const STOCK_KLINE_URL =
  "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      return response.data;
    } catch (err) {
      if (i < retries) {
        console.log(`[KLINE] 请求失败，${config.retryDelayMs / 1000}s 后重试 (${i + 1}/${retries})...`);
        await sleep(config.retryDelayMs);
      } else {
        throw err;
      }
    }
  }
}

function compute10Year(data, highKey, lowKey) {
  if (!data || data.length === 0) return { high: null, low: null };

  const recent = data.slice(-2600);
  let high = -Infinity;
  let low = Infinity;

  for (const row of recent) {
    const h = parseFloat(row[highKey]);
    const l = parseFloat(row[lowKey]);
    if (!isNaN(h) && h > high) high = h;
    if (!isNaN(l) && l < low) low = l;
  }

  return {
    high: high === -Infinity ? null : high,
    low: low === Infinity ? null : low,
  };
}

async function fetchGlobalKline(symbol) {
  try {
    const data = await fetchJson(`${GLOBAL_KLINE_URL}?symbol=${symbol}`, 1);
    return compute10Year(data, "high", "low");
  } catch (err) {
    console.log(`[KLINE] ${symbol} 全球期货K线获取失败: ${err.message}`);
    return { high: null, low: null };
  }
}

async function fetchStockKline(symbol) {
  try {
    const data = await fetchJson(`${STOCK_KLINE_URL}?symbol=${symbol}&scale=240&ma=no&datalen=2600`, 1);
    return compute10Year(data, "high", "low");
  } catch (err) {
    console.log(`[KLINE] ${symbol} A股K线获取失败: ${err.message}`);
    return { high: null, low: null };
  }
}

export async function fetchAll10Year() {
  console.log("[KLINE] 正在计算过去10年高低点...");

  const results = {};

  for (const cat of config.categories) {
    for (const item of cat.items) {
      const key = `${cat.key}::${item.sinaSymbol}`;

      if (item.klineType === "global") {
        const r = await fetchGlobalKline(item.klineSymbol);
        results[key] = r;
      } else if (item.klineType === "stock") {
        const r = await fetchStockKline(item.klineSymbol);
        results[key] = r;
      } else if (item.klineType === "hk") {
        results[key] = { high: null, low: null };
      } else {
        results[key] = { high: null, low: null };
      }
    }
  }

  const count = Object.values(results).filter(r => r.high != null || r.low != null).length;
  console.log(`[KLINE] 过去10年高低点完成 ${count}/${Object.keys(results).length} 个品种`);
  return results;
}