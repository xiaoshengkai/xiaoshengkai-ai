const [command, ...args] = process.argv.slice(2);

// 第 1 层：stdout 纯 JSON 契约 — 任何非 JSON 输出转到 stderr
const realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk, encoding, cb) {
  const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
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
    const result = createExecution(template, params);
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
    const { getExecution } = await import("./engine.js");
    const state = getExecution(args[0]);
    if (state) {
      process.stdout.write(JSON.stringify(state));
    } else {
      process.stdout.write(JSON.stringify({ error: "not found" }));
    }
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
    const { executionId, stepId } = JSON.parse(args[0]);
    const { retryStep } = await import("./engine.js");
    retryStep(executionId, stepId);
    process.stdout.write(JSON.stringify({ ok: true }));
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