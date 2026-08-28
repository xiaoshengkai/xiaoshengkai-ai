/**
 * 关键词分类器：给每条新闻标题打分，归入得分最高的分类
 * - 命中一个关键词 +2 分
 * - 同分类多个关键词命中可叠加（提高准确率）
 * - 0 分 → 进入「其他」兜底分类
 */

import { categories, OTHER_CATEGORY } from "./config.js";

/**
 * 归一化标题：去空白、去标点、转小写（用于关键词匹配和跨源去重）
 */
export function normalizeTitle(title) {
  return String(title)
    .replace(/[\s\u3000]+/g, "")
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "")
    .toLowerCase();
}

/**
 * 对单条标题打分
 * @returns { key, label, emoji, color, score }
 */
export function classify(title) {
  const normalized = normalizeTitle(title);
  let best = null;

  for (const cat of categories) {
    let score = 0;
    for (const kw of cat.keywords) {
      // 关键词也归一化后做子串匹配
      if (normalized.includes(normalizeTitle(kw))) {
        score += 2;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { ...cat, score };
    }
  }

  if (!best) {
    return { ...OTHER_CATEGORY, score: 0 };
  }
  return best;
}

/**
 * 批量分类 + 去重合并
 * @param {Array<{title, url, hot, source}>} items 所有源的原始条目
 * @returns {Map<categoryKey, Array<item>>} 分类后的条目（已去重、已按热度排序）
 */
export function classifyAndMerge(items, topPerCategory = 10) {
  const seen = new Map(); // normalizedTitle -> { item, sources: Set }
  const results = new Map();

  for (const item of items) {
    if (!item.title) continue;
    const norm = normalizeTitle(item.title);
    if (norm.length === 0) continue;

    // 跨源去重：同一标题只保留一条，合并来源
    if (seen.has(norm)) {
      const existing = seen.get(norm);
      existing.sources.add(item.source);
      // 热度取较高值
      if (item.hot != null && (existing.hot == null || item.hot > existing.hot)) {
        existing.hot = item.hot;
      }
      continue;
    }

    const cat = classify(item.title);
    const entry = {
      title: item.title,
      url: item.url || null,
      hot: item.hot != null ? Number(item.hot) : null,
      sources: new Set([item.source]),
      category: cat.key,
      categoryLabel: cat.label,
      categoryEmoji: cat.emoji,
      categoryColor: cat.color,
      score: cat.score,
    };
    seen.set(norm, entry);

    if (!results.has(cat.key)) {
      results.set(cat.key, { label: cat.label, emoji: cat.emoji, color: cat.color, items: [] });
    }
    results.get(cat.key).items.push(entry);
  }

  // 每个分类按热度降序（无热度的排最后，按原始出现顺序），截断前 N
  for (const group of results.values()) {
    group.items.sort((a, b) => {
      const ha = a.hot != null ? a.hot : -1;
      const hb = b.hot != null ? b.hot : -1;
      return hb - ha;
    });
    group.items = group.items.slice(0, topPerCategory);
  }

  return results;
}

/**
 * 格式化热度值：12345 -> 1.2万
 */
export function formatHot(hot) {
  if (hot == null) return "";
  const n = Number(hot);
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}
