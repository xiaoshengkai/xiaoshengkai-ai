import { z } from "zod";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "../../../..");
const SKILLS_DIR = path.resolve(PROJECT_ROOT, "packages/skills");

function isAllowed(dir) {
  const resolved = path.resolve(PROJECT_ROOT, dir || ".");
  return resolved.startsWith(PROJECT_ROOT) || resolved.startsWith(SKILLS_DIR);
}

export function register(server) {
  server.tool(
    "exec",
    "执行 shell 命令。可在项目根目录或 skills/ 目录下运行脚本（如 Python 脚本、Shell 脚本）。",
    {
      command: z.string().min(1).describe("要执行的 shell 命令"),
      workdir: z.string().optional().describe("工作目录，默认项目根"),
      timeout: z.number().optional().default(60000).describe("超时毫秒"),
    },
    async ({ command, workdir, timeout }) => {
      try {
        const cwd = path.resolve(PROJECT_ROOT, workdir || ".");
        if (!isAllowed(cwd)) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `不允许的工作目录: ${cwd}` }) }] };
        }

        const blocked = ["rm -rf /", "sudo ", "mkfs.", "dd if=", "fork", ":(){ :|:& };:"];
        if (blocked.some(b => command.toLowerCase().includes(b))) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "命令包含禁止的操作" }) }] };
        }

        const stdout = execSync(command, { cwd, timeout, encoding: "utf-8", maxBuffer: 100 * 1024, shell: "/bin/bash" });
        return { content: [{ type: "text", text: stdout.slice(0, 10000) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message, stderr: err.stderr?.toString().slice(0, 5000) || "" }) }] };
      }
    },
  );
}