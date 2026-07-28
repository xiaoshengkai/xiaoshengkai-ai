import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { executeStep, loadTemplate } from "./lib/executor.js";
import { createWorkflowLogger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data", "workflows");

const MAX_EXECUTIONS = 50;

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
          template: state.template,
          templateLabel: template.label || state.template,
          status: state.status,
          totalSteps: state.steps.length,
          completedSteps: state.steps.filter(s => s.status === "completed").length,
          failedStep: failedStep ? failedStep.name : null,
          failedError: failedStep ? failedStep.error : null,
          startedAt: state.startedAt,
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

  const state = {
    executionId,
    template: templateName,
    params,
    startedAt: new Date().toISOString(),
    status: "pending",
    steps: template.steps.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      status: "pending",
      output: null,
      error: null,
      startedAt: null,
    })),
    currentStep: 0,
  };

  writeState(dir, state);
  return { executionId, dir, template };
}

export async function startExecution(templateName, params) {
  const { executionId, dir, template } = createExecution(templateName, params);
  const logger = createWorkflowLogger(executionId);

  logger.info(`开始执行工作流: ${templateName} (${executionId})`);
  logger.info(`参数: ${JSON.stringify(params)}`);
  logger.info(`共 ${template.steps.length} 步: ${template.steps.map(s => s.name).join(" → ")}`);

  const state = readState(dir);
  state.status = "running";
  state.steps[0].status = "running";
  state.steps[0].startedAt = new Date().toISOString();
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
      vars[step.id] = output;

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
}

export async function runExecution(executionId) {
  const dir = path.join(DATA_DIR, executionId);
  const stateFile = path.join(dir, "state.json");
  if (!fs.existsSync(stateFile)) throw new Error("执行记录不存在");

  const state = readState(dir);
  const template = loadTemplate(state.template);
  const logger = createWorkflowLogger(executionId);

  logger.info(`开始执行工作流: ${state.template} (${executionId})`);
  logger.info(`参数: ${JSON.stringify(state.params)}`);
  logger.info(`共 ${template.steps.length} 步: ${template.steps.map(s => s.name).join(" → ")}`);

  state.status = "running";
  state.steps[0].status = "running";
  state.steps[0].startedAt = new Date().toISOString();
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

  const nextIdx = state.steps.findIndex(s => s.status === "pending");
  if (nextIdx < 0) return { ok: false, error: "所有步骤已执行" };

  // 如果还没启动，先设 status=running
  if (state.status === "pending" || state.status === "created") {
    state.status = "running";
    state.startedAt = new Date().toISOString();
  }

  const template = loadTemplate(state.template);
  const templateDir = path.resolve(__dirname, "templates", template.name);
  const logger = createWorkflowLogger(executionId);
  const vars = { ...state.params, executionDir: dir };

  // 收集已完成步骤的输出
  state.steps.forEach(s => {
    if (s.status === "completed" && s.output) {
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
    state.steps[nextIdx].status = "completed";
    state.steps[nextIdx].output = output;

    if (nextIdx === template.steps.length - 1) {
      state.status = "completed";
      state.completedAt = new Date().toISOString();
    }

    writeState(dir, state);
    logger.info(`[${nextIdx + 1}/${template.steps.length}] ${step.name} 完成 (${elapsed}s)`);
    if (output) {
      const preview = typeof output === "string" ? output.slice(0, 200) : JSON.stringify(output).slice(0, 200);
      logger.info(`[${nextIdx + 1}/${template.steps.length}] 输出: ${preview}`);
    }
    return { ok: true, stepIndex: nextIdx, stepStatus: "completed" };
  } catch (err) {
    const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
    state.steps[nextIdx].status = "failed";
    state.steps[nextIdx].error = err.message;
    state.status = "failed";
    writeState(dir, state);
    logger.error(`[${nextIdx + 1}/${template.steps.length}] ${step.name} 失败 (${elapsed}s): ${err.message}`);
    return { ok: false, stepIndex: nextIdx, stepStatus: "failed", error: err.message };
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

  state.status = "running";
  state.currentStep = stepIdx;
  state.error = null;
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