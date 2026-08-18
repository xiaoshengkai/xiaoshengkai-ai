/**
 * Chroma 服务器生命周期管理
 * ============================================================================
 *
 * 职责:
 *   1. 检测 Chroma HTTP 服务(:8000)是否已就绪
 *   2. 若未就绪,以子进程方式拉起 `chroma run --path <dataDir> --port 8000`
 *   3. 等待健康检查通过(超时 30s)
 *   4. 提供幂等的 `ensureChromaRunning()`,可在多处重复调用
 *
 * 调用入口:`src/instrumentation.ts` 在 Next.js 服务启动时调用一次,
 * 此后所有 Chroma 操作都假定 :8000 已就绪。
 *
 * 设计要点:
 *   - 单例模式:整个 Node 进程共享一个 `chromaProcess` 引用。
 *   - 懒检测:`isChromaHealthy()` 走 HTTP heartbeat,1s 超时,极轻量。
 *   - 不强制独占:外部若已手动 `chroma run`,我们也直接复用,不重复拉起。
 *   - 失败快速反馈:启动超过 30s 直接抛错,不让 Next.js 卡在启动阶段。
 * ============================================================================
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { env } from "../utils/env"
import { loadNetworkConfig } from "@shared/network.js"

// 从 config/network.json 读 chroma host+port（共享读取器）
const NET_CONFIG = loadNetworkConfig();
const CHROMA_HOST = NET_CONFIG.hosts.local;
const CHROMA_PORT = NET_CONFIG.ports.chroma;

// ─── 常量(集中配置,便于阅读与调整) ──────────────────────────────────────

/** 启动超时上限(毫秒)。超过此时间视为启动失败。 */
const STARTUP_TIMEOUT_MS = 30_000;

/** 每次健康检查之间的轮询间隔(毫秒)。 */
const HEALTH_CHECK_INTERVAL_MS = 1_000;

/** 单次健康检查的 HTTP 超时(毫秒)。 */
const HEALTH_CHECK_TIMEOUT_MS = 1_000;

/** Chroma 持久化数据目录名,位于项目 `data/` 下。 */
const CHROMA_DATA_DIR = "chroma";

/**
 * 环境变量 `CHROMA_AUTO_START` 控制是否启用自动启动。
 * 设置为 `"false"` 时,需用户手动启动 Chroma(便于 Docker 等外部管理场景)。
 */
const AUTO_START_ENV = "CHROMA_AUTO_START";

/** Chroma CLI 命令名(由 `uv tool install chromadb` 安装到 PATH)。 */
const CHROMA_CLI = "chroma";

/**
 * Chroma healthcheck 端点(Chroma 1.x 升级为 v2 API)。
 * GET /api/v2/heartbeat 返回 200 + nanosecond 心跳时间戳即视为存活。
 */
const HEALTHCHECK_PATH = "/api/v2/heartbeat";

// ─── 模块级状态(单例) ─────────────────────────────────────────────────

/** 当前 Node 进程持有的 Chroma 子进程引用(若由本模块拉起)。 */
let chromaProcess: ChildProcess | null = null;

/** 标记是否正在拉起中(避免并发调用重复 spawn)。 */
let startingPromise: Promise<void> | null = null;

// ─── 工具函数 ──────────────────────────────────────────────────────────

/**
 * 解析 Chroma HTTP base URL。
 * `env.CHROMA_URL` 从 config/network.json 拼装（hosts.local + ports.chroma）。
 */
function getChromaBaseUrl(): string {
  return env.CHROMA_URL;
}

/**
 * 解析 Chroma 持久化目录绝对路径。
 * 默认 `<cwd>/data/chroma`,与 .gitignore 一致。
 */
function getChromaDataDir(): string {
  return resolve(process.cwd(), "..", "..", "data", CHROMA_DATA_DIR);
}

/**
 * 探测 Chroma HTTP 服务是否存活。
 * 通过 GET /api/v1/heartbeat 判断,1s 超时。
 */
