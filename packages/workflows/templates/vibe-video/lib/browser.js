/**
 * Chromium 可执行文件发现（渲染器与 html 冒烟共用）：
 * ~/.cache/puppeteer 下递归找 chrome / chrome-headless-shell（mac .app 与 linux 布局都覆盖），
 * env VIBE_CHROME_PATH 可覆盖；最后回退系统 Chrome。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAC_EXEC_RE = /^Google Chrome( for Testing)?\.app$/;

export function findChromeExecutable() {
  if (process.env.VIBE_CHROME_PATH && fs.existsSync(process.env.VIBE_CHROME_PATH)) {
    return process.env.VIBE_CHROME_PATH;
  }
  const cacheRoot = path.join(os.homedir(), ".cache", "puppeteer");
  const found = [];

  function walk(dir, depth) {
    if (depth > 5 || found.length > 0) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (MAC_EXEC_RE.test(e.name)) {
          const exec = path.join(p, "Contents", "MacOS", e.name.replace(/\.app$/, ""));
          if (fs.existsSync(exec)) { found.push(exec); return; }
        } else if (e.name !== "tmp") {
          walk(p, depth + 1);
        }
      } else if (e.isFile() && (e.name === "chrome" || e.name === "chrome-headless-shell")) {
        try { fs.accessSync(p, fs.constants.X_OK); found.push(p); } catch { /* 无执行权限跳过 */ }
      }
      if (found.length > 0) return;
    }
  }

  if (fs.existsSync(cacheRoot)) walk(cacheRoot, 0);
  if (found.length > 0) {
    /* chrome 完整版优先于 headless-shell（画布渲染一致性更好） */
    found.sort((a, b) => (a.includes("headless-shell") ? 1 : 0) - (b.includes("headless-shell") ? 1 : 0));
    return found[0];
  }

  for (const sys of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ]) {
    if (fs.existsSync(sys)) return sys;
  }
  throw new Error("未找到 Chromium（~/.cache/puppeteer 无缓存、VIBE_CHROME_PATH 未设置、系统无 Chrome）——先安装 puppeteer 浏览器缓存");
}
