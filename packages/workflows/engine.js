import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { executeStep, loadTemplate } from "./lib/executor.js";
import { createDateLogger } from "../shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data", "workflows");
const LOG_DIR = path.join(PROJECT_ROOT, "logs", "workflows");

const MAX_EXECUTIONS = 50;

function evaluateSkipWhen(condition, params) {
  if (!condition) return false;

  // 支持数组：OR 语义（任一条件成立即跳过）
  if (Array.isArray(condition)) {
    return condition.some(c => evaluateSingleSkip(c, params));
  }
  return evaluateSingleSkip(condition, params);
}

function evaluateSingleSkip(expr, params) {
  expr = (expr || "").trim();
  if (!expr) return false;
  if (expr.includes("===") || expr.includes("!==")) {
    const m = expr.match(/^"?\{(\w+)\}"?\s*(===|!==)\s*"(.+)"$/);
    if (m) {
      const [, varName, op, val] = m;
      const actual = params[varName];
      return op === "===" ? actual === val : actual !== val;
    }
    return false;
  }
  if (expr.endsWith("_no")) {
    return params[expr.slice(0, -3)] === "no";
  }
  if (expr.endsWith("_yes")) {
    return params[expr.slice(0, -4)] === "yes";
  }
  if (expr.endsWith("_present") || expr.endsWith("_set")) {
    const varName = expr.replace(/_(present|set)$/, "");
    const v = params[varName];
    return v !== undefined && v !== null && v !== "";
  }
  return false;
}

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

