/**
 * 规则过滤（纯函数）：≤99万 + ≥3室 + 小区白/黑名单
 */

export function normalizeName(s) {
  return String(s || "").replace(/[·•\s\-—－()（）]/g, "");
}

/** 包含匹配（双向），容错「御景华庭四期北区」vs「御景华庭」等变体 */
function matchAny(community, names) {
  const c = normalizeName(community);
  return names.some((n) => {
    const nn = normalizeName(n);
    return c.includes(nn) || nn.includes(c);
  });
}

/**
 * @param {object[]} houses 已带 group 字段的房源
 * @param {object} config
 * @returns {object[]} 过滤后房源（附带 groupLabel）
 */
export function applyFilters(houses, config) {
  const groupMap = new Map(config.groups.map((g) => [g.key, g]));
  return houses.filter((h) => {
    const g = groupMap.get(h.group);
    if (!g) return false;
    if (h.totalPrice <= 0 || h.totalPrice > config.priceMax) return false;
    if (h.rooms < config.minRooms) return false;
    if (g.include && !matchAny(h.community, g.include)) return false;
    if (g.exclude && matchAny(h.community, g.exclude)) return false;
    return true;
  });
}

/** 数据完整性守卫：今日总数 < 昨日 50% 视为异常 */
export function isSuspiciousShrink(todayCount, prevCount) {
  if (!prevCount || prevCount === 0) return false;
  return todayCount < prevCount * 0.5;
}
