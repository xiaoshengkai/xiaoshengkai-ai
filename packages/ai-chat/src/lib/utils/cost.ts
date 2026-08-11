// ponytail: hardcoded pricing, update when rates change
const PRICING: Record<string, { input: number; output: number }> = {
  "deepseek-v4-pro":  { input: 1.10, output: 4.40 },
  "deepseek-v4-flash": { input: 0.27, output: 1.10 },
  "MiniMax-M3":       { input: 0.55, output: 2.19 },
};

const USD_TO_CNY = 7.2;

export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICING[modelName];
  if (!price) return 0;
  return ((inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output) * USD_TO_CNY;
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}