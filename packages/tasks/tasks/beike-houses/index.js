/**
 * 贝壳房源跟踪主入口
 * 流程: Cookie 加载 → 逐组抓取(自适应拆分,单页) → 本地精滤(≤99万·≥3室·白/黑名单)
 *      → 归属校验(详情页权威归属+registry缓存,治贝壳c页同名小区混挂) → 完整性守卫
 *      → 快照落盘 → registry 累计索引 → 对比昨日(下架原因核查) → 生成页面 → 推送线上
 */
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import {
  DATA_DIR,
  loadCookieHeader,
  saveCookieJar,
  fetchQueryAll,
  fetchDetailStatus,
  closeBrowserTransport,
  FetchError,
  requestStats,
} from "./fetcher.js";
import { applyFilters, isSuspiciousShrink, verifyOwnership } from "./filter.js";
import { diffSnapshots, updateRegistry } from "./diff.js";
import {
  todayKey,
  saveSnapshot,
  loadTodaySnapshot,
  loadPreviousSnapshot,
  loadRegistry,
  saveRegistry,
  pruneSnapshots,
  writeStatus,
} from "./store.js";
import { generateDashboard, writePlaceholder } from "./generate-dashboard.js";

const groupLabels = Object.fromEntries(config.groups.map((g) => [g.key, g.label]));
const execFileAsync = promisify(execFile);

// ── 运行锁（防调度双触发/手动+定时撞车导致双进程抢浏览器标签页串页） ──
const LOCK_FILE = path.join(DATA_DIR, ".run.lock");
const LOCK_STALE_MS = 30 * 60 * 1000;

