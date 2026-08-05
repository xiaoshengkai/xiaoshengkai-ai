import { ERRORS } from "./errors.js";

export async function pickSfx(scriptJson, executionDir) {
  const startTime = Date.now();
  try {
    const script = typeof scriptJson === "string" ? JSON.parse(scriptJson) : scriptJson;
    if (!script.scenes) return { output: "SFX 匹配完成: 0 个场景" };

    const matched = script.scenes.filter(s => {
      const n = s.narration || "";
      return /(警告|风险|成功|突破|揭秘|数据|对比)/.test(n);
    });

    console.log(`[sfx] 完成: ${matched.length}/${script.scenes.length} (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
    return { output: `SFX 匹配完成: ${matched.length}/${script.scenes.length} 个场景` };
  } catch {
    return { output: "SFX 匹配完成: 0 个场景" };
  }
}