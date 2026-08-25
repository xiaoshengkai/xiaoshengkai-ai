import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDateLogger } from "@app/shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const item = args[0];
const cmd = args.slice(sep + 1);

if (!item || sep === -1 || cmd.length === 0) {
  console.error("用法: log-wrap.js <itemName> -- <command> [args...]");
  process.exit(1);
}

const logger = createDateLogger("services", path.resolve(__dirname, "..", "logs", "services"), item);

const child = spawn(cmd[0], cmd.slice(1), { stdio: ["ignore", "pipe", "pipe"] });

const emit = (buf, level) => {
  for (const line of buf.toString().split("\n")) {
    const t = line.trim();
    if (t) logger[level](t);
  }
};

child.stdout.on("data", (d) => emit(d, "log"));
child.stderr.on("data", (d) => emit(d, "error"));
child.on("exit", (code) => process.exit(code ?? 0));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => child.kill(sig));
}
