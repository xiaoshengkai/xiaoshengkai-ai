import { z } from "zod";

const Scene = z.object({
  id: z.string().min(1),
  type: z.enum(["hook", "body", "outro"]),
  narration: z.string().min(1),
  html: z.string().min(1),
});

export const ScriptSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().min(1),
  style: z.string().default("Neo-Brutalist"),
  bgm_prompt: z.string().default("轻快电子"),
  scenes: z
    .array(Scene)
    .min(3, { message: "至少需要 3 个场景" })
    .max(12, { message: "最多 12 个场景" })
    .refine((s) => s[0]?.type === "hook", { message: "第一个场景必须是 hook 类型" })
    .refine((s) => s[s.length - 1]?.type === "outro", { message: "最后一个场景必须是 outro 类型" }),
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
    if (!html.includes('class="clip"') && !html.includes("class='clip'")) {
      errors.push(`scene ${scene.id}: html 缺少 class="clip"`);
    }
    if (!html.includes("data-duration")) {
      errors.push(`scene ${scene.id}: html 缺少 data-duration 属性`);
    }
    if (/<script/i.test(html)) {
      errors.push(`scene ${scene.id}: html 包含 <script> 标签（禁止）`);
    }
    if (/jQuery|\$\(/.test(html)) {
      errors.push(`scene ${scene.id}: html 包含 jQuery 代码（禁止）`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, error: `HTML 校验失败:\n${errors.join("\n")}` };
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