/**
 * browser-harness 守护进程 IPC 传输（浏览器通道降级的最终实现）
 *
 * 背景：贝壳按 IP+客户端指纹风控——node fetch 被拒时真实 Chrome 常仍通行。
 * 直连 Chrome 浏览器级 WS 会被 M144+「允许远程调试」弹窗挂起（新连接握手超时），
 * 而 browser-harness 守护进程的既有连接始终可用 → 本模块直接说守护进程的
 * IPC 协议（AF_UNIX socket + JSON 行 + 原生 CDP 直通），零 spawn 开销。
 *
 * 协议：connect(sock) → send {"method","params","session_id"}\n → recv {"result"}\n
 * 页面就绪判定：readyState ≥ interactive（贝壳列表/详情页均为服务端渲染，
 * 不必等 load——图片资源会拖 1-3s）。
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sockPath() {
  const p = path.join(os.homedir(), ".config", "browser-harness", "runtime", "bu-default.sock");
  if (!fs.existsSync(p)) {
    throw new Error("browser-harness 守护进程未运行（socket 不存在）");
  }
  return p;
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
        } catch (e) {
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

export class BrowserIPC {
  /**
   * 抓取页面：导航 → 轮询 readyState 到 interactive → 提取 HTML/URL/标题
   * @returns {Promise<{html: string, url: string, title: string}>}
   */
  async fetchPage(url) {
    const nav = await request({ method: "Page.navigate", params: { url }, session_id: null });
    if (nav.error) throw new Error(`IPC: ${nav.error}`);
    if (nav.result?.errorText) throw new Error(`导航失败: ${nav.result.errorText}`);

    const t0 = Date.now();
    let ready = "";
    while (Date.now() - t0 < 15000) {
      await sleep(250);
      const r = await request({
        method: "Runtime.evaluate",
        params: { expression: "document.readyState", returnByValue: true },
        session_id: null,
      });
      ready = r.result?.result?.value || "";
      if (ready === "interactive" || ready === "complete") break;
    }
    await sleep(250); // 渲染稳定

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
    if (!value) throw new Error("页面内容提取失败");
    return JSON.parse(value);
  }

  /** 守护进程标签页复用，无需清理 */
  async close() {}
}
