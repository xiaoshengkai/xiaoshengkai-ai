/**
 * 公网访问基址推导（单一真相源）
 * ============================================================================
 * 优先级：
 *   1. PUBLIC_BASE 环境变量（整基址覆盖，去尾斜杠）
 *   2. DEPLOY_TARGET（user@host，剥 user@ 取 host）+ PUBLIC_PORT（缺省取 network.json prodProxy）
 *      host 是 IP（数字开头）→ http://<host>:<port>；域名 → https://<host>
 * 换云服务器 = 改 .env 的 DEPLOY_TARGET 一行（.env 经 sync.sh env 同步到服务器自身）。
 * 浏览器端直接用 window.location.origin，更准。
 */
import { loadNetworkConfig } from "./network.js";

export function publicBase() {
  if (process.env.PUBLIC_BASE) return process.env.PUBLIC_BASE.replace(/\/+$/, "");
  const target = process.env.DEPLOY_TARGET;
  if (!target) throw new Error("publicBase: 未配置 DEPLOY_TARGET（.env）或 PUBLIC_BASE");
  const hostPort = target.replace(/^[^@]+@/, "");
  const [host, portInTarget] = hostPort.split(":");
  const net = loadNetworkConfig();
  const port = portInTarget || process.env.PUBLIC_PORT || net.ports.aiChat.prodProxy;
  return /^\d+\./.test(host) ? `http://${host}:${port}` : `https://${host}`;
}
