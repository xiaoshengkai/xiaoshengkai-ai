/**
 * 快照对比（纯函数）：新上架（含重新上架）/ 下架 / 涨价 / 降价
 */

function byId(houses) {
  const map = new Map();
  for (const h of houses || []) map.set(h.id, h);
  return map;
}

/**
 * @param {object[]} prev 上一份快照房源
 * @param {object[]} curr 今日房源
 * @param {object|null} registry 累计索引（houseId → {firstSeen, offSince}），用于识别重新上架
 */
export function diffSnapshots(prev, curr, registry = {}) {
  const prevMap = byId(prev);
  const currMap = byId(curr);
  const added = [];
  const removed = [];
  const changed = [];

  for (const h of curr) {
    const old = prevMap.get(h.id);
    if (!old) {
      const reg = registry[h.id];
      added.push({
        ...h,
        reappeared: Boolean(reg?.offSince),
        firstSeen: reg?.firstSeen || h.firstSeen || null,
      });
    } else if (old.totalPrice !== h.totalPrice || old.unitPrice !== h.unitPrice) {
      changed.push({ before: old, after: h, deltaTotal: h.totalPrice - old.totalPrice });
    }
  }
  for (const h of prev) {
    if (!currMap.has(h.id)) removed.push(h);
  }

  return {
    added,
    removed,
    changed,
    priceUp: changed.filter((c) => c.deltaTotal > 0),
    priceDown: changed.filter((c) => c.deltaTotal < 0),
    samePriceOtherChange: changed.filter((c) => c.deltaTotal === 0), // 单价/其他字段变化
  };
}

/**
 * 更新累计索引：firstSeen / priceHistory / lastSeen / offSince
 * @returns {object} 新 registry
 */
export function updateRegistry(prevRegistry, curr, date) {
  const registry = { ...(prevRegistry || {}) };
  const currMap = byId(curr);
  for (const h of currMap.values()) {
    const reg = registry[h.id];
    if (reg) {
      reg.lastSeen = date;
      reg.offSince = null;
      const last = reg.priceHistory?.[reg.priceHistory.length - 1];
      if (!last || last.total !== h.totalPrice || last.unit !== h.unitPrice) {
        reg.priceHistory.push({ date, total: h.totalPrice, unit: h.unitPrice });
      }
    } else {
      registry[h.id] = {
        firstSeen: date,
        lastSeen: date,
        offSince: null,
        community: h.community,
        priceHistory: [{ date, total: h.totalPrice, unit: h.unitPrice }],
      };
    }
  }
  for (const [id, reg] of Object.entries(registry)) {
    if (!currMap.has(id) && reg.lastSeen === date) reg.offSince = date;
  }
  // 标记今日消失
  for (const [id, reg] of Object.entries(registry)) {
    if (!currMap.has(id) && reg.lastSeen !== date && !reg.offSince) reg.offSince = date;
  }
  return registry;
}