function acquireRunLock() {
  try {
    const stat = fs.statSync(LOCK_FILE);
    if (Date.now() - stat.mtimeMs < LOCK_STALE_MS) {
      throw new Error(
        `检测到活跃运行锁（${LOCK_FILE}，${Math.round((Date.now() - stat.mtimeMs) / 60000)} 分钟前），疑似并发双跑，本次退出`
      );
    }
    // 过期锁：删除后重建（unlink 权限在目录上 → 属主是 root 的旧锁也能删掉；
    // 直接覆盖写会 EACCES 卡死任务）
    console.log(`[beike-houses] 运行锁已过期（>30 分钟），接管并重写`);
    fs.rmSync(LOCK_FILE, { force: true });
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseRunLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
}

/**
 * 推送仪表盘到服务器（云服务器 IP 被贝壳 CAPTCHA 盯得紧，任务只在住宅网络的 Mac 跑，
 * 服务器仅作只读展示：Mac 跑完把页面 scp 过去）
 */
async function pushDashboardToServer(dashboardFile) {
  const target = process.env.DEPLOY_TARGET;
  if (!target) {
    log("[SKIP] 未配置 DEPLOY_TARGET，跳过线上推送（本地开发模式）");
    return;
  }
  const deployPath = process.env.DEPLOY_PATH || "/root/xiaoshengkai-ai";
  const remote = `${target}:${deployPath}/packages/tasks/tasks/beike-houses/dashboard.html`;
  try {
    await execFileAsync("scp", ["-q", dashboardFile, remote], { timeout: 60000 });
    log(`已推送仪表盘 → ${target}`);
  } catch (err) {
    console.error(`[beike-houses] 推送失败（不影响本地数据）: ${err.message}`);
  }
}

function log(...args) {
  console.log("[beike-houses]", ...args);
}

/** 单次抓取（失败抛错，由 run() 决定是否重试） */
async function runOnce(date) {
  // 0. Cookie
  const jar = loadCookieHeader();

  try {
    // 1. 逐组抓取（组内多查询去重；string = 三室+ 粗筛，{q, rooms:2} = 二室+ 轨道粗筛含 l2）
    const groupMap = new Map(config.groups.map((g) => [g.key, g]));
    const raw = [];
    for (const g of config.groups) {
      const seen = new Set();
      const groupHouses = [];
      for (const entry of g.queries) {
        const query = typeof entry === "string" ? entry : entry.q;
        const roomCodes =
          typeof entry === "object" && entry.rooms === 2
            ? ["l2", ...config.baseFilter.rooms]
            : config.baseFilter.rooms;
        const houses = await fetchQueryAll(query, jar, { log, roomCodes });
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
    let houses = applyFilters(raw, config);
    log(`过滤: 抓取 ${raw.length} 条 → 符合(≤${config.priceMax}万·≥${config.minRooms}室·小区规则) ${houses.length} 条`);


    // 2.5 归属校验（白名单组）：贝壳 c 页会把同名小区/附近房源混挂目标小区（列表
    //     小区名+resblockId 都是被查小区），详情页的 区/小区 才是真实归属。
    //     registry.verified 缓存校验结果（归属不变，一次校验终身复用 → 日常近零成本）
    const registry = loadRegistry();
    const verifyGroups = new Set(config.groups.filter((g) => g.verify).map((g) => g.key));
    const pending = houses.filter((h) => verifyGroups.has(h.group) && !registry[h.id]?.verified);
    if (pending.length) log(`归属校验: ${pending.length} 套无缓存，需详情页核验`);
    const rejected = [];
    const rejectsByName = [];
    for (let i = 0; i < pending.length; i++) {
      const h = pending[i];
      const detail = await fetchDetailStatus(h.url, jar);
      log(`[进度 ${String(requestStats().count).padStart(3)}] 归属校验 ${i + 1}/${pending.length} ${h.community} ${h.id}`);
      if (!detail) {
        log(`[WARN] ${h.id} 详情页获取失败，本次保留未校验（下次重试）`);
        continue;
      }
      registry[h.id] = registry[h.id] || { firstSeen: null, lastSeen: null, offSince: null, priceHistory: [] };
      registry[h.id].verified = {
        district: detail.district,
        community: detail.community,
        checkedAt: new Date().toISOString(),
      };
      if (!verifyOwnership(h, detail, config)) {
        rejected.push(h.id);
        rejectsByName.push(`${detail.district}·${detail.community || "?"}`);
        log(`[剔除] ${h.id} 列表标签「${h.community}」→ 实际归属 ${detail.district}·${detail.community}`);
      }
    }
    // 已有缓存的房源也按缓存校验（含历史遗留脏数据）
    for (const h of houses) {
      if (rejected.includes(h.id) || !verifyGroups.has(h.group)) continue;
      const v = registry[h.id]?.verified;
      if (v && !verifyOwnership(h, v, config)) {
        rejected.push(h.id);
        log(`[剔除] ${h.id}「${h.community}」缓存归属 ${v.district}·${v.community} 不在白名单`);
      }
    }
    if (rejected.length) {
      houses = houses.filter((h) => !rejected.includes(h.id));
      log(`归属校验: 剔除 ${rejected.length} 套混挂房源`);
    }
    // 展示用权威小区名（比 c 页聚合标签更精确）
    for (const h of houses) {
      const v = registry[h.id]?.verified;
      if (v?.community && verifyGroups.has(h.group)) h.community = v.community;
    }
    // 归属校验缓存即刻落盘（防后续步骤失败丢缓存，下轮续跑累积）
    saveRegistry(registry);

    // 3. 完整性守卫
    const prevSnapshot = loadPreviousSnapshot(date);
    const prevHouses = prevSnapshot?.houses || [];
    if (isSuspiciousShrink(houses.length, prevHouses.length)) {
      throw new Error(
        `数据量异常：今日 ${houses.length} 套 < 昨日 ${prevHouses.length} 套的 50%，疑似抓取异常，本次不落盘（防误报下架）`
      );
    }

    // 4. registry 累计索引（firstSeen / 变价次数 / 重新上架）
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
    if (prevSnapshot) {
      changes = diffSnapshots(prevHouses, houses, registry);
      log(
        `对比 ${prevSnapshot.date}: 新上架 ${changes.added.length} · 降价 ${changes.priceDown.length} · 涨价 ${changes.priceUp.length} · 下架 ${changes.removed.length}`
      );

      // 7. 下架原因核查（详情页：涨出预算 vs 已下架/成交）+ 权威小区名修正
      //    （下架卡点开链接显示真实归属、卡片标签却可能来自 c 页聚合错标 → 统一用权威名）
      for (const h of changes.removed) {
        const v = registry[h.id]?.verified;
        if (v?.community) h.community = v.community;
      }
      for (const h of changes.removed.slice(0, config.detailCheckLimit)) {
        const status = await fetchDetailStatus(h.url, jar);
        if (status?.community) h.community = status.community;
        if (status?.online && status.totalPrice) {
          h.removedReason = `调价 ${status.totalPrice}万 超出预算`;
        } else if (status) {
          h.removedReason = "已下架/已成交";
        }
      }
      if (changes.removed.length > config.detailCheckLimit) {
      }
    } else {
    }

    // 8. 生成页面 + 清理旧快照 + 推送线上
    const baselineDate = prevSnapshot?.date || null;
    const dashboardFile = generateDashboard({
      date,
      fetchedAt: new Date().toISOString(),
      houses,
      changes,
      groupLabels,
      baselineDate,
      status: { ok: true, at: new Date().toISOString(), error: null },
    });
    pruneSnapshots();
    saveRegistry(newRegistry);
    saveCookieJar(jar);
    writeStatus({ lastRun: date, running: false, lastOk: true, lastError: null, dataDate: date, baselineDate });
    await pushDashboardToServer(dashboardFile);

    log(`=== 完成：${houses.length} 套在跟 · 请求 ${requestStats().count} 次 · 页面已更新 ===`);
    return { ok: true, houses: houses.length, requests: requestStats().count };
  } catch (err) {
    if (err instanceof FetchError) {
      // 会话问题：保存续期后的 Cookie 留诊断，错误上抛由 scheduler 记录
      saveCookieJar(jar);
    }
    console.error("[beike-houses] 执行失败:", err.message);
    // 失败也要让页面可见：保留上一份数据 + 顶部红色失败横幅（用户不必翻日志）
    try {
      // 失败页展示「最新成功快照」：今天早先跑成功过就用今天的，否则用上一天的
      const prev = loadTodaySnapshot(date) || loadPreviousSnapshot(date);
      if (prev) {
        const file = generateDashboard({
          date: prev.date,
          fetchedAt: prev.fetchedAt,
          houses: prev.houses,
          changes: null,
          groupLabels,
          baselineDate: null,
          status: { ok: false, at: new Date().toISOString(), error: err.message },
        });
        writeStatus({
          lastRun: date,
          running: false,
          lastOk: false,
          lastError: err.message,
          dataDate: prev.date,
          baselineDate: null,
        });
        await pushDashboardToServer(file);
        log("已生成失败提示页（保留上一份数据）并推送线上");
      } else {
        writeStatus({ lastRun: date, running: false, lastOk: false, lastError: err.message, dataDate: null });
      }
    } catch (e2) {
      console.error("[beike-houses] 失败提示页生成也失败:", e2.message);
    }
    throw err;
  } finally {
    await closeBrowserTransport(); // 释放浏览器通道资源（若启用）
  }
}

/**
 * 任务入口：失败自动重试（默认 30 分钟后重试 1 次）
 * 断档防护：风控/网络抖动的失败不留在页面上（页面显示失败横幅），并自动补跑
 */
export async function run() {
  const date = todayKey();
  acquireRunLock();
  // 当日已成功 → 跳过（快照只在成功路径落盘，存在即代表今日成功；多时段仅作失败兜底）
  const todaySnap = loadTodaySnapshot(date);
  if (todaySnap) {
    log(`今日（${date}）已成功更新（在跟 ${todaySnap.houses.length} 套），本次跳过`);
    return { ok: true, skipped: true, houses: todaySnap.houses.length };
  }
  log(`=== ${date} 贝壳房源抓取开始 ===`);
  writeStatus({ lastRun: date, running: true, lastOk: null });

  const maxAttempts = Number(process.env.BEIKE_MAX_ATTEMPTS || 2);
  const retryDelayMs = Number(process.env.BEIKE_RETRY_DELAY_MS || 30 * 60 * 1000);
  let lastErr = null;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await runOnce(date);
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          log(
            `第 ${attempt}/${maxAttempts} 次失败：${err.message} → ${Math.round(retryDelayMs / 60000)} 分钟后自动重试`
          );
          writeStatus({ lastRun: date, running: false, lastOk: false, lastError: err.message });
          await new Promise((r) => setTimeout(r, retryDelayMs));
        }
      }
    }
    throw lastErr;
  } finally {
    releaseRunLock();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
