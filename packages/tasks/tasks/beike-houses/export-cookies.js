#!/usr/bin/env node
/**
 * 贝壳 Cookie 一键续期（Mac 侧）
 *
 * 用法：先在 Chrome 登录 sx.ke.com，然后运行：
 *   node packages/tasks/tasks/beike-houses/export-cookies.js
 *
 * 原理：browser-harness 经 CDP 连接本机 Chrome → Storage.getCookies →
 *       提取 ke.com 域 Cookie → 写入 data/beike-houses/cookies.json（gitignored）
 * 说明：任务每次运行都会合并响应 Set-Cookie 自动续期（等同浏览器日常访问保活），
 *       仅当会话彻底过期（任务报 LOGIN_WALL）时才需要跑本脚本重新导出。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.resolve(__dirname, "..", "..", "..", "..", "data", "beike-houses", "cookies.json");

const PY = `
import json
cookies = cdp("Storage.getCookies")
ck = [c for c in cookies.get("cookies", []) if "ke.com" in c.get("domain", "")]
out = {c["name"]: c["value"] for c in ck}
open(${JSON.stringify(COOKIE_FILE)}, "w").write(json.dumps(out, indent=2))
print(json.dumps({"count": len(out), "auth": "lianjia_token" in out}))
`;

/** browser-harness 可执行位置（cron 环境可能无 ~/.local/bin） */
function harnessBin() {
  const home = process.env.HOME || "";
  const candidate = path.join(home, ".local", "bin", "browser-harness");
  return fs.existsSync(candidate) ? candidate : "browser-harness";
}

async function main() {
  console.log("[export-cookies] 经 browser-harness 连接本机 Chrome 提取贝壳 Cookie…");
  console.log("[export-cookies] 前提：Chrome 已登录 sx.ke.com（首次需按提示开启远程调试）");

  let info;
  try {
    const { stdout } = await execFileAsync(
      "bash",
      ["-c", `${harnessBin()} <<'PYEOF'\n${PY}\nPYEOF`],
      { timeout: 90000 }
    );
    const line = stdout.trim().split("\n").filter(Boolean).pop() || "";
    info = JSON.parse(line);
  } catch (err) {
    console.error("[export-cookies] 导出失败:", err.message);
    console.error("排查：1) Chrome 是否在运行且已登录 sx.ke.com；2) browser-harness --doctor");
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
  console.log(`[export-cookies] 已导出 ${info.count} 个 ke.com Cookie → ${COOKIE_FILE}`);
  if (!info.auth) {
    console.error("[export-cookies] ⚠ 未发现 lianjia_token（登录态缺失）：请先在 Chrome 完成 sx.ke.com 登录后重跑");
    process.exitCode = 1;
    return;
  }

  // 连通性自检：区分「登录墙」（clogin 302）与「IP 限流」（captcha 302）
  const jar = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
  const res = await fetch("https://sx.ke.com/ershoufang/", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
    },
    redirect: "manual",
  });
  const location = res.headers.get("location") || "";
  if (res.status === 200) {
    console.log("[export-cookies] ✓ 连通性自检通过（列表页 200），Cookie 有效");
  } else if (location.includes("clogin")) {
    console.error("[export-cookies] ✗ 登录态未生效（跳转登录页）：请确认 Chrome 已登录 sx.ke.com 后重跑");
    process.exitCode = 1;
  } else if (location.includes("captcha")) {
    console.log("[export-cookies] ✓ Cookie 已导出；当前 IP 被贝壳临时限流（CAPTCHA），不影响登录态，稍后自动恢复");
  } else {
    console.error(`[export-cookies] ⚠ 自检异常（HTTP ${res.status}），建议稍后重跑验证`);
    process.exitCode = 1;
  }
}

main();
