import { startExecution, getExecution } from "./engine.js";

const [command, ...args] = process.argv.slice(2);

// 重定向 console 到 stderr，stdout 只输出 JSON
const origLog = console.log;
const origErr = console.error;
console.log = (...a) => origErr(...a);
console.error = (...a) => origErr(...a);

if (command === "start") {
  try {
    const { template, params } = JSON.parse(args[0]);
    const result = await startExecution(template, params);
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
} else if (command === "get") {
  const state = getExecution(args[0]);
  if (state) {
    process.stdout.write(JSON.stringify(state));
  } else {
    process.stdout.write(JSON.stringify({ error: "not found" }));
  }
} else {
  process.stdout.write(JSON.stringify({ error: "unknown command" }));
  process.exit(1);
}