/**
 * Next.js 16 instrumentation 入口
 * ============================================================================
 *
 * Next.js 在服务器启动时会调用本文件的 `register()`(每个 Node 进程一次)。
 * 在这里拉起 Chroma,确保后续所有请求都能直接拿到 :8000 可用服务。
 *
 * Edge runtime 不需要 Chroma,因此守卫 `NEXT_RUNTIME === "nodejs"`。
 *
 * 关于 Next.js 16:
 *   - 不需要在 next.config.ts 显式开启 instrumentationHook(15+ 已默认开启)
 *   - 仅在 Node 运行时执行,Edge/浏览器构建会被跳过
 * ============================================================================
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@shared/logger.js";

// ─── 日志系统 ───
createLogger("NEXT", path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "logs", "app"));

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // ponytail: 启动时初始化 settings（selection.json + providers.json）— 保证 dispatcher 永远能拿到配置（2026-08-19）
  const { initSettings } = await import("@/lib/settings/init");
  initSettings();

  const { ensureChromaRunning } = await import("@/lib/rag/chroma-server");
  await ensureChromaRunning();
}