/**
 * 隐私红线工具：原始手机号只存 private.json（任务目录内、导出报告不带出），
 * 所有落盘文本经 redactPhone 过滤，报告中只允许出现脱敏形式。
 */
import fs from "node:fs";
import path from "node:path";

const CN_PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const CN_MOBILE_RE = /^(?:\+?86)?1[3-9]\d{9}$/;

/** 非法/占位符输入归一为空串；合法手机号（可带 +86/横线）归一为 11 位裸数字 */
export function normalizePhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return CN_MOBILE_RE.test(digits) ? digits.slice(-11) : "";
}

export function redactPhone(text) {
  if (text == null) return text;
  return String(text).replace(CN_PHONE_RE, m => `1****${m.slice(-4)}`);
}

export function phoneTail(phone) {
  const p = String(phone || "").replace(/\D/g, "");
  return p ? p.slice(-4) : "";
}

export function savePrivate(executionDir, data) {
  fs.writeFileSync(path.join(executionDir, "private.json"), JSON.stringify(data, null, 2));
}

export function readPrivate(executionDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(executionDir, "private.json"), "utf-8"));
  } catch {
    return {};
  }
}
