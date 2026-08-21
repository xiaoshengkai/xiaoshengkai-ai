/**
 * video-generation 脚本版本切换
 * 从 engine.js 迁入（原 switchScriptVersion）；cli `switch-version` 命令按模板分发调用
 */

import fs from "node:fs";
import path from "node:path";
import { createDateLogger } from "@app/shared/logger.js";
import { DATA_DIR, LOG_DIR, readState, writeState } from "../../../lib/state.js";
import { initScriptHistory, readScriptVersion } from "./script-version.js";

export function switchVersion(executionId, version) {
  const logger = createDateLogger("workflows", LOG_DIR, executionId);
  logger.info(`[switch] 开始 v${version}`);

  try {
    const dir = path.join(DATA_DIR, executionId);
    const state = readState(dir);
    const scriptStep = state.steps.find(s => s.id === "script");
    if (!scriptStep) {
      logger.error("[switch] 未找到脚本步骤");
      return { ok: false, error: "未找到脚本步骤" };
    }

    initScriptHistory(state, dir);

    const history = state.scriptHistory || [];
    const entry = history.find(h => h.version === version);
    if (!entry) {
      logger.error(`[switch] v${version} 不存在`);
      return { ok: false, error: `版本 v${version} 不存在` };
    }

    // 读取历史脚本
    let newScript;
    try {
      newScript = readScriptVersion(dir, version);
    } catch (e) {
      logger.error(`[switch] 无法读取 v${version}.json: ${e.message}`);
      return { ok: false, error: `无法读取 v${version}.json` };
    }

    // 更新 output
    const newOutput = {
      script: JSON.stringify(newScript, null, 2),
      validated: true,
      stats: { sceneCount: newScript.scenes?.length || 0 },
      title: newScript.title,
      bgm_prompt: newScript.bgm_prompt,
      allHtml: newScript.scenes?.map(s => s.html).join("\n") || "",
      allNarration: newScript.scenes?.map(s => s.narration).join("\n") || "",
      css: newScript.css || "",
      jsAnimation: newScript.jsAnimation || "",
      scenesJson: JSON.stringify(newScript.scenes || []),
    };
    scriptStep.output = newOutput;

    state.currentScriptVersion = version;
    writeState(dir, state);

    // 复制对应版本视频到 output.mp4 / output-silent.mp4
    if (entry.videoFile) {
      const sourceVideo = path.join(dir, entry.videoFile);
      if (fs.existsSync(sourceVideo)) {
        const outputMp4 = path.join(dir, "output.mp4");
        const silentMp4 = path.join(dir, "output-silent.mp4");
        fs.copyFileSync(sourceVideo, outputMp4);
        try { fs.copyFileSync(sourceVideo, silentMp4); } catch { /* silent.mp4 may not exist */ }
        logger.info(`[switch] 复制视频: ${entry.videoFile} → output.mp4`);

        // 更新 render step 的 output.videoFile 引用
        const renderStep = state.steps.find(s => s.id === "render");
        if (renderStep?.status === "completed") {
          renderStep.output = { ...renderStep.output, videoFile: outputMp4 };
          writeState(dir, state);
        }
      }
    }

    logger.info(`[switch] 完成 v${version}, videoFile=${entry.videoFile || "null"}`);
    return { ok: true, version, videoFile: entry.videoFile };
  } catch (e) {
    logger.error(`[switch] 失败: ${e.message}`);
    logger.error(`[switch] stack: ${e.stack}`);
    return { ok: false, error: e.message };
  }
}
