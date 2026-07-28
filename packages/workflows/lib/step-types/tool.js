export async function execToolStep(step, vars, executionDir) {
  let params = { ...(step.params || {}) };
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      for (const [vk, vv] of Object.entries(vars)) {
        params[key] = String(params[key]).replace(new RegExp(`\\{${vk}\\}`, "g"), String(vv));
      }
    }
  }

  // 动态导入工具模块
  const toolModule = await import(`../../../mcp/tools/media/${step.tool}.js`);
  const result = await toolModule.exec(params);
  return result;
}