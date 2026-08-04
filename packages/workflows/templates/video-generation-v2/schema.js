import { z } from "zod";

const SfxSpec = z.object({
  name: z.string().min(1).optional(),
  volume: z.number().min(0).max(1).default(0.3),
  startOffsetSec: z.number().default(0),
});

const Scene = z.object({
  id: z.string().min(1),
  type: z.enum(["hook", "body", "outro"]),
  narration: z.string().min(1),
  templateId: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).default({}),
  sfx: SfxSpec.optional(),
});

export const ScriptSchema = z.object({
  schemaVersion: z.literal(1),
  renderer: z.literal("hyperframes-v2"),
  title: z.string().min(1),
  bgm_prompt: z.string().default("轻快电子"),
  aspect: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
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
    try {
      parsed = JSON.parse(json);
    } catch {
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

  const contentErrors = validateContent(result.data);
  if (contentErrors.length > 0) {
    return { ok: false, error: `内容校验失败:\n${contentErrors.join("\n")}` };
  }

  return { ok: true, script: result.data };
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const TEXT_FIELDS = [
  "title", "subtitle", "headline", "subheadline", "kicker",
  "brand", "brand_name", "label", "note", "desc", "hero",
  "eyebrow", "anchor", "figure", "number", "tagline", "primary_url",
  "statement", "source", "date", "meta", "caption", "script",
  "footer_left", "footer_right", "standfirst", "badge", "pre", "post", "vs",
];

function validateContent(script) {
  const errors = [];
  for (const scene of script.scenes) {
    for (const [key, value] of Object.entries(scene.inputs)) {
      if (typeof value === "string" && value.includes("#") && !HEX_COLOR.test(value)) {
        if (TEXT_FIELDS.includes(key) || !key.startsWith("accent")) {
          errors.push(`  - scene ${scene.id}: inputs.${key} 包含颜色代码 "${value}"，颜色值应独立填写`);
        }
      }
      // accent 字段应该是强调词，不是颜色代码
      if (key === "accent" && typeof value === "string" && HEX_COLOR.test(value)) {
        errors.push(`  - scene ${scene.id}: inputs.accent 应该是强调词（如"常见误区"），不是颜色代码 "${value}"`);
      }
      // brand 字段不能是占位符
      if ((key === "brand" || key === "brand_name") && typeof value === "string" && value.includes("{")) {
        errors.push(`  - scene ${scene.id}: inputs.${key} 包含占位符 "${value}"，应填真实品牌名或留空`);
      }
    }
    if (scene.inputs.items && Array.isArray(scene.inputs.items)) {
      for (let i = 0; i < scene.inputs.items.length; i++) {
        const item = scene.inputs.items[i];
        for (const [key, value] of Object.entries(item)) {
          if (typeof value === "string" && value.includes("#") && !HEX_COLOR.test(value)) {
            errors.push(`  - scene ${scene.id}: items[${i}].${key} 包含颜色代码 "${value}"`);
          }
        }
      }
    }
    if (scene.inputs.left && typeof scene.inputs.left === "object") {
      for (const [key, value] of Object.entries(scene.inputs.left)) {
        if (typeof value === "string" && value.includes("#") && !HEX_COLOR.test(value) && !key.startsWith("from") && !key.startsWith("to")) {
          errors.push(`  - scene ${scene.id}: left.${key} 包含颜色代码 "${value}"`);
        }
      }
    }
    if (scene.inputs.right && typeof scene.inputs.right === "object") {
      for (const [key, value] of Object.entries(scene.inputs.right)) {
        if (typeof value === "string" && value.includes("#") && !HEX_COLOR.test(value) && !key.startsWith("from") && !key.startsWith("to")) {
          errors.push(`  - scene ${scene.id}: right.${key} 包含颜色代码 "${value}"`);
        }
      }
    }
  }
  return errors;
}

export function getScriptStats(script) {
  const totalNarration = script.scenes.reduce((sum, s) => sum + s.narration.length, 0);
  const estimatedDuration = totalNarration / 5; // 约 5 字/秒
  return {
    sceneCount: script.scenes.length,
    totalChars: totalNarration,
    estimatedDurationSec: Math.round(estimatedDuration),
    templates: [...new Set(script.scenes.map((s) => s.templateId))],
  };
}