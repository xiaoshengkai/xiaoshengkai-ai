import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { executeStep, loadTemplate } from "./lib/executor.js";
import { DATA_DIR, LOG_DIR, ensureDir, readState, writeState } from "./lib/state.js";
import { evaluateSkipWhen } from "./lib/skip-when.js";
import { createDateLogger } from "@app/shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const MAX_EXECUTIONS = 50;

/** 末步完成时的整体终态：有 warning 步则为 completed_with_warnings（不被"完成"吞掉） */
export function deriveTerminalStatus(steps) {
  return steps.some(s => s.status === "warning") ? "completed_with_warnings" : "completed";
}

const TERMINAL_STATUSES = ["completed", "completed_with_warnings", "failed"];

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
          completedSteps: state.steps.filter(s => s.status === "completed" || s.status === "skipped").length,
          warningSteps: state.steps.filter(s => s.status === "warning").length,
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
  if (TERMINAL_STATUSES.includes(state.status)) {
    return { ok: false, error: "执行已结束" };
  }

  // 防止并发：检查是否有正在运行的步骤
  const running = state.steps.find(s => s.status === "running");
  if (running) {
    // ponytail: 无心跳机制，running 超 30 分钟视为 worker 已死（合法步骤上限是 render 超时 5 分钟），下次动作自愈
    const age = Date.now() - new Date(running.startedAt || 0).getTime();
    if (running.startedAt && age > 30 * 60 * 1000) {
      console.warn(`[engine] 孤儿 running 步骤 "${running.name}" (${Math.round(age / 60000)}min) 重置为 pending`);
      running.status = "pending";
      running.startedAt = null;
      writeState(dir, state);
    } else {
      return { ok: false, error: `步骤 "${running.name}" 正在执行中，请等待完成` };
    }
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
      freshState.status = deriveTerminalStatus(freshState.steps);
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
    if (!state || TERMINAL_STATUSES.includes(state.status)) return result;
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

