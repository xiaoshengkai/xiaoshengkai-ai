import path from "node:path";

export async function execToolStep(step, vars, executionDir, templateDir) {
  const modulePath = path.resolve(templateDir, step.module);
  const mod = await import(modulePath);
  const fn = mod[step.function];

  const args = (step.args || []).map(a => {
    let val = a;
    for (const [k, v] of Object.entries(vars)) {
      if (v != null && v !== undefined) {
        val = val.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return val;
  });

  return await fn(...args);
}