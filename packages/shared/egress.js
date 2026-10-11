/**
 * 内网出口层（corp egress）
 * ============================================================================
 *
 * 背景：公网云服务器无法访问公司内网（如 yapi.cai-inc.com）。Mac 在内网侧，
 * 通过反向 SSH 隧道把 SOCKS5 出口暴露到服务器 127.0.0.1:<port>。本模块按
 * **域名白名单**决定请求走隧道还是直连——单点判断，MCP / 各处调用自动受益。
 *
 * 机制：
 *   - readEgressConfig()  fresh 读取 data/settings/egress.json（2s 缓存）
 *   - isCorpHost()        域名白名单匹配（精确 / .后缀 / CIDR）
 *   - egressFetch()       白名单走 SOCKS（npm undici + socks），否则原生 fetch
 *   - installEgress()     猴子补丁 globalThis.fetch，白名单自动改道（幂等）
 *
 * 约定：白名单命中才碰 undici/socks；其余一律原始 fetch，零副作用。
 * 注意：Node 内建 fetch 用的是内置 undici，与依赖里的 undici 是两份实现，
 *       跨版本 dispatcher 会报错——故 corp 路径统一用 npm undici 的 fetch。
 */
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { Agent, fetch as undiciFetch } from "undici";
import { SocksClient } from "socks";

const REL = ["data", "settings", "egress.json"];
const DEFAULT_CONFIG = { enabled: false, proxy: "127.0.0.1:11080", whitelist: [] };
const CACHE_TTL_MS = 2000;

function candidatePaths() {
  const out = [
    // ai-chat / MCP：cwd = packages/ai-chat（见 mcp-client.ts spawn cwd）
    path.resolve(process.cwd(), "..", "..", ...REL),
    // 仓库根启动：cwd = repo root
    path.resolve(process.cwd(), ...REL),
  ];
  try {
    // 纯 node：shared/egress.js → 上两级 = 仓库根
    out.push(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ...REL));
  } catch {
    /* webpack 下 import.meta.url 可能不可用，忽略 */
  }
  return out;
}

let _cache = { at: 0, val: null };

export function readEgressConfig() {
  const now = Date.now();
  if (_cache.val && now - _cache.at < CACHE_TTL_MS) return _cache.val;
  let cfg = { ...DEFAULT_CONFIG };
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) {
        cfg = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(p, "utf-8")) };
        break;
      }
    } catch {
      /* 读取/解析失败 → 保持默认（关） */
    }
  }
  _cache = { at: now, val: cfg };
  return cfg;
}

function normHost(host) {
  return String(host || "").toLowerCase().replace(/\.$/, "");
}

function ipToInt(ip) {
  const parts = String(ip).split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function inCidr(ip, cidr) {
  const [base, bitsStr] = String(cidr).split("/");
  const bits = Number(bitsStr);
  const a = ipToInt(ip);
  const b = ipToInt(base);
  if (a == null || b == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

/** 域名是否命中白名单：精确 / .后缀（含裸域）/ CIDR */
export function isCorpHost(host, whitelist) {
  const h = normHost(host);
  if (!h) return false;
  for (const raw of whitelist || []) {
    const entry = String(raw || "").trim().toLowerCase();
    if (!entry || entry.startsWith("#")) continue;
    if (entry.includes("/")) {
      if (ipToInt(h) != null && inCidr(h, entry)) return true;
    } else if (entry.startsWith(".")) {
      if (h === entry.slice(1) || h.endsWith(entry)) return true;
    } else if (h === entry) {
      return true;
    }
  }
  return false;
}

// ── SOCKS5 dispatcher（npm undici 的自定义 connect）──
let _agent = null;
let _agentKey = "";

function socksAgent(proxy) {
  if (_agent && _agentKey === proxy) return _agent;
  const idx = proxy.lastIndexOf(":");
  const host = proxy.slice(0, idx);
  const port = Number(proxy.slice(idx + 1));
  const agent = new Agent({
    connect: (opts, callback) => {
      // undici 对默认端口传空串（URL API 约定），按协议补默认端口
      const destPort = opts.port || (opts.protocol === "https:" ? 443 : 80);
      SocksClient.createConnection({
        proxy: { host, port, type: 5 },
        command: "connect",
        // 传域名 → SOCKS5h 远程解析（在 Mac 侧解析，避免服务器 DNS 差异）
        destination: { host: opts.hostname, port: Number(destPort) },
      })
        .then(({ socket }) => {
          if (opts.protocol === "https:") {
            const tlsSocket = tls.connect({ socket, servername: opts.servername || opts.hostname });
            tlsSocket.once("secureConnect", () => callback(null, tlsSocket));
            tlsSocket.once("error", callback);
          } else {
            callback(null, socket);
          }
        })
        .catch(callback);
    },
  });
  _agent = agent;
  _agentKey = proxy;
  return agent;
}

/** 白名单命中 → 经 SOCKS 请求；否则原生 fetch 直连 */
export async function egressFetch(url, init = {}) {
  const cfg = readEgressConfig();
  let host = "";
  try {
    host = new URL(typeof url === "string" ? url : url?.url).hostname;
  } catch {
    return fetch(url, init);
  }
  if (cfg.enabled && cfg.proxy && isCorpHost(host, cfg.whitelist)) {
    return undiciFetch(url, { ...init, dispatcher: socksAgent(cfg.proxy) });
  }
  return fetch(url, init);
}

/** 猴子补丁 globalThis.fetch：白名单 host 自动改道隧道，其余透传（幂等） */
export function installEgress() {
  if (globalThis.__egressInstalled) return;
  globalThis.__egressInstalled = true;
  const orig = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    let host = "";
    try {
      const u = typeof input === "string" ? input : input?.url;
      host = new URL(u).hostname;
    } catch {
      /* 非绝对 URL：透传 */
    }
    const cfg = readEgressConfig();
    if (cfg.enabled && host && cfg.proxy && isCorpHost(host, cfg.whitelist)) {
      return undiciFetch(input, { ...(init || {}), dispatcher: socksAgent(cfg.proxy) });
    }
    return orig(input, init);
  };
}
