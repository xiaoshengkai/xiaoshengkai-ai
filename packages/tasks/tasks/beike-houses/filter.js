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

/** 精确匹配（normalized 全等），白名单用（防同名小区/聚合混挂）；支持 includePatterns 正则条目 */
export function matchExact(community, names, patterns = []) {
  const c = normalizeName(community);
  if (names.some((n) => normalizeName(n) === c)) return true;
  return patterns.some((p) => new RegExp(p).test(c));
}

/** 归属校验：详情页权威归属 vs 白名单（区县 + 精确小区名/模式） */
export function verifyOwnership(house, verified, config) {
  const g = config.groups.find((x) => x.key === house.group);
  if (!g || !g.include) return true;
  if (verified.district !== config.district) return false;
  return matchExact(verified.community, g.include, g.includePatterns);
}

/** 二室+ 轨道判定（仅迪荡·御景华庭一~五期，≥2室） */
export function isTrack2(house, config) {
  const r = config.room2;
  if (!r || house.group !== r.group || house.rooms < 2) return false;
  return new RegExp(r.pattern).test(normalizeName(house.community));
}

/**
 * 双轨道过滤（≤99万，满足其一即跟踪）：
 * - 三室+ 轨道：≥3室 且各组小区规则（白/黑名单）
 * - 二室+ 轨道：≥2室 且 迪荡·御景华庭名称模式
 * @param {object[]} houses 已带 group 字段的房源
 * @param {object} config
 * @returns {object[]} 过滤后房源（附带 track2 标记）
 */
export function applyFilters(houses, config) {
  const groupMap = new Map(config.groups.map((g) => [g.key, g]));
  return houses.filter((h) => {
    if (h.totalPrice <= 0 || h.totalPrice > config.priceMax) return false;
    const track2 = isTrack2(h, config);
    h.track2 = track2;
    if (track2) return true;
    const g = groupMap.get(h.group);
    if (!g || h.rooms < config.minRooms) return false;
    if (g.include && !matchExact(h.community, g.include, g.includePatterns)) return false;
    if (g.exclude && matchAny(h.community, g.exclude)) return false;
    return true;
  });
}

/** 数据完整性守卫：今日总数 < 昨日 50% 视为异常 */
export function isSuspiciousShrink(todayCount, prevCount) {
  if (!prevCount || prevCount === 0) return false;
  return todayCount < prevCount * 0.5;
}
