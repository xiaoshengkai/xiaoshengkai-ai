/**
 * 浏览器通道传输（贝壳风控 node 客户端时的降级通道）
 *
 * 走 browser-harness 守护进程的 IPC 协议（AF_UNIX socket + JSON 行 + 原生 CDP 直通），
 * 复用守护进程已连接的 Chrome —— 零 spawn 开销，单页 ~1.5s。
 * socket 不存在时自动拉起守护进程（browser-harness 首次调用会 ensure_daemon）。
 *
 * 页面就绪判定：readyState ≥ interactive（贝壳列表/详情页为服务端渲染，
 * 不必等 load —— 图片资源会拖 1-3s）。
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sockPath() {
  return path.join(os.homedir(), ".config", "browser-harness", "runtime", "bu-default.sock");
}

function harnessBin() {
  const candidate = path.join(os.homedir(), ".local", "bin", "browser-harness");
  return fs.existsSync(candidate) ? candidate : "browser-harness";
}

/** socket 不存在 → 拉起守护进程并等待就绪 */
function ensureDaemon() {
  if (fs.existsSync(sockPath())) return;
  try {
    spawnSync(
      "bash",
      ["-c", `${harnessBin()} <<'PYEOF'\nprint("boot")\nPYEOF`],
      { timeout: 60000, stdio: "ignore" }
    );
  } catch { /* 下方等待判定 */ }
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(sockPath())) return;
    sleep(200);
  }
  throw new Error(
    "浏览器通道不可用：守护进程拉起失败（需 Chrome 运行，并在 chrome://inspect/#remote-debugging 点 Allow 允许远程调试）"
  );
}

function request(obj, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const s = net.connect(sockPath());
    let data = "";
    const timer = setTimeout(() => {
      s.destroy();
      reject(new Error("IPC 请求超时"));
    }, timeoutMs);
    s.on("connect", () => s.write(JSON.stringify(obj) + "\n"));
    s.on("data", (c) => {
      data += c;
      if (data.endsWith("\n")) {
        clearTimeout(timer);
        s.end();
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("IPC 响应解析失败"));
        }
      }
    });
    s.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * 抓取页面：导航 → 轮询 readyState 到 interactive → 提取 HTML/URL/标题
 * @returns {Promise<{html: string, url: string, title: string}>}
 */
export async function fetchPage(url) {
  ensureDaemon();
  const nav = await request({ method: "Page.navigate", params: { url }, session_id: null });
  if (nav.error) throw new Error(`IPC: ${nav.error}`);
  if (nav.result?.errorText) throw new Error(`导航失败: ${nav.result.errorText}`);

  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    await sleep(250);
    const r = await request({
      method: "Runtime.evaluate",
      params: { expression: "document.readyState", returnByValue: true },
      session_id: null,
    });
    const ready = r.result?.result?.value || "";
    if (ready === "interactive" || ready === "complete") break;
  }
  await sleep(250);

  const r2 = await request({
    method: "Runtime.evaluate",
    params: {
      expression:
        "JSON.stringify({html: document.documentElement.outerHTML, url: location.href, title: document.title})",
      returnByValue: true,
    },
    session_id: null,
  });
  const value = r2.result?.result?.value;
  if (!value) throw new Error("页面内容提取失败（守护进程返回空）");
  return JSON.parse(value);
}

/** 守护进程标签页复用，无需清理 */
export async function closeBrowserTransport() {}
