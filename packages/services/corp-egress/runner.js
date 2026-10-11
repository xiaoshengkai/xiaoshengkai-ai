/**
 * 内网出口隧道服务（Mac 侧常驻）
 * ============================================================================
 *
 * 在公司内网的 Mac 上运行：把本机 SOCKS5 出口经反向 SSH 隧道暴露到云服务器：
 *
 *   服务器 127.0.0.1:<corpSocks> --SOCKS5--> 本机 --公司网络--> 内网资源
 *
 * 服务器侧 @app/shared/egress.js 命中白名单域名时走这个 SOCKS 出口。
 * 由本地 ai-chat 的服务监控启停；断线自动重连；自带 /health 供监控探测。
 *
 * 前提：Mac 能免密 ssh 到 DEPLOY_TARGET（同 deploy-common 的部署目标）。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSocksServer } from "./socks-server.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");

function readEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, ".env"), "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* ignore */
  }
  return "";
}

const network = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "config", "network.json"), "utf-8"));
const HOST = network.hosts.local;
const SOCKS_PORT = network.ports.corpSocks;
const HEALTH_PORT = network.ports.corpHealth;

const TARGET = readEnv("DEPLOY_TARGET");
const SSH_PORT = readEnv("DEPLOY_PORT") || "22";

if (!TARGET) {
  console.error("[corp-egress] 缺 DEPLOY_TARGET（.env），无法建立隧道");
  process.exit(1);
}

let child = null;
let stopping = false;
let socksUp = false;

function startTunnel() {
  const args = [
    "-N",
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    // 把服务器 127.0.0.1:<port> 反投到本机 SOCKS（由本机出网）
    "-R", `${HOST}:${SOCKS_PORT}:${HOST}:${SOCKS_PORT}`,
    "-p", SSH_PORT,
    TARGET,
  ];
  console.log(`[corp-egress] 启动隧道 → ${TARGET}（-R ${HOST}:${SOCKS_PORT} → 本机 SOCKS）`);
  child = spawn("ssh", args, { stdio: ["ignore", "inherit", "inherit"] });
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) return;
    console.warn(`[corp-egress] 隧道退出 code=${code} signal=${signal}，5s 后重连`);
    setTimeout(startTunnel, 5000);
  });
}

function stopTunnel() {
  stopping = true;
  if (child) child.kill("SIGTERM");
}

const health = http.createServer((req, res) => {
  if (req.url === "/health") {
    const up = socksUp && !!child && child.exitCode === null;
    res.writeHead(up ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: up ? "up" : "down", target: TARGET, socksPort: SOCKS_PORT, socks: socksUp }));
    return;
  }
  res.writeHead(404).end("not found");
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`[corp-egress] 收到 ${sig}，停止`);
    stopTunnel();
    health.close();
    setTimeout(() => process.exit(0), 300);
  });
}

// 先起本机 SOCKS（从本机出网），再建反向隧道把它暴露到服务器
createSocksServer({ host: HOST, port: SOCKS_PORT })
  .then(() => {
    socksUp = true;
    console.log(`[corp-egress] 本机 SOCKS5 已就绪 on ${HOST}:${SOCKS_PORT}`);
    startTunnel();
  })
  .catch((err) => {
    console.error(`[corp-egress] SOCKS 启动失败: ${err.message}`);
    process.exit(1);
  });

health.listen(HEALTH_PORT, HOST, () => {
  console.log(`[corp-egress] health on http://${HOST}:${HEALTH_PORT}/health`);
});
