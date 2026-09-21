import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 环境变量必须在 import auth.js 前就位（MAX_FAILS 等在模块加载时读取）
const TMP = path.join(os.tmpdir(), `auth-test-${process.pid}.json`);
process.env.AUTH_FILE = TMP;
process.env.AUTH_PASSWORD = "env-secret-123";
process.env.AUTH_MAX_FAILS = "3";

const {
  verifyPassword, changePassword, signToken, verifyToken,
  safeEqual, checkThrottle, recordFailure, resetThrottle, isAuthConfigured,
} = await import("../auth.js");

const SECRET = "test-secret-key";

test("safeEqual: 等值 true / 不等与异长 false", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false);
});

test("env 密码兜底：verifyPassword / isAuthConfigured", () => {
  fs.rmSync(TMP, { force: true });
  assert.equal(isAuthConfigured(), true);
  assert.equal(verifyPassword("env-secret-123"), true);
  assert.equal(verifyPassword("wrong"), false);
});

test("token 签发/校验/篡改/过期/错密钥", () => {
  const token = signToken(SECRET);
  assert.equal(verifyToken(token, SECRET), true);
  assert.equal(verifyToken(token, "other-secret"), false);
  assert.equal(verifyToken(token.slice(0, -2) + "xx", SECRET), false); // 篡改签名
  assert.equal(verifyToken("1.2.3", SECRET), false); // 结构合法但过期+指纹错
  const expired = signToken(SECRET, { days: -1 });
  assert.equal(verifyToken(expired, SECRET), false);
});

test("changePassword: 新密码生效、旧密码失效、旧 token 全失效", () => {
  fs.rmSync(TMP, { force: true });
  const oldToken = signToken(SECRET);
  changePassword("new-secret-456");
  assert.equal(verifyPassword("new-secret-456"), true);
  assert.equal(verifyPassword("env-secret-123"), false); // auth.json 优先于 env
  assert.equal(verifyToken(oldToken, SECRET), false); // 指纹变化 → 踢掉旧会话
  assert.equal(verifyToken(signToken(SECRET), SECRET), true);
  fs.rmSync(TMP, { force: true });
});

test("防爆破: 连错 3 次锁定，reset 解锁", () => {
  resetThrottle("1.2.3.4");
  assert.equal(checkThrottle("1.2.3.4"), null);
  recordFailure("1.2.3.4");
  recordFailure("1.2.3.4");
  assert.equal(checkThrottle("1.2.3.4"), null);
  recordFailure("1.2.3.4"); // 第 3 次 → 锁定
  const locked = checkThrottle("1.2.3.4");
  assert.ok(typeof locked === "number" && locked > 0, `应锁定，实际 ${locked}`);
  resetThrottle("1.2.3.4");
  assert.equal(checkThrottle("1.2.3.4"), null);
});