async function isChromaHealthy(): Promise<boolean> {
  const url = `${getChromaBaseUrl()}${HEALTHCHECK_PATH}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 启动 Chroma 子进程并等待其就绪。
 * - 若数据目录不存在则创建。
 * - 通过 `stdio: ["ignore", "pipe", "pipe"]` 把 stdout/stderr 接住,便于排查。
 * - 启动后把日志前缀化输出(标识 "chroma-server")。
 */
function spawnChromaProcess(): Promise<void> {
  return new Promise((resolve, reject) => {
    const dataDir = getChromaDataDir();
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    const args = [
      "run",
      "--path", dataDir,
      "--host", CHROMA_HOST,
      "--port", String(CHROMA_PORT),
    ];

    console.log(`[chroma-server] 启动子进程: ${CHROMA_CLI} ${args.join(" ")}`);

    const child = spawn(CHROMA_CLI, args, {
      stdio: ["ignore", "pipe", "pipe"],
      // 不 detached:父进程退出时 Chroma 也跟着退,避免僵尸进程。
      detached: false,
    });

    chromaProcess = child;

    // 把 Chroma 的 stdout/stderr 前缀化输出,便于与 Next.js 日志区分。
    child.stdout?.on("data", (chunk) => {
      process.stdout.write(`[chroma-server] ${chunk}`);
    });
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(`[chroma-server] ${chunk}`);
    });

    // 子进程异常退出(还未就绪)直接拒绝。
    child.on("error", (err) => {
      reject(new Error(`Chroma 子进程启动失败: ${err.message}`));
    });

    child.on("exit", (code, signal) => {
      // 只有在未 resolve 的情况下(启动期间退出)才算失败;运行中退出由 OS/外部管理。
      if (startingPromise) {
        reject(new Error(`Chroma 子进程异常退出(code=${code}, signal=${signal})`));
      }
      chromaProcess = null;
    });

    // 轮询健康检查直到就绪或超时。
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    const poll = async () => {
      while (Date.now() < deadline) {
        if (await isChromaHealthy()) {
          console.log(`[chroma-server] 就绪: ${getChromaBaseUrl()}`);
          resolve();
          return;
        }
        await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
      }
      reject(new Error(`Chroma 启动超时(${STARTUP_TIMEOUT_MS / 1000}s),请检查 [chroma-server] 日志`));
    };

    poll().catch(reject);
  });
}

// ─── 公开 API ──────────────────────────────────────────────────────────

/**
 * 确保 Chroma 服务在 :8000 可用。幂等,可在多处重复调用。
 *
 * 行为:
 *   1. 健康检查通过 → 直接返回(可能外部已在跑,如手动 `chroma run`)。
 *   2. 健康检查失败 → 检查 `CHROMA_AUTO_START`,禁用则抛错让用户手动处理。
 *   3. 启用自动启动 → 拉起子进程并等待就绪(最多 30s)。
 *   4. 并发安全:同时多次调用只 spawn 一次,后续调用 await 同一 Promise。
 */
export async function ensureChromaRunning(): Promise<void> {
  // 情况 1:已经健康,直接返回。
  if (await isChromaHealthy()) {
    return;
  }

  // 情况 2:已在启动中,等待现有 Promise 结束(并发安全)。
  if (startingPromise) {
    return startingPromise;
  }

  // 情况 3:不健康且未在启动,先检查是否禁用自动启动。
  const autoStart = process.env[AUTO_START_ENV] !== "false";
  if (!autoStart) {
    throw new Error(
      `Chroma 不可达(${getChromaBaseUrl()})且 ${AUTO_START_ENV}=false,` +
        `请手动执行: ${CHROMA_CLI} run --path ${getChromaDataDir()} --port ${CHROMA_PORT}`,
    );
  }

  // 情况 4:拉起子进程(并发安全:多个 await 共享同一 Promise)。
  startingPromise = spawnChromaProcess();

  try {
    await startingPromise;
  } finally {
    // 无论成功失败都清空,失败时下一次调用可以重试。
    startingPromise = null;
  }
}