import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execAiStep } from "./step-types/ai.js";
import { execScriptStep } from "./step-types/script.js";
import { execToolStep } from "./step-types/tool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "..", "templates");

const STEP_TYPES = {
  ai: execAiStep,
  script: execScriptStep,
  tool: execToolStep,
};

export async function executeStep(step, vars, executionDir, templateDir) {
  const executor = STEP_TYPES[step.type];
  if (!executor) throw new Error(`未知步骤类型: ${step.type}`);
  return executor(step, vars, executionDir, templateDir);
}

export function loadTemplate(name) {
  const templatePath = path.join(TEMPLATES_DIR, name, "template.json");
  return JSON.parse(fs.readFileSync(templatePath, "utf-8"));
}

export function loadTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR)
    .filter(f => fs.statSync(path.join(TEMPLATES_DIR, f)).isDirectory())
    .map(f => {
      const t = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f, "template.json"), "utf-8"));
      return { ...t, id: f, tweak: fs.existsSync(path.join(TEMPLATES_DIR, f, "lib", "tweak.js")) };
    });
}