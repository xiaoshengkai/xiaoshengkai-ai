/**
 * 贝壳房源跟踪主入口
 * 流程: Cookie 加载 → 逐组抓取(自适应拆分,单页) → 本地精滤(≤99万·≥3室·白/黑名单)
 *      → 完整性守卫 → 快照落盘 → registry 累计索引 → 对比昨日 → 下架原因核查 → 生成页面
 */
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  loadCookieHeader,
  saveCookieJar,
  fetchQueryAll,
  fetchDetailStatus,
  FetchError,
  requestStats,
} from "./fetcher.js";
import { applyFilters, isSuspiciousShrink } from "./filter.js";
import { diffSnapshots, updateRegistry } from "./diff.js";
import {
  todayKey,
  saveSnapshot,
  loadPreviousSnapshot,
  loadRegistry,
  saveRegistry,
  pruneSnapshots,
} from "./store.js";
import { generateDashboard, writePlaceholder } from "./generate-dashboard.js";

const groupLabels = Object.fromEntries(config.groups.map((g) => [g.key, g.label]));

function log(...args) {
  console.log("[beike-houses]", ...args);
}

export async function run() {
  const date = todayKey();
  log(`=== ${date} 贝壳房源抓取开始 ===`);

  // 0. Cookie
  const jar = loadCookieHeader();

  try {
    // 1. 逐组抓取（组内多查询去重）
    const groupMap = new Map(config.groups.map((g) => [g.key, g]));
    const raw = [];
    for (const g of config.groups) {
      const seen = new Set();
      const groupHouses = [];
      for (const query of g.queries) {
        const houses = await fetchQueryAll(query, jar, { log });
        let hit = 0;
        for (const h of houses) {
          if (!seen.has(h.id)) {
            seen.add(h.id);
            groupHouses.push({ ...h, group: g.key });
            hit++;
          }
        }
        log(`${g.label}/${query}: ${houses.length} 条，去重后新增 ${hit}`);
      }
      raw.push(...groupHouses);
    }
    saveCookieJar(jar); // 保存续期后的会话

    // 2. 本地精滤
    const houses = applyFilters(raw, config);
    log(`过滤: 抓取 ${raw.length} 条 → 符合(≤${config.priceMax}万·≥${config.minRooms}室·小区规则) ${houses.length} 条`);

    // 3. 完整性守卫
    const prevSnapshot = loadPreviousSnapshot(date);
    const prevHouses = prevSnapshot?.houses || [];
    if (isSuspiciousShrink(houses.length, prevHouses.length)) {
      throw new Error(
        `数据量异常：今日 ${houses.length} 套 < 昨日 ${prevHouses.length} 套的 50%，疑似抓取异常，本次不落盘（防误报下架）`
      );
    }

    // 4. registry 累计索引（firstSeen / 变价次数 / 重新上架）
    const registry = loadRegistry();
    const newRegistry = updateRegistry(registry, houses, date);
    for (const h of houses) {
      const reg = newRegistry[h.id];
      h.firstSeen = reg?.firstSeen || null;
      h.priceChanges = Math.max(0, (reg?.priceHistory?.length || 1) - 1);
    }

    // 5. 快照落盘（查询失败不落盘已在 try 内保证；此处成功才写）
    saveSnapshot(date, houses, { stats: requestStats() });

    // 6. 对比上一份快照
    let changes = null;
    let notes = [];
    if (prevSnapshot) {
      changes = diffSnapshots(prevHouses, houses, registry);
      log(
        `对比 ${prevSnapshot.date}: 新上架 ${changes.added.length} · 降价 ${changes.priceDown.length} · 涨价 ${changes.priceUp.length} · 下架 ${changes.removed.length}`
      );

      // 7. 下架原因核查（详情页：涨出预算 vs 已下架/成交）
      for (const h of changes.removed.slice(0, config.detailCheckLimit)) {
        const status = await fetchDetailStatus(h.url, jar);
        if (status?.online && status.totalPrice) {
          h.removedReason = `调价 ${status.totalPrice}万 超出预算`;
        } else if (status) {
          h.removedReason = "已下架/已成交";
        }
      }
      if (changes.removed.length > config.detailCheckLimit) {
        notes.push(`下架房源 ${changes.removed.length} 套，仅核查前 ${config.detailCheckLimit} 套原因`);
      }
    } else {
      notes.push(`首次运行：基线快照已建立，明日起展示每日变化`);
    }

    // 8. 生成页面 + 清理旧快照
    generateDashboard({ date, fetchedAt: new Date().toISOString(), houses, changes, groupLabels, notes });
    pruneSnapshots();
    saveRegistry(newRegistry);
    saveCookieJar(jar);

    log(`=== 完成：${houses.length} 套在跟 · 请求 ${requestStats().count} 次 · 页面已更新 ===`);
    return { ok: true, houses: houses.length, requests: requestStats().count };
  } catch (err) {
    if (err instanceof FetchError) {
      // 会话问题：保存续期后的 Cookie 留诊断，错误上抛由 scheduler 记录
      saveCookieJar(jar);
    }
    console.error("[beike-houses] 执行失败:", err.message);
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
