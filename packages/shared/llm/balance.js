import crypto from "node:crypto";
import { getApiKey, getBaseUrl, getAccessKey, getSecretKey } from "./config.js";
import { callLLM as callMiniMax } from "./providers/minimax.js";
import { callLLM as callGLM } from "./providers/glm.js";
import { callLLM as callQwen } from "./providers/qwen.js";

/**
 * 模型概况 — 余额/可用性查询（差异抹平单点）
 *
 * 归一化返回：
 *   { provider, status: "ok"|"error"|"unknown", available: boolean|null, balanceText?, note?, error? }
 *
 * - deepseek   : GET /user/balance（真实余额）
 * - volcengine : POST GetAFPUsage（HMAC-SHA256 签名，日/月免费包额度）
 * - minimax/qwen/glm : 无主动余额接口，探测 chat 模型（1 token ping，报错即欠费/异常）
 */

const PROBE_TIMEOUT_MS = 15000;

const HTTP_DESC = {
  401: "API Key 无效或已过期",
  403: "无访问权限或余额不足",
  404: "模型不存在或端点不支持",
  429: "请求限流或额度超限",
  500: "服务端错误",
  502: "网关错误",
  503: "服务不可用",
};

function describeError(msg) {
  const m = String(msg).match(/\((\d{3})\)|HTTP\s*(\d{3})/);
  const code = Number(m?.[1] || m?.[2]);
  if (!code) return msg;
  return `${HTTP_DESC[code] || "请求失败"} (HTTP ${code})`;
}

const sha256Hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d, "utf8").digest();

function probeWithTimeout(fn) {
  return Promise.race([
    fn(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("探测超时")), PROBE_TIMEOUT_MS)),
  ]);
}

/** 无主动余额接口的 provider：发 1-token ping 探测 chat 模型，报错即不可用 */
async function probeChat(provider, caller) {
  const apiKey = getApiKey(provider, `${provider.toUpperCase()}_API_KEY`);
  if (!apiKey) return { status: "unknown", available: null, note: "未配置 API Key" };
  try {
    await probeWithTimeout(() => caller({ user: "ping", maxTokens: 1, format: "", temperature: 0 }));
    return { status: "ok", available: true, note: "探测通过" };
  } catch (e) {
    return { status: "error", available: false, error: describeError(e.message) };
  }
}

async function deepseekBalance() {
  const apiKey = getApiKey("deepseek", "DEEPSEEK_API_KEY");
  if (!apiKey) return { status: "unknown", available: null, note: "未配置 API Key" };
  const base = getBaseUrl("deepseek", "DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").replace(/\/v1\/?$/, "");
  const res = await fetch(`${base}/user/balance`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) return { status: "error", available: null, error: describeError(`HTTP ${res.status}`) };
  const data = await res.json();
  const infos = data.balance_infos || [];
  const available = data.is_available === true;
  const balanceText = infos.map((i) => `${i.currency} ${i.total_balance}`).join(" · ") || "0";
  return { status: "ok", available, balanceText, note: available ? "可用" : "余额不足" };
}

// 火山方舟 GetAFPUsage（签名 V4）
async function volcengineBalance() {
  const ak = getAccessKey("volcengine", "VOLCENGINE_ACCESS_KEY");
  const sk = getSecretKey("volcengine", "VOLCENGINE_SECRET_KEY");
  if (!ak || !sk) return { status: "unknown", available: null, note: "未配置 AK/SK" };

  const region = "cn-beijing";
  const service = "ark";
  const host = "ark.cn-beijing.volcengineapi.com";
  const query = "Action=GetAFPUsage&Version=2024-01-01";
  const body = "{}";
  const payloadHash = sha256Hex(body);
  const xdate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = xdate.slice(0, 8);
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = `POST\n/\n${query}\ncontent-type:application/json\nhost:${host}\nx-content-sha256:${payloadHash}\nx-date:${xdate}\n\n${signedHeaders}\n${payloadHash}`;
  const stringToSign = `HMAC-SHA256\n${xdate}\n${date}/${region}/${service}/request\n${sha256Hex(canonicalRequest)}`;
  const kDate = hmac(sk, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  const auth = `HMAC-SHA256 Credential=${ak}/${date}/${region}/${service}/request, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}/?${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: host,
      "X-Date": xdate,
      "X-Content-Sha256": payloadHash,
      Authorization: auth,
    },
    body,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok || !data.Result) {
    return { status: "error", available: null, error: describeError(`HTTP ${res.status}`) };
  }
  const daily = data.Result.AFPDaily || {};
  const monthly = data.Result.AFPMonthly || {};
  const dRem = Number(daily.Quota || 0) - Number(daily.Used || 0);
  const mRem = Number(monthly.Quota || 0) - Number(monthly.Used || 0);
  const available = dRem > 0 && mRem > 0;
  return {
    status: "ok",
    available,
    balanceText: `日 ${daily.Used}/${daily.Quota} · 月 ${monthly.Used}/${monthly.Quota}`,
    note: available ? "可用" : "免费包额度耗尽",
  };
}

const FETCHERS = {
  deepseek: deepseekBalance,
  minimax: () => probeChat("minimax", callMiniMax),
  glm: () => probeChat("glm", callGLM),
  qwen: () => probeChat("qwen", callQwen),
  volcengine: volcengineBalance,
};

export async function fetchBalance(provider) {
  const fn = FETCHERS[provider];
  if (!fn) return { provider, status: "unknown", available: null, note: "未知 provider" };
  try {
    return { provider, ...(await fn()) };
  } catch (e) {
    return { provider, status: "error", available: null, error: e.message };
  }
}

export async function fetchAllBalances(providers = Object.keys(FETCHERS)) {
  return Promise.all(providers.map((p) => fetchBalance(p)));
}
