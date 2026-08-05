import { z } from "zod";

const Scene = z.object({
  id: z.union([z.string(), z.number()]).transform(v => String(v)),
  type: z.string().default("body"),
  narration: z.string().min(1),
  html: z.string().min(1),
});

export const ScriptSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().default("未命名"),
  style: z.union([z.string(), z.record(z.unknown())]).default("Neo-Brutalist"),
  bgm_prompt: z.string().default("轻快电子"),
  scenes: z
    .array(Scene)
    .min(3, { message: "至少需要 3 个场景" })
    .max(20, { message: "最多 20 个场景" }),
});

export function validateScript(json) {
  let parsed;
  if (typeof json === "string") {
    try { parsed = JSON.parse(json); } catch {
      return { ok: false, error: "script.json 不是合法 JSON" };
    }
  } else {
    parsed = json;
  }
  const result = ScriptSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "根"}: ${i.message}`);
    return { ok: false, error: `校验失败:\n${issues.join("\n")}` };
  }
  return { ok: true, script: result.data };
}

export function validateHTML(script) {
  const errors = [];
  for (const scene of script.scenes) {
    const html = scene.html || "";
    if (!html.includes("data-duration")) {
      errors.push(`scene ${scene.id}: 缺少 data-duration`);
    }
    if (/<script/i.test(html)) {
      errors.push(`scene ${scene.id}: 包含 script 标签`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, error: errors.join("; ") };
  }
  return { ok: true };
}

export function getScriptStats(script) {
  const totalNarration = script.scenes.reduce((sum, s) => sum + s.narration.length, 0);
  const estimatedDuration = totalNarration / 5;
  return {
    sceneCount: script.scenes.length,
    totalChars: totalNarration,
    estimatedDurationSec: Math.round(estimatedDuration),
  };
}