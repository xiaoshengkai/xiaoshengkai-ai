/**
 * video-generation 微调（tweak）：基于反馈重新生成脚本并升版本
 * 从 engine.js 迁入（原 tweakExecution）；cli `tweak-auto` 命令调用
 */

import path from "node:path";
import { createDateLogger } from "@app/shared/logger.js";
import { DATA_DIR, LOG_DIR, readState, writeState } from "../../../lib/state.js";
import { loadTemplate } from "../../../lib/executor.js";
import { evaluateSkipWhen } from "../../../lib/skip-when.js";
import { initScriptHistory, writeScriptVersion, TWEAK_LIMIT } from "./script-version.js";
import { tweakScript } from "./tweak-builder.js";

function resetSteps(state, template, params) {
  state.steps.forEach((step, i) => {
    if (step.id === "script") return;
    const shouldSkip = evaluateSkipWhen(template.steps[i]?.skipWhen, params);
    if (shouldSkip) {
      step.status = "skipped";
      step.skipReason = template.steps[i].skipWhen;
    } else {
      step.status = "pending";
      step.skipReason = null;
    }
    step.output = null;
    step.error = null;
    step.startedAt = null;
    step.elapsed = null;
  });
  state.status = "running";
  state.error = null;
}

export async function tweak(executionId) {
  const logger = createDateLogger("workflows", LOG_DIR, executionId);
  logger.info(`[tweak] 开始`);

  try {
    const dir = path.join(DATA_DIR, executionId);
    const state = readState(dir);
    const scriptStep = state.steps.find(s => s.id === "script");
    if (!scriptStep) {
      logger.error("[tweak] 未找到脚本步骤");
      return { ok: false, error: "未找到脚本步骤" };
    }

    const feedback = state.tweakTask?.feedback;
    if (!feedback) {
      logger.error("[tweak] 未找到 feedback");
      return { ok: false, error: "未找到 feedback" };
    }

    const images = state.tweakTask?.images || [];

    initScriptHistory(state, dir);

    const currentVer = state.currentScriptVersion ?? 0;

    if (state.tweakCount >= TWEAK_LIMIT) {
      logger.warn(`[tweak] 已达上限 (${state.tweakCount}/${TWEAK_LIMIT})`);
      return { ok: false, error: `已达到微调次数上限 (${state.tweakCount}/${TWEAK_LIMIT})` };
    }

    let originalScript;
    try {
      const out = typeof scriptStep.output === "string" ? JSON.parse(scriptStep.output) : scriptStep.output;
      originalScript = typeof out.script === "string" ? JSON.parse(out.script) : out.script;
    } catch (e) {
      logger.error(`[tweak] 解析原脚本失败: ${e.message}`);
      return { ok: false, error: "无法解析原脚本" };
    }

    // LLM 调用前：重置下游步骤状态 + 立即落盘
    const template = loadTemplate(state.template);
    resetSteps(state, template, state.params);
    scriptStep.status = "running";
    writeState(dir, state);
    logger.info(`[tweak] 状态已重置: render=${state.steps.find(s => s.id === "render")?.status}, bgm=${state.steps.find(s => s.id === "bgm")?.status}, tts=${state.steps.find(s => s.id === "tts")?.status}, state=${state.status}`);

    // 调用 LLM 微调
    logger.info(`[tweak] LLM 调用开始 (v${currentVer} → v${currentVer + 1})`);
    const tStart = Date.now();
    const tweaked = await tweakScript(originalScript, feedback, images);
    logger.info(`[tweak] LLM 调用完成 (${((Date.now() - tStart) / 1000).toFixed(1)}s)`);

    const newVersion = currentVer + 1;
    const newScript = JSON.parse(tweaked.script);

    // 保存新版本脚本
    writeScriptVersion(dir, newVersion, newScript);

    // 更新最新 output
    const newOutput = {
      script: tweaked.script,
      validated: true,
      stats: { sceneCount: newScript.scenes?.length || 0 },
      title: tweaked.title,
      bgm_prompt: tweaked.bgm_prompt,
      allHtml: tweaked.allHtml,
      allNarration: tweaked.allNarration,
      css: tweaked.css,
      jsAnimation: tweaked.jsAnimation,
      scenesJson: tweaked.scenesJson,
    };
    scriptStep.output = newOutput;
    scriptStep.status = "completed";
    logger.info("[tweak] 脚本已更新，scriptStep 状态恢复为 completed");

    // 更新历史
    state.scriptHistory.push({
      version: newVersion,
      at: new Date().toISOString(),
      feedback,
      videoFile: null,
    });
    state.currentScriptVersion = newVersion;
    state.tweakCount = (state.tweakCount || 0) + 1;

    writeState(dir, state);

    logger.info(`[tweak] 完成 v${newVersion} (${state.tweakCount}/${TWEAK_LIMIT})`);
    return { ok: true, version: newVersion, tweakCount: state.tweakCount };
  } catch (e) {
    logger.error(`[tweak] 失败: ${e.message}`);
    logger.error(`[tweak] stack: ${e.stack}`);
    return { ok: false, error: e.message };
  }
}
