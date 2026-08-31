import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [command, ...args] = process.argv.slice(2);

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");

// 第 1 层：stdout 纯 JSON 契约 — 任何非 JSON 输出转到 stderr
const realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk, encoding, cb) {
  const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  if (s.includes("\x1b") || s.includes("\x9b")) {
    return process.stderr.write(chunk, encoding, cb);
  }
  if ((s.startsWith("{") || s.startsWith("[")) && s.length > 1) {
    return realStdoutWrite(chunk, encoding, cb);
  }
  return process.stderr.write(chunk, encoding, cb);
};

// 重定向 console 到 stderr
const origLog = console.log;
const origErr = console.error;
console.log = (...a) => origErr(...a);
console.error = (...a) => origErr(...a);

async function main() {
  // 第 2 层：动态导入 dotenv，在 console 重定向后加载
  const { config } = await import("dotenv");
  config({ path: new URL("../../.env", import.meta.url).pathname });

  if (command === "start") {
    const { template, params } = JSON.parse(args[0]);
    const { createExecution } = await import("./engine.js");
    const result = createExecution(template, params || {});
    process.stdout.write(JSON.stringify({ ok: true, executionId: result.executionId }));
  } else if (command === "run") {
    const { executionId } = JSON.parse(args[0]);
    const { runExecution } = await import("./engine.js");
    await runExecution(executionId);
  } else if (command === "next") {
    const { executionId } = JSON.parse(args[0]);
    const { runNextStep } = await import("./engine.js");
    const result = await runNextStep(executionId);
    process.stdout.write(JSON.stringify(result));
  } else if (command === "auto") {
    const { executionId } = JSON.parse(args[0]);
    const { runAllSteps } = await import("./engine.js");
    const result = await runAllSteps(executionId);
    process.stdout.write(JSON.stringify(result));
  } else if (command === "get") {
    const { executionId } = JSON.parse(args[0]);
    const { getExecution } = await import("./engine.js");
    const state = getExecution(executionId);
    if (state) {
      process.stdout.write(JSON.stringify(state));
    } else {
      process.stdout.write(JSON.stringify({ error: "not found" }));
    }
  } else if (command === "templates") {
    if (!fs.existsSync(TEMPLATES_DIR)) {
      process.stdout.write(JSON.stringify({ templates: [] }));
    } else {
      const templates = fs.readdirSync(TEMPLATES_DIR)
        .filter(f => fs.statSync(path.join(TEMPLATES_DIR, f)).isDirectory())
        .map(f => {
          const t = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f, "template.json"), "utf-8"));
          return { id: f, ...t, tweak: fs.existsSync(path.join(TEMPLATES_DIR, f, "lib", "tweak.js")) };
        });
      process.stdout.write(JSON.stringify({ templates }));
    }
  } else if (command === "tweak-auto") {
    const { executionId, feedback, images, pages, mode } = JSON.parse(args[0]);
    const { tweakAuto } = await import("./lib/tweak-auto.js");
    const result = await tweakAuto(executionId, feedback, images, pages, mode);
    process.stdout.write(JSON.stringify(result || { ok: true }));
  } else if (command === "switch-version") {
    const { executionId, version } = JSON.parse(args[0]);
    const { DATA_DIR, readState } = await import("./lib/state.js");
    const state = readState(path.join(DATA_DIR, executionId));
    let mod;
    try {
      mod = await import(`./templates/${state.template}/lib/switch-version.js`);
    } catch {
      process.stdout.write(JSON.stringify({ ok: false, error: "该模板不支持版本切换" }));
      return;
    }
    const result = mod.switchVersion(executionId, version);
    process.stdout.write(JSON.stringify(result));
  } else if (command === "list") {
    const { listExecutions } = await import("./engine.js");
    const list = listExecutions();
    process.stdout.write(JSON.stringify(list));
  } else if (command === "delete") {
    const { executionId } = JSON.parse(args[0]);
    const { deleteExecution } = await import("./engine.js");
    deleteExecution(executionId);
    process.stdout.write(JSON.stringify({ ok: true }));
  } else if (command === "retry") {
    // 组合命令：重置步骤后立即执行（原 ai-chat retry 路由的两次调用收敛于此）
    const { executionId, stepId } = JSON.parse(args[0]);
    const { retryStep, runNextStep } = await import("./engine.js");
    retryStep(executionId, stepId);
    const result = await runNextStep(executionId);
    process.stdout.write(JSON.stringify(result));
  } else if (command === "skip") {
    const { executionId, stepId } = JSON.parse(args[0]);
    const { skipStep } = await import("./engine.js");
    skipStep(executionId, stepId);
    process.stdout.write(JSON.stringify({ ok: true }));
  } else {
    process.stdout.write(JSON.stringify({ error: "unknown command" }));
    process.exit(1);
  }
}

main().catch(err => {
  process.stderr.write(err.message);
  process.exit(1);
});