import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { executeStep, loadTemplate } from "./lib/executor.js";
import { createWorkflowLogger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data", "workflows");

export async function startExecution(templateName, params) {
  const template = loadTemplate(templateName);
  const executionId = crypto.randomBytes(6).toString("hex");
  const dir = path.join(DATA_DIR, executionId);
  fs.mkdirSync(dir, { recursive: true });
  const logger = createWorkflowLogger(executionId);

  logger.info(`开始执行工作流: ${templateName} (${executionId})`);
  logger.info(`参数: ${JSON.stringify(params)}`);
  logger.info(`共 ${template.steps.length} 步: ${template.steps.map(s => s.name).join(" → ")}`);

  const state = {
    executionId,
    template: templateName,
    params,
    startedAt: new Date().toISOString(),
    status: "running",
    steps: template.steps.map((s, i) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      status: i === 0 ? "running" : "pending",
      output: null,
      error: null,
      startedAt: i === 0 ? new Date().toISOString() : null,
    })),
    currentStep: 0,
  };

  writeState(dir, state);

  // 异步执行
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

export function getExecution(executionId) {
  const dir = path.join(DATA_DIR, executionId);
  const stateFile = path.join(dir, "state.json");
  if (!fs.existsSync(stateFile)) return null;
  return readState(dir);
}

export function retryStep(executionId, stepId) {
  // TODO: 支持重试单步
  return { ok: false, error: "未实现" };
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