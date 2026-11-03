// ponytail: hardcoded pricing, update when rates change
// 默认按 USD 计价（最后乘 7.2 转 ¥）；cny: true 表示已是 ¥ 价，跳过换算
const PRICING: Record<string, { input: number; output: number; cny?: boolean }> = {
  // DeepSeek 空闲时段·缓存未命中价（元/百万tokens），高峰×2、缓存命中更低，平铺估算取空闲
  "deepseek-v4-pro":  { input: 4.5, output: 13.5, cny: true },
  "deepseek-flash":   { input: 1, output: 4, cny: true },
  "MiniMax-M3":       { input: 0.55, output: 2.19 },
  "qwen3.8-max":      { input: 12, output: 36, cny: true },
  "qwen3.8-flash":    { input: 1, output: 3, cny: true },
};

const USD_TO_CNY = 7.2;

export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICING[modelName];
  if (!price) return 0;
  const cost = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  return price.cny ? cost : cost * USD_TO_CNY;
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}