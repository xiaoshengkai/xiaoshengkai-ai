import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDateLogger } from "@app/shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const name = process.env.TASK;

if (!name) {
  console.error("用法: TASK=<task-name> npm run tasks:run");
  process.exit(1);
}

const logger = createDateLogger("tasks", path.resolve(__dirname, "..", "..", "logs", "tasks"), name);

const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
console.log = (...a) => { orig.log(...a); logger.log(...a); };
console.error = (...a) => { orig.error(...a); logger.error(...a); };
console.warn = (...a) => { orig.warn(...a); logger.warn(...a); };
console.info = (...a) => { orig.info(...a); logger.info(...a); };

try {
  await import(`./tasks/${name}/index.js`).then((m) => m.run());
} catch (err) {
  console.error(`[${name}] 执行失败:`, err);
  process.exit(1);
}
