/**
 * tweak 全流程编排：写 running → 模板 tweak（LLM 升版本）→ auto 重跑 → done/failed
 * 从 ai-chat app/api/workflows/execution/[id]/tweak 路由迁入
 * cli `tweak-auto` 命令调用（detached 子进程内执行）
 */

import path from "node:path";
import { createDateLogger } from "@app/shared/logger.js";
import { DATA_DIR, LOG_DIR, readState, writeState } from "./state.js";

const TWEAK_TIMEOUT_MS = 600_000;

function setTweakStatus(executionId, status, error) {
  try {
    const dir = path.join(DATA_DIR, executionId);
    const state = readState(dir);
    state.tweakTask = {
      ...state.tweakTask,
      status,
      completedAt: new Date().toISOString(),
      error: error || null,
    };
    writeState(dir, state);
  } catch { /* ignore */ }
}

export async function tweakAuto(executionId, feedback, images, pages, mode) {
  const logger = createDateLogger("workflows", LOG_DIR, executionId);

  const dir = path.join(DATA_DIR, executionId);
  const state = readState(dir);
  state.tweakTask = {
    status: "running",
    feedback,
    images: images || [],
    pages: pages || [],
    mode: mode || "ai",
    startedAt: new Date().toISOString(),
    completedAt: null,
    version: null,
    error: null,
  };
  writeState(dir, state);

  let tweakMod;
  try {
    tweakMod = await import(`../templates/${state.template}/lib/tweak.js`);
  } catch {
    setTweakStatus(executionId, "failed", "该模板不支持微调");
    logger.error("[tweak-auto] 该模板不支持微调: " + state.template);
    return { ok: false, error: "该模板不支持微调" };
  }

  if (mode === "replace") {
    const page = pages?.[0];
    const image = images?.[0];
    const data = tweakMod.replaceComicPage?.(dir, page, image);
    if (!data?.ok) {
      setTweakStatus(executionId, "failed", data?.error || "replace failed");
      return { ok: false, error: data?.error };
    }
    setTweakStatus(executionId, "done");
    logger.info(`[tweak-auto] replaced page ${page}: ${data.file}`);
    return { ok: true };
  }

  try {
    // unref 定时器：tweak 完成后不阻止子进程退出
    const data = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("tweak timeout after 10 min")), TWEAK_TIMEOUT_MS);
      t.unref();
      tweakMod.tweak(executionId).then(resolve, reject);
    });

    if (!data?.ok) {
      setTweakStatus(executionId, "failed", data?.error || "tweak failed");
      logger.error(`[tweak-auto] tweak failed: ${data?.error}`);
      return { ok: false, error: data?.error };
    }

    const fresh = readState(dir);
    fresh.tweakTask = {
      status: "completed",
      completedAt: new Date().toISOString(),
      version: data.version,
      error: null,
      feedback,
      images: images || [],
      pages: pages || [],
      mode: mode || "ai",
    };
    writeState(dir, fresh);

    // rerun=false：模板 tweak 已直接重生成产物（如漫画图生图），无需重跑步骤
    if (data.rerun === false) {
      setTweakStatus(executionId, "done");
      logger.info("[tweak-auto] tweak completed (rerun=false), skip auto");
      return { ok: true };
    }

    logger.info(`[tweak-auto] tweak completed v${data.version}, starting auto...`);

    const { runAllSteps } = await import("../engine.js");
    try {
      const autoResult = await runAllSteps(executionId);
      if (autoResult?.ok) {
        setTweakStatus(executionId, "done");
        logger.info("[tweak-auto] auto completed, render done");
      } else {
        setTweakStatus(executionId, "failed", autoResult?.error || "auto failed");
        logger.error(`[tweak-auto] auto failed: ${autoResult?.error}`);
      }
      return autoResult;
    } catch (err) {
      setTweakStatus(executionId, "failed", `auto error: ${err.message}`);
      logger.error(`[tweak-auto] auto error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  } catch (err) {
    setTweakStatus(executionId, "failed", err.message);
    logger.error(`[tweak-auto] background tweak failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
