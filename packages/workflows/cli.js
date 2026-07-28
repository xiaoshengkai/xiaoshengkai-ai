const [command, ...args] = process.argv.slice(2);

// 重定向 console 到 stderr，stdout 只输出 JSON
const origLog = console.log;
const origErr = console.error;
console.log = (...a) => origErr(...a);
console.error = (...a) => origErr(...a);

async function main() {
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
  } else {
    process.stdout.write(JSON.stringify({ error: "unknown command" }));
    process.exit(1);
  }
}

main().catch(err => {
  process.stderr.write(err.message);
  process.exit(1);
});