/**
 * HTTP 抓取层：Cookie 会话 + 登录墙/CAPTCHA 检测 + 自适应拆分查询（绕过 pgN 分页 CAPTCHA）
 *
 * - 列表 page1 匿名+Cookie 均可访问；pgN 被 hip.ke.com CAPTCHA 系统性拦截
 *   → 拆分策略：户型(l3-l6) × 价格(p1-p2) × 面积(a1-a8) × 楼层(lc1-lc3) 逐维细分，
 *     每个叶查询 ≤30 条（单页装下），筛选码空间完备分割 → 数据不漏
 * - Cookie 存 data/beike-houses/cookies.json，响应 Set-Cookie 自动合并续期
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseListPage, parseDetailPage } from "./parser.js";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, "..", "..", "..", "..", "data", "beike-houses");
const COOKIE_FILE = path.join(DATA_DIR, "cookies.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export class FetchError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // NO_COOKIE | LOGIN_WALL | CAPTCHA | HTTP
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function politeDelay() {
  await sleep(config.requestIntervalMs + Math.random() * config.requestJitterMs);
}

// ---------- Cookie 管理 ----------

export function loadCookieHeader() {
  if (!fs.existsSync(COOKIE_FILE)) {
    throw new FetchError(
      `缺少 ${COOKIE_FILE}：请在浏览器登录 sx.ke.com 后导出 Cookie 写入该文件（JSON 对象 {"name":"value",...} 或单行 "a=b; c=d" 格式）`,
      "NO_COOKIE"
    );
  }
  const raw = fs.readFileSync(COOKIE_FILE, "utf-8").trim();
  if (!raw) throw new FetchError(`Cookie 文件为空：${COOKIE_FILE}`, "NO_COOKIE");
  let jar;
  if (raw.startsWith("{")) {
    jar = JSON.parse(raw);
  } else {
    jar = {};
    for (const pair of raw.split(";")) {
      const i = pair.indexOf("=");
      if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
  }
  return jar;
}

export function saveCookieJar(jar) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(jar, null, 2), "utf-8");
}

/** 合并响应 Set-Cookie（会话自动续期） */
function mergeSetCookies(res, jar) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const line of list) {
    const pair = line.split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) {
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (name && value) jar[name] = value;
    }
  }
}

// ---------- HTTP ----------

let requestCount = 0;

/** 单页 GET（手动跟随重定向以精确识别登录墙/CAPTCHA） */
async function httpGet(url, jar) {
  if (requestCount >= config.maxRequests) {
    throw new FetchError(`请求数超上限 ${config.maxRequests}（防反爬熔断）`, "HTTP");
  }
  requestCount++;
  const headers = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: "https://sx.ke.com/ershoufang/",
    Cookie: Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; "),
  };

  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current, { headers, redirect: "manual" });
    mergeSetCookies(res, jar);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new FetchError(`无 Location 的 ${res.status} 重定向: ${url}`, "HTTP");
      if (loc.includes("clogin")) {
        throw new FetchError(
          "登录态失效（跳转贝壳登录页）：请在浏览器重新登录 sx.ke.com 并更新 data/beike-houses/cookies.json",
          "LOGIN_WALL"
        );
      }
      if (loc.includes("hip.ke.com/captcha")) {
        throw new FetchError(`触发贝壳 CAPTCHA: ${current}`, "CAPTCHA");
      }
      current = new URL(loc, current).href;
      continue;
    }
    if (!res.ok) throw new FetchError(`HTTP ${res.status}: ${url}`, "HTTP");

    const html = await res.text();
    if (/<title>\s*CAPTCHA/i.test(html)) {
      throw new FetchError(`触发贝壳 CAPTCHA: ${current}`, "CAPTCHA");
    }
    return html;
  }
  throw new FetchError(`重定向次数过多: ${url}`, "HTTP");
}

// ---------- 自适应拆分查询 ----------

const SPLIT_DIMS = [
  { key: "rooms", codes: ["l3", "l4", "l5", "l6"] },
  { key: "price", codes: ["p1", "p2"] },
  { key: "area", codes: ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"] },
  { key: "floor", codes: ["lc1", "lc2", "lc3"] },
];

function buildPrefix(query, parts) {
  // 板块 slug 用 "/" 分隔，c<小区ID> 直接拼接（贝壳 URL 约定）
  const sep = query.startsWith("c") ? "" : "/";
  return query + sep + [...parts.rooms, ...parts.price, ...parts.area, ...parts.floor].join("");
}

/**
 * 拉取一个查询的完整房源集合（自适应拆分，全部走 page1）
 *
 * 贝壳两个坑：
 * 1. c<id> 小区查询 0 结果时回退展示「附近推荐房源」→ 必须按 resblockId 过滤只留目标小区
 * 2. 列表页显示的「共找到 N 套」在 c 页/筛选页是垃圾值（可能显示 0）→ 拆分触发只看
 *    「本页是否满页(30条)」：满页即认为还有更多，继续拆分维度
 *
 * @param {string} query 板块 slug 或 c<resblockId>
 * @param {object} jar Cookie
 * @param {object} opts { log }
 * @returns {Promise<object[]>}
 */
export async function fetchQueryAll(query, jar, { log = () => {} } = {}) {
  const resblockId = query.startsWith("c") ? query.slice(1) : null;

  async function collect(parts, splitIdx) {
    const prefix = buildPrefix(query, parts);
    const url = config.baseUrl + prefix + "/";
    let html;
    try {
      html = await httpGet(url, jar);
    } finally {
      await politeDelay();
    }
    const { total, houses } = parseListPage(html);
    const items = resblockId ? houses.filter((h) => h.resblockId === resblockId) : houses;
    if (resblockId && houses.length && !items.length) {
      log(`${prefix}: 目标小区无匹配（页面 ${houses.length} 条均为附近推荐回退，已丢弃）`);
    }
    if (items.length < config.pageSize) return items;

    // 满页：可能还有更多 → 继续拆分
    if (splitIdx >= SPLIT_DIMS.length) {
      log(`[WARN] ${prefix} 拆分维度已用尽仍满页 ${items.length} 条，可能不全`);
      return items;
    }
    const dim = SPLIT_DIMS[splitIdx];
    log(`[SPLIT] ${prefix} 满页 ${items.length} 条（显示total=${total}不可信），按 ${dim.key} 拆分`);
    let merged = [];
    const seen = new Set();
    for (const code of dim.codes) {
      const child = { ...parts, [dim.key]: [code] };
      for (const h of await collect(child, splitIdx + 1)) {
        if (!seen.has(h.id)) {
          seen.add(h.id);
          merged.push(h);
        }
      }
    }
    return merged;
  }

  return collect(
    { rooms: [...config.baseFilter.rooms], price: [...config.baseFilter.price], area: [], floor: [] },
    0
  );
}

/** 详情页核查（下架原因判断），失败不抛错返回 null */
export async function fetchDetailStatus(houseUrl, jar) {
  try {
    const html = await httpGet(houseUrl, jar);
    await politeDelay();
    return parseDetailPage(html);
  } catch {
    return null;
  }
}

export function requestStats() {
  return { count: requestCount, max: config.maxRequests };
}
