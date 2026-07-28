import { execFile } from "node:child_process";

export async function execScriptStep(step, vars, executionDir) {
  let script = step.script;
  for (const [key, value] of Object.entries(vars)) {
    script = script.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
  }

  return new Promise((resolve, reject) => {
    execFile("node", ["-e", script], { timeout: step.timeout || 300000, cwd: executionDir }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve({ output: stdout.trim() });
      }
    });
  });
}