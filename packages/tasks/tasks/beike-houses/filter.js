/**
 * 规则过滤（纯函数）：≤99万 + ≥3室 + 小区白/黑名单
 */

export function normalizeName(s) {
  return String(s || "").replace(/[·•\s\-—－()（）]/g, "");
}

/** 包含匹配（双向），黑名单用（容错「陶然名苑(东区)」等变体） */
function matchAny(community, names) {
  const c = normalizeName(community);
  return names.some((n) => {
    const nn = normalizeName(n);
    return c.includes(nn) || nn.includes(c);
  });
}

/** 精确匹配（normalized 全等），白名单用（防同名小区/聚合混挂） */
export function matchExact(community, names) {
  const c = normalizeName(community);
  return names.some((n) => normalizeName(n) === c);
}

/** 归属校验：详情页权威归属 vs 白名单（区县 + 精确小区名） */
export function verifyOwnership(house, verified, config) {
  const g = config.groups.find((x) => x.key === house.group);
  if (!g || !g.include) return true;
  if (verified.district !== config.district) return false;
  return matchExact(verified.community, g.include);
}

/**
 * @param {object[]} houses 已带 group 字段的房源
 * @param {object} config
 * @returns {object[]} 过滤后房源
 */
export function applyFilters(houses, config) {
  const groupMap = new Map(config.groups.map((g) => [g.key, g]));
  return houses.filter((h) => {
    const g = groupMap.get(h.group);
    if (!g) return false;
    if (h.totalPrice <= 0 || h.totalPrice > config.priceMax) return false;
    if (h.rooms < config.minRooms) return false;
    if (g.include && !matchExact(h.community, g.include)) return false;
    if (g.exclude && matchAny(h.community, g.exclude)) return false;
    return true;
  });
}

/** 数据完整性守卫：今日总数 < 昨日 50% 视为异常 */
export function isSuspiciousShrink(todayCount, prevCount) {
  if (!prevCount || prevCount === 0) return false;
  return todayCount < prevCount * 0.5;
}