export function listExecutions() {
  if (!fs.existsSync(DATA_DIR)) return [];
  const dirs = fs.readdirSync(DATA_DIR)
    .filter(d => fs.statSync(path.join(DATA_DIR, d)).isDirectory());
  return dirs
    .map(id => {
      try {
        const state = readState(path.join(DATA_DIR, id));
        const failedStep = state.steps.find(s => s.status === "failed");
        const template = loadTemplate(state.template);
        return {
          executionId: id,
          title: state.title || "",
          template: state.template,
          templateLabel: template.label || state.template,
          status: state.status,
          totalSteps: state.steps.length,
          completedSteps: state.steps.filter(s => s.status === "completed" || s.status === "skipped" || s.status === "warning").length,
          failedStep: failedStep ? failedStep.name : null,
          failedError: failedStep ? failedStep.error : null,
          startedAt: state.startedAt,
          completedAt: state.completedAt || null,
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, MAX_EXECUTIONS);
}

export function createExecution(templateName, params) {
  // 检查执行记录数量
  if (fs.existsSync(DATA_DIR)) {
    const count = fs.readdirSync(DATA_DIR).filter(d => fs.statSync(path.join(DATA_DIR, d)).isDirectory()).length;
    if (count >= MAX_EXECUTIONS) {
      throw new Error(`执行记录已达上限 (${MAX_EXECUTIONS}条)，请先清理旧记录`);
    }
  }
  const template = loadTemplate(templateName);
  const executionId = crypto.randomBytes(6).toString("hex");
  const dir = path.join(DATA_DIR, executionId);
  fs.mkdirSync(dir, { recursive: true });

  // 如果用户上传了 BGM 文件，提前拷贝到执行目录
  if (params.bgm_file && fs.existsSync(params.bgm_file)) {
    try {
      fs.copyFileSync(params.bgm_file, path.join(dir, "bgm.mp3"));
    } catch { /* ignore copy failure */ }
  }

  const state = {
    executionId,
    template: templateName,
    title: params.title || "",
    params,
    startedAt: new Date().toISOString(),
    status: "pending",
    steps: template.steps.map(s => {
      const shouldSkip = evaluateSkipWhen(s.skipWhen, params);
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        previewType: s.previewType,
        previewField: s.previewField,
        status: shouldSkip ? "skipped" : "pending",
        skipReason: shouldSkip ? s.skipWhen : null,
        output: null,
        error: null,
        startedAt: null,
      };
    }),
    currentStep: 0,
  };

  writeState(dir, state);
  return { executionId, dir, template };
}

export async function startExecution(templateName, params) {
  const { executionId, dir, template } = createExecution(templateName, params);
  const logger = createDateLogger("workflows", LOG_DIR, executionId);

  logger.info(`开始执行工作流: ${templateName} (${executionId})`);
  logger.info(`参数: ${JSON.stringify(params)}`);
  logger.info(`共 ${template.steps.length} 步: ${template.steps.map(s => s.name).join(" → ")}`);

  const state = readState(dir);
  state.status = "running";
  // 找到第一个非 skipped 的步骤
  const firstNonSkipped = state.steps.findIndex(s => s.status !== "skipped");
  if (firstNonSkipped >= 0) {
    state.steps[firstNonSkipped].status = "running";
    state.steps[firstNonSkipped].startedAt = new Date().toISOString();
  }
  state.startedAt = new Date().toISOString();
  writeState(dir, state);

  runSteps(dir, state, template, params, logger).catch(err => {
    logger.error(`工作流执行失败: ${err.message}`);
    const s = readState(dir);
    s.status = "failed";
    s.error = err.message;
    writeState(dir, s);
  });

  return { executionId };
}

function writeState(dir, state) {
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
}

function readState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf-8"));
}

async function runSteps(dir, state, template, params, logger) {
  const origLog = console.log, origWarn = console.warn, origErr = console.error;
  console.log = (...a) => { origLog(...a); logger.info(a.join(" ")); };
  console.warn = (...a) => { origWarn(...a); logger.warn(a.join(" ")); };
  console.error = (...a) => { origErr(...a); logger.error(a.join(" ")); };

  const vars = { ...params, executionDir: dir };
  template.params.forEach(p => {
    if (p.default !== undefined && (vars[p.name] === undefined || vars[p.name] === "")) {
      vars[p.name] = String(p.default);
    }
  });
  const totalStart = Date.now();
  const templateDir = path.resolve(__dirname, "templates", template.name);

  for (let i = 0; i < template.steps.length; i++) {
    const step = template.steps[i];
    if (state.steps[i].status === "skipped") {
      logger.info(`[${i + 1}/${template.steps.length}] ${step.name} 已跳过 (${state.steps[i].skipReason})`);
      continue;
    }
    state.steps[i].status = "running";
    state.steps[i].startedAt = new Date().toISOString();
    state.currentStep = i;
    writeState(dir, state);

    const stepStart = Date.now();
    logger.info(`[${i + 1}/${template.steps.length}] ${step.name} 开始...`);

    try {
      const output = await executeStep(step, vars, dir, templateDir);
      const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
      state.steps[i].status = "completed";
      state.steps[i].output = output;
      state.steps[i].elapsed = elapsed;
      vars[step.id] = output;

      // ponytail: 最后一步立即标记整体 completed, 避免末尾代码未执行
      if (i === template.steps.length - 1) {
        state.status = "completed";
        state.completedAt = new Date().toISOString();
      }

      const outputPreview = typeof output === "string"
        ? `${output.length} 字符`
        : JSON.stringify(output).length > 200
          ? `${JSON.stringify(output).length} 字符`
          : JSON.stringify(output);
      logger.info(`[${i + 1}/${template.steps.length}] ${step.name} 完成 (${elapsed}s) | 输出: ${outputPreview}`);

      if (output && typeof output === "object" && !Array.isArray(output)) {
        for (const [key, value] of Object.entries(output)) {
          if (typeof value === "string") {
            vars[`${step.id}.${key}`] = value;
          }
        }
      }
      if (typeof output === "string") {
        vars[`${step.id}.output`] = output;
      } else if (output && typeof output.output === "string") {
        vars[`${step.id}.output`] = output.output;
      }
    } catch (err) {
      const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
      state.steps[i].status = "failed";
      state.steps[i].error = err.message;
      state.steps[i].elapsed = elapsed;
      state.status = "failed";
      writeState(dir, state);
      logger.error(`[${i + 1}/${template.steps.length}] ${step.name} 失败 (${elapsed}s): ${err.message}`);
      throw err;
    }

    writeState(dir, state);
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  state.status = "completed";
  state.completedAt = new Date().toISOString();
  writeState(dir, state);
  logger.info(`工作流执行完成，总耗时: ${totalElapsed}s`);

  console.log = origLog;
  console.warn = origWarn;
  console.error = origErr;
}

export async function runExecution(executionId) {
  const dir = path.join(DATA_DIR, executionId);
  const stateFile = path.join(dir, "state.json");
  if (!fs.existsSync(stateFile)) throw new Error("执行记录不存在");

  const state = readState(dir);
  const template = loadTemplate(state.template);
  const logger = createDateLogger("workflows", LOG_DIR, executionId);

  logger.info(`开始执行工作流: ${state.template} (${executionId})`);
  logger.info(`参数: ${JSON.stringify(state.params)}`);
  logger.info(`共 ${template.steps.length} 步: ${template.steps.map(s => s.name).join(" → ")}`);

  state.status = "running";
  const firstNonSkipped2 = state.steps.findIndex(s => s.status !== "skipped");
  if (firstNonSkipped2 >= 0) {
    state.steps[firstNonSkipped2].status = "running";
    state.steps[firstNonSkipped2].startedAt = new Date().toISOString();
  }
  state.startedAt = new Date().toISOString();
  writeState(dir, state);

  runSteps(dir, state, template, state.params, logger).catch(err => {
    logger.error(`工作流执行失败: ${err.message}`);
    const s = readState(dir);
    s.status = "failed";
    s.error = err.message;
    writeState(dir, s);
  });
}

export function getExecution(executionId) {
  const dir = path.join(DATA_DIR, executionId);
  const stateFile = path.join(dir, "state.json");
  if (!fs.existsSync(stateFile)) return null;
  return readState(dir);
}

export function deleteExecution(executionId) {
  const dir = path.join(DATA_DIR, executionId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  const logFile = path.resolve(PROJECT_ROOT, "logs", "workflows", `${executionId}.log`);
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
}

export async function runNextStep(executionId) {
  const dir = path.join(DATA_DIR, executionId);
  const state = readState(dir);
  if (state.status === "completed" || state.status === "failed") {
    return { ok: false, error: "工作流已结束" };
  }

  // 防止并发：检查是否有正在运行的步骤
  const running = state.steps.find(s => s.status === "running");
  if (running) {
    return { ok: false, error: `步骤 "${running.name}" 正在执行中，请等待完成` };
  }

  const nextIdx = state.steps.findIndex(s => s.status === "pending");
  if (nextIdx < 0) return { ok: false, error: "所有步骤已执行" };

  // 如果还没启动，先设 status=running
  if (state.status === "pending" || state.status === "created") {
    state.status = "running";
    state.startedAt = new Date().toISOString();
  }

  const template = loadTemplate(state.template);
  const templateDir = path.resolve(__dirname, "templates", template.name);
  const logger = createDateLogger("workflows", LOG_DIR, executionId);
  const vars = { ...state.params, executionDir: dir };

  const origLog = console.log, origWarn = console.warn, origErr = console.error;
  console.log = (...a) => { origLog(...a); logger.info(a.join(" ")); };
  console.warn = (...a) => { origWarn(...a); logger.warn(a.join(" ")); };
  console.error = (...a) => { origErr(...a); logger.error(a.join(" ")); };

  // 收集已完成步骤的输出
  state.steps.forEach(s => {
    if ((s.status === "completed" || s.status === "warning") && s.output) {
      if (typeof s.output === "object" && !Array.isArray(s.output)) {
        for (const [k, v] of Object.entries(s.output)) {
          if (typeof v === "string") vars[`${s.id}.${k}`] = v;
        }
        vars[`${s.id}.output`] = JSON.stringify(s.output);
      } else if (typeof s.output === "string") {
        vars[`${s.id}.output`] = s.output;
      }
    }
  });

  // 注入模板默认值
  template.params.forEach(p => {
    if (p.default !== undefined && (vars[p.name] === undefined || vars[p.name] === "")) {
      vars[p.name] = String(p.default);
    }
  });

  const step = template.steps[nextIdx];
  state.steps[nextIdx].status = "running";
  state.steps[nextIdx].startedAt = new Date().toISOString();
  state.currentStep = nextIdx;
  writeState(dir, state);

  const stepStart = Date.now();
  logger.info(`[${nextIdx + 1}/${template.steps.length}] ${step.name} 开始...`);

  try {
    const output = await executeStep(step, vars, dir, templateDir);
    const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);

    const freshState = readState(dir);
    freshState.steps[nextIdx].status = "completed";
    freshState.steps[nextIdx].output = output;
    freshState.steps[nextIdx].elapsed = elapsed;

    if (nextIdx === template.steps.length - 1) {
      freshState.status = "completed";
      freshState.completedAt = new Date().toISOString();
    }

    writeState(dir, freshState);
    logger.info(`[${nextIdx + 1}/${template.steps.length}] ${step.name} 完成 (${elapsed}s)`);
    if (output) {
      const preview = typeof output === "string" ? output.slice(0, 200) : JSON.stringify(output).slice(0, 200);
      logger.info(`[${nextIdx + 1}/${template.steps.length}] 输出: ${preview}`);
    }
    return { ok: true, stepIndex: nextIdx, stepStatus: "completed" };
  } catch (err) {
    const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
    const isRetryable = err.retryable !== false;
    state.steps[nextIdx].status = isRetryable ? "warning" : "failed";
    state.steps[nextIdx].error = err.message;
    state.steps[nextIdx].elapsed = elapsed;
    state.steps[nextIdx].errorType = err.type || null;
    state.steps[nextIdx].errorSuggestion = err.suggestion || null;
    if (!isRetryable) {
      state.status = "failed";
    }
    writeState(dir, state);
    if (isRetryable) {
      logger.warn(`[${nextIdx + 1}/${template.steps.length}] ${step.name} 警告 (${elapsed}s): ${err.message}`);
      return { ok: true, stepIndex: nextIdx, stepStatus: "warning", error: err.message };
    }
    logger.error(`[${nextIdx + 1}/${template.steps.length}] ${step.name} 失败 (${elapsed}s): ${err.message}`);
    return { ok: false, stepIndex: nextIdx, stepStatus: "failed", error: err.message };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origErr;
  }
}

export async function runAllSteps(executionId) {
  for (let i = 0; i < 100; i++) {
    const result = await runNextStep(executionId);
    if (!result.ok) return result;
    const state = getExecution(executionId);
    if (!state || state.status === "completed" || state.status === "failed") return result;
  }
  return { ok: true, status: "all_done" };
}

export function retryStep(executionId, stepId) {
  const dir = path.join(DATA_DIR, executionId);
  const state = readState(dir);
  const stepIdx = state.steps.findIndex(s => s.id === stepId);
  if (stepIdx < 0) throw new Error("步骤不存在");

  state.steps[stepIdx].status = "pending";
  state.steps[stepIdx].output = null;
  state.steps[stepIdx].error = null;
  state.steps[stepIdx].startedAt = null;
  state.steps[stepIdx].elapsed = null;

  state.status = "running";
  state.currentStep = stepIdx;
  state.error = null;
  writeState(dir, state);
}

export function skipStep(executionId, stepId) {
  const dir = path.join(DATA_DIR, executionId);
  const state = readState(dir);
  const stepIdx = state.steps.findIndex(s => s.id === stepId);
  if (stepIdx < 0) throw new Error("步骤不存在");
  if (state.steps[stepIdx].status === "completed") throw new Error("步骤已完成，无法跳过");

  state.steps[stepIdx].status = "skipped";
  state.steps[stepIdx].output = null;
  state.steps[stepIdx].error = null;
  writeState(dir, state);
}

export function editStepOutput(executionId, stepId, output) {
  const dir = path.join(DATA_DIR, executionId);
  const state = readState(dir);
  const stepIdx = state.steps.findIndex(s => s.id === stepId);
  if (stepIdx < 0) return { ok: false, error: "步骤不存在" };
  state.steps[stepIdx].output = output;
  writeState(dir, state);
  return { ok: true };
}

// ── 微调 ──

const TWEAK_LIMIT = 99999;
const SCRIPTS_DIRNAME = "scripts";
const VIDEOS_DIRNAME = "videos";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getScriptsDir(execDir) {
  const d = path.join(execDir, SCRIPTS_DIRNAME);
  ensureDir(d);
  return d;
}

function getVideosDir(execDir) {
  const d = path.join(execDir, VIDEOS_DIRNAME);
  ensureDir(d);
  return d;
}

function writeScriptVersion(execDir, version, script) {
  const scriptsDir = getScriptsDir(execDir);
  const filePath = path.join(scriptsDir, `v${version}.json`);
  fs.writeFileSync(filePath, JSON.stringify(script, null, 2));
}

function readScriptVersion(execDir, version) {
  const filePath = path.join(execDir, SCRIPTS_DIRNAME, `v${version}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function initScriptHistory(state, execDir) {
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

export async function tweakExecution(executionId) {
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
    const { tweakScript } = await import("./templates/video-generation/lib/tweak-builder.js");
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

export function switchScriptVersion(executionId, version) {
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

export function saveVideoVersion(executionId, version, videoPath) {
  const dir = path.join(DATA_DIR, executionId);
  const state = readState(dir);
  if (!state.scriptHistory) return { ok: false, error: "无历史记录" };

  const entry = state.scriptHistory.find(h => h.version === version);
  if (!entry) return { ok: false, error: `版本 v${version} 不存在` };

  // 拷贝视频到版本目录
  const videosDir = getVideosDir(dir);
  const ext = path.extname(videoPath);
  const dest = path.join(videosDir, `v${version}${ext}`);
  if (fs.existsSync(videoPath)) {
    fs.copyFileSync(videoPath, dest);
  }

  entry.videoFile = `videos/v${version}${ext}`;
  writeState(dir, state);
  return { ok: true, videoFile: entry.videoFile };
}