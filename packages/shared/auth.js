/**
 * 登录鉴权共享模块（单人应用：单密码，无用户名）
 * ============================================================================
 *
 * 生效密码：项目根 data/auth.json 的 passwordHash（sha256 hex）优先，
 *           根 .env 的 AUTH_PASSWORD（明文）作初始兜底。改密只写 auth.json。
 *
 * Token：`过期时间ms.密码指纹8位.HMAC-SHA256(secret, 前两段)`
 *   - 密码指纹 = sha256(生效密码材料).slice(0,8)，改密后旧 Cookie 全部失效
 *   - 校验用 timingSafeEqual，过期/篡改/指纹不符均拒绝
 *
 * 防爆破：进程内存计数，同 IP 连错 AUTH_MAX_FAILS(5) 次锁 AUTH_LOCK_SECS(600) 秒。
 * ponytail: 内存锁定，重启进程即清零；公网单机个人应用够用，要多进程共享再上文件/DB
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS) || 30;
const MAX_FAILS = Number(process.env.AUTH_MAX_FAILS) || 5;
const LOCK_SECS = Number(process.env.AUTH_LOCK_SECS) || 600;

// ─── 项目根定位（与 network.js 同法：cwd 向上找标志文件） ───────────────

let _root = null;
function projectRoot() {
  if (_root) return _root;
  let dir = process.cwd();
  for (let i = 0; i <= 5; i++) {
    if (fs.existsSync(path.join(dir, "config", "network.json"))) return (_root = dir);
    dir = path.dirname(dir);
  }
  throw new Error(`找不到项目根（cwd=${process.cwd()}）`);
}

function authFilePath() {
  // AUTH_FILE 仅供测试指向临时文件，生产恒为 data/auth.json
  return process.env.AUTH_FILE || path.join(projectRoot(), "data", "auth.json");
}

// ─── 密码材料 ───────────────────────────────────────────────────────────

/** 返回 { hash, material }：hash 为生效密码的 sha256 hex；material 为指纹原料 */
export function loadEffectivePassword() {
  try {
    const stored = JSON.parse(fs.readFileSync(authFilePath(), "utf-8"));
    if (stored?.passwordHash) return { hash: stored.passwordHash, material: stored.passwordHash };
  } catch { /* 无 auth.json，走 env */ }
  const envPwd = process.env.AUTH_PASSWORD || "";
  if (!envPwd) return null;
  return { hash: sha256(envPwd), material: envPwd };
}

export function isAuthConfigured() {
  return loadEffectivePassword() !== null;
}

export function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** 定长比较（长度不同也走 timingSafeEqual，防长度泄漏） */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  const pad = Math.max(ba.length, bb.length);
  const pa = Buffer.concat([ba, Buffer.alloc(pad - ba.length)]);
  const pb = Buffer.concat([bb, Buffer.alloc(pad - bb.length)]);
  return ba.length === bb.length && crypto.timingSafeEqual(pa, pb);
}

/** 校验登录密码输入 */
export function verifyPassword(input) {
  const eff = loadEffectivePassword();
  if (!eff) return false;
  return safeEqual(sha256(String(input)), eff.hash);
}

/** 改密：写 data/auth.json（sha256 hash 存储） */
export function changePassword(newPassword) {
  const p = authFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ passwordHash: sha256(String(newPassword)), updatedAt: new Date().toISOString() }, null, 2));
}

// ─── Token 签发 / 校验 ──────────────────────────────────────────────────

function fingerprint(material) {
  return sha256(material).slice(0, 8);
}

export function signToken(secret, { days = SESSION_DAYS } = {}) {
  const eff = loadEffectivePassword();
  if (!eff) throw new Error("AUTH_PASSWORD 未配置");
  if (!secret) throw new Error("AUTH_SECRET 未配置");
  const expiresAt = Date.now() + days * 24 * 3600 * 1000;
  const fp = fingerprint(eff.material);
  const sig = crypto.createHmac("sha256", secret).update(`${expiresAt}.${fp}`).digest("hex");
  return `${expiresAt}.${fp}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const parts = String(token).split(".");
  if (parts.length !== 3) return false;
  const [expiresAt, fp, sig] = parts;
  if (Number(expiresAt) < Date.now()) return false;
  const eff = loadEffectivePassword();
  if (!eff || fp !== fingerprint(eff.material)) return false; // 改密后旧 token 失效
  const expect = crypto.createHmac("sha256", secret).update(`${expiresAt}.${fp}`).digest("hex");
  return safeEqual(sig, expect);
}

// ─── 防爆破（进程内存） ─────────────────────────────────────────────────

const fails = new Map(); // ip → { count, lockUntil }

/** 返回 null=可尝试；number=剩余锁定秒数 */
export function checkThrottle(ip) {
  const rec = fails.get(ip);
  if (!rec) return null;
  if (rec.lockUntil > Date.now()) return Math.ceil((rec.lockUntil - Date.now()) / 1000);
  if (rec.lockUntil && rec.lockUntil <= Date.now()) fails.delete(ip);
  return null;
}

export function recordFailure(ip) {
  const rec = fails.get(ip) || { count: 0, lockUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_FAILS) {
    rec.lockUntil = Date.now() + LOCK_SECS * 1000;
    rec.count = 0;
  }
  fails.set(ip, rec);
}

export function resetThrottle(ip) {
  fails.delete(ip);
}

export function clientIp(req) {
  const xff = req.headers?.get?.("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : "") || "local";
}
