import { z } from "zod";

const Scene = z.object({
  id: z.union([z.string(), z.number()]).transform(v => String(v)),
  type: z.string().default("body"),
  narration: z.string().min(1),
  html: z.string().min(1),
  css: z.string().optional(),
  jsAnimation: z.string().optional(),
});

export const ScriptSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal("1")]).transform(v => Number(v)),
  title: z.string().default("未命名"),
  style: z.union([z.string(), z.record(z.unknown())]).default("Neo-Brutalist"),
  bgm_prompt: z.string().default("轻快电子"),
  designTokens: z.object({
    palette: z.object({ primary: z.string(), secondary: z.string(), background: z.string() }),
    fonts: z.object({ heading: z.string(), subheading: z.string(), body: z.string(), label: z.string() }),
  }).optional(),
  css: z.string().optional(),
  jsAnimation: z.string().optional(),
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
  if (parsed && "clips" in parsed && !("scenes" in parsed)) {
    parsed = { ...parsed, scenes: parsed.clips, clips: undefined };
  }
  const result = ScriptSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "根"}: ${i.message}`);
    return { ok: false, error: `校验失败:\n${issues.join("\n")}` };
  }
  for (const [i, scene] of result.data.scenes.entries()) {
    const missing = [];
    if (!scene.css || scene.css.trim() === "") missing.push("css");
    if (!scene.jsAnimation || scene.jsAnimation.trim() === "") missing.push("jsAnimation");
    if (missing.length > 0) {
      return { ok: false, error: `scene ${i + 1} (${scene.id}) 缺少必填字段: ${missing.join(", ")}` };
    }
  }
  return { ok: true, script: result.data };
}

function validateNoRemoteResources(html) {
  if (/https:\/\/fonts\.googleapis\.com/i.test(html)) return "包含 Google Fonts 远程引用";
  if (/https:\/\/fonts\.gstatic\.com/i.test(html)) return "包含 Google Fonts 远程引用";
  if (/<link[^>]*rel=["']stylesheet["'][^>]*href=["']https?:\/\//i.test(html)) return "包含远程样式表";
  if (/@import\s+url\(["']?https?:\/\//i.test(html)) return "包含 @import 远程引用";
  if (/<script[^>]*src=["']https?:\/\//i.test(html)) return "包含远程脚本";
  return null;
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
    const remoteErr = validateNoRemoteResources(html);
    if (remoteErr) {
      errors.push(`scene ${scene.id}: ${remoteErr}`);
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