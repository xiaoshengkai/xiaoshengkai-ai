import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

export const config = {
  pushPlusToken: process.env.PUSHPLUS_TOKEN,
  pushPlusTopic: process.env.PUSHPLUS_TOPIC || "",
  pushPlusTo: process.env.PUSHPLUS_TO || "",
  timezone: "Asia/Shanghai",
  retryCount: 2,
  retryDelayMs: 3000,
  ozToGram: 31.1034768,

  categories: [
    {
      key: "metals",
      label: "贵金属",
      items: [
        { sinaSymbol: "XAU", name: "黄金", emoji: "🟡", unit: "$/oz", cnyUnit: "¥/g", klineSymbol: "XAU", klineType: "global", sinaType: "hf" },
        { sinaSymbol: "XAG", name: "白银", emoji: "⚪", unit: "$/oz", cnyUnit: "¥/g", klineSymbol: "XAG", klineType: "global", sinaType: "hf" },
        { sinaSymbol: "XPT", name: "铂金", emoji: "🔵", unit: "$/oz", cnyUnit: "¥/g", klineSymbol: "XPT", klineType: "global", sinaType: "hf" },
        { sinaSymbol: "XPD", name: "钯金", emoji: "🟤", unit: "$/oz", cnyUnit: "¥/g", klineSymbol: "XPD", klineType: "global", sinaType: "hf" },
      ],
    },
    {
      key: "energy",
      label: "能源",
      items: [
        { sinaSymbol: "CL", name: "WTI原油", emoji: "🛢️", unit: "$/桶", klineSymbol: "CL", klineType: "global", sinaType: "hf" },
        { sinaSymbol: "OIL", name: "布伦特", emoji: "⛽", unit: "$/桶", klineSymbol: "OIL", klineType: "global", sinaType: "hf" },
        { sinaSymbol: "NG", name: "天然气", emoji: "🔥", unit: "$/MMBtu", klineSymbol: "NG", klineType: "global", sinaType: "hf" },
      ],
    },
    {
      key: "agriculture",
      label: "农产品",
      items: [
        { sinaSymbol: "S", name: "大豆", emoji: "🫘", unit: "美分/蒲式耳", klineSymbol: "S", klineType: "global", sinaType: "hf" },
        { sinaSymbol: "C", name: "玉米", emoji: "🌽", unit: "美分/蒲式耳", klineSymbol: "C", klineType: "global", sinaType: "hf" },
        { sinaSymbol: "W", name: "小麦", emoji: "🌾", unit: "美分/蒲式耳", klineSymbol: "W", klineType: "global", sinaType: "hf" },
      ],
    },
    {
      key: "commodities",
      label: "工业金属",
      items: [
        { sinaSymbol: "HG", name: "美铜", emoji: "🔶", unit: "美分/磅", klineSymbol: "HG", klineType: "global", sinaType: "hf" },
        { sinaSymbol: "AHD", name: "伦铝", emoji: "⬜", unit: "$/吨", klineSymbol: "AHD", klineType: "global", sinaType: "hf" },
      ],
    },
    {
      key: "stocks",
      label: "股市",
      items: [
        { sinaSymbol: "sh000001", name: "上证指数", emoji: "📈", unit: "", klineSymbol: "sh000001", klineType: "stock", sinaType: "s" },
        { sinaSymbol: "sz399001", name: "深证成指", emoji: "📉", unit: "", klineSymbol: "sz399001", klineType: "stock", sinaType: "s" },
        { sinaSymbol: "sz399006", name: "创业板指", emoji: "📊", unit: "", klineSymbol: "sz399006", klineType: "stock", sinaType: "s" },
        { sinaSymbol: "hkHSI", name: "恒生指数", emoji: "🏦", unit: "", klineSymbol: "hkHSI", klineType: "hk", sinaType: "rt" },
      ],
    },
    {
      key: "realestate",
      label: "地产",
      items: [
        { sinaSymbol: "sh000006", name: "地产指数", emoji: "🏠", unit: "", klineSymbol: "sh000006", klineType: "stock", sinaType: "s" },
      ],
    },
  ],

  macroIndicators: [
    { key: "cpi", name: "CPI 同比", emoji: "📊", unit: "%", reportName: "RPT_ECONOMY_CPI", field: "NATIONAL_SAME", freq: "月" },
    { key: "cpi_seq", name: "CPI 环比", emoji: "📉", unit: "%", reportName: "RPT_ECONOMY_CPI", field: "NATIONAL_SEQUENTIAL", freq: "月" },
    { key: "ppi", name: "PPI 同比", emoji: "🏭", unit: "%", reportName: "RPT_ECONOMY_PPI", field: "BASE_SAME", freq: "月" },
    { key: "pmi", name: "PMI", emoji: "📋", unit: "", reportName: "RPT_ECONOMY_PMI", field: "MAKE_INDEX", freq: "月" },
    { key: "m2", name: "M2 同比", emoji: "💰", unit: "%", reportName: "RPT_ECONOMY_CURRENCY_SUPPLY", field: "BASIC_CURRENCY_SAME", freq: "月" },
    { key: "m2_total", name: "M2 总量", emoji: "💳", unit: "万亿元", reportName: "RPT_ECONOMY_CURRENCY_SUPPLY", field: "BASIC_CURRENCY", freq: "月", divisor: 10000 },
    { key: "forex_reserve", name: "外汇储备", emoji: "🏦", unit: "亿美元", reportName: "RPT_ECONOMY_GOLD_CURRENCY", field: "FOREX", freq: "月" },
    { key: "rrr", name: "存款准备金率", emoji: "🏛️", unit: "%", reportName: "RPT_ECONOMY_DEPOSIT_RESERVE", field: "INTEREST_RATE_BA", freq: "不定期" },
    { key: "gdp", name: "GDP 增速", emoji: "📈", unit: "%", reportName: "RPT_ECONOMY_GDP", field: "SUM_SAME", freq: "季", dateField: "TIME" },
    { key: "gdp_deflator", name: "GDP平减指数", emoji: "📐", unit: "%", freq: "季", computed: true },
    { key: "new_loan", name: "新增信贷", emoji: "💳", unit: "%", reportName: "RPT_ECONOMY_RMB_LOAN", field: "RMB_LOAN_SAME", freq: "月" },
    { key: "deposit_rate", name: "存款基准利率", emoji: "🏦", unit: "%", reportName: "RPT_ECONOMY_DEPOSIT_RATE", field: "DEPOSIT_RATE_BA", freq: "不定期" },
  ],
};

export function validate() {
  const missing = [];
  if (!config.pushPlusToken) missing.push("PUSHPLUS_TOKEN");

  if (missing.length > 0) {
    console.error(`[ERROR] .env 缺少配置: ${missing.join(", ")}`);
    console.error("请参考 .env.example 填写完整配置");
    throw new Error(`缺少环境变量: ${missing.join(", ")}`);
  }

  if (config.pushPlusTopic) {
    console.log(`[CONFIG] 群组推送已启用: ${config.pushPlusTopic}`);
  }
  if (config.pushPlusTo) {
    const count = config.pushPlusTo.split(",").filter(Boolean).length;
    console.log(`[CONFIG] 好友推送已启用: ${count} 人`);
  }
  console.log("[CONFIG] 配置校验通过");
}