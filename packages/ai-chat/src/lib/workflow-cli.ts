/**
 * workflow CLI 子进程调用 + JSON 输出解析
 *
 * ponytail: 替换 8 处散落的 execFile + parseCliOutput 包装
 */

import { execFile } from "node:child_process";
import path from "node:path";

const CLI_PATH = path.resolve(process.cwd(), "..", "..", "packages", "workflows", "cli.js");

export async function runWorkflowCli(args: string[], timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile("node", [CLI_PATH, ...args], { timeout: timeoutMs }, (err, stdout, stderr) => {
      // ponytail: 过滤 dotenv 包的营销 tip 噪音（每次 CLI 启动都会打 ~1 行 stderr）
      const realStderr = stderr
        .split("\n")
        .filter((line) =>
          !line.includes("◇ injected env") &&
          !line.includes("// tip:") &&
          line.trim() !== ""
        )
        .join("\n");
      if (realStderr) console.log("[workflow] cli stderr:", realStderr);
      if (err) return reject(err);
      resolve(parseCliOutput(stdout));
    });
  });
}

export function parseCliOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const brace = trimmed.indexOf("{");
  const bracket = trimmed.indexOf("[");
  let start: number;
  if (brace === -1 && bracket === -1) {
    throw new Error(`no JSON found in CLI output: ${trimmed.slice(0, 200)}`);
  } else if (brace === -1) {
    start = bracket;
  } else if (bracket === -1) {
    start = brace;
  } else {
    start = Math.min(brace, bracket);
  }

  // 找到匹配的结束位置（用于截断 trailing noise）
  const open = trimmed[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let end = -1;
  let inStr = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) end = trimmed.length;
  return JSON.parse(trimmed.slice(start, end));
}