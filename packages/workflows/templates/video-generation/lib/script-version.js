/**
 * video-generation 脚本版本管理（scriptHistory / scripts/vN.json）
 * 从 engine.js 迁入：脚本版本是 video-generation 特有概念，引擎不应感知
 */

import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../../../lib/state.js";

export const TWEAK_LIMIT = 99999;
const SCRIPTS_DIRNAME = "scripts";

export function getScriptsDir(execDir) {
  const d = path.join(execDir, SCRIPTS_DIRNAME);
  ensureDir(d);
  return d;
}

export function writeScriptVersion(execDir, version, script) {
  const scriptsDir = getScriptsDir(execDir);
  const filePath = path.join(scriptsDir, `v${version}.json`);
  fs.writeFileSync(filePath, JSON.stringify(script, null, 2));
}

export function readScriptVersion(execDir, version) {
  const filePath = path.join(execDir, SCRIPTS_DIRNAME, `v${version}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function initScriptHistory(state, execDir) {
  if (!state.scriptHistory) {
    const scriptStep = state.steps.find(s => s.id === "script");
    const script = scriptStep?.output?.script;
    if (script) {
      const parsed = typeof script === "string" ? JSON.parse(script) : script;
      writeScriptVersion(execDir, 0, parsed);
      state.scriptHistory = [{
        version: 0,
        at: state.startedAt || new Date().toISOString(),
        feedback: "初次生成",
        videoFile: null,
      }];
      state.currentScriptVersion = 0;
      state.tweakCount = 0;
    }
  }
  if (state.tweakLimit === undefined) state.tweakLimit = TWEAK_LIMIT;
}
