/**
 * 公网访问基址推导（单一真相源）
 * ============================================================================
 * 优先级：PUBLIC_BASE 环境变量（去尾斜杠）> config/network.json 推导：
 *   - hosts.public 是 IP（数字开头）→ http://<IP>:<ports.aiChat.prodProxy>
 *   - 否则（域名 / ts.net）→ https://<hosts.public>
 * 供无请求上下文的服务端进程使用（tasks 推送链接 / MCP 博客链接 / prod.sh 回显）。
 * 浏览器端直接用 window.location.origin，更准。
 */
import { loadNetworkConfig } from "./network.js";

export function publicBase() {
  if (process.env.PUBLIC_BASE) return process.env.PUBLIC_BASE.replace(/\/+$/, "");
  const net = loadNetworkConfig();
  const pub = net.hosts.public;
  return /^\d+\./.test(pub)
    ? `http://${pub}:${net.ports.aiChat.prodProxy}`
    : `https://${pub}`;
}
