const [command, ...args] = process.argv.slice(2);

async function main() {
  if (command === "start") {
    const { template, params } = JSON.parse(args[0]);
    const { createExecution } = await import("./engine.js");
    const result = createExecution(template, params);
    process.stdout.write(JSON.stringify({ ok: true, executionId: result.executionId }));
  } else if (command === "run") {
    const { template, params } = JSON.parse(args[0]);
    const { startExecution } = await import("./engine.js");
    await startExecution(template, params);
    // startExecution 不 await 工作流，立即返回
  } else if (command === "get") {
    const { getExecution } = await import("./engine.js");
    const state = getExecution(args[0]);
    if (state) {
      process.stdout.write(JSON.stringify(state));
    } else {
      process.stdout.write(JSON.stringify({ error: "not found" }));
    }
  }
}

main().catch(err => {
  process.stderr.write(err.message);
  process.exit(1);
});