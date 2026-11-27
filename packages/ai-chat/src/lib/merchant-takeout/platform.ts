import type { CommissionBase, RuleSource } from "./types";

/** 扣点基数项的中文标签，供规则编辑器与来源展示复用 */
export const COMMISSION_BASE_LABELS: Record<keyof CommissionBase, string> = {
  includeProduct: "商品售价计入",
  includePackagingFee: "包装费计入",
  includeDeliveryFee: "配送费计入",
};

/** 把规则来源元数据渲染成一行人类可读摘要，空字段自动省略 */
export function describeRuleSource(source: RuleSource): string {
  const parts: string[] = [];
  if (source.sourceUrl) parts.push(`来源：${source.sourceUrl}`);
  if (source.publishedAt) parts.push(`发布时间：${source.publishedAt}`);
  if (source.fetchedAt) parts.push(`抓取于：${new Date(source.fetchedAt).toLocaleDateString("zh-CN")}`);
  if (source.region) parts.push(`地区：${source.region}`);
  if (source.confidence) parts.push(`可信度：${source.confidence}`);
  if (source.conflictNote) parts.push(`冲突说明：${source.conflictNote}`);
  return parts.join(" · ");
}
