import { z } from "zod";

/* ───────── 分镜表（vibe-video：双语字幕形态） ───────── */

const Beat = z.object({
  id: z.union([z.string(), z.number()]).transform(v => String(v)),
  role: z.string().default("body"),
  zh: z.string().min(1, { message: "每拍必须有中文字幕句" }),
  en: z.string().default(""),
  chapter: z.number().int().min(0).default(0),
  presentAction: z.string().default("照句子演"),
  onScreen: z.string().default(""),
  note: z.string().optional(),
  takeaway: z.string().optional(),
  durationSec: z.number().optional(),
});

const Chapter = z.object({
  label: z.string().min(1, { message: "章节必须有标签" }),
  note: z.string().optional(),
});

export const StoryboardSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal("1")]).default(1).transform(v => Number(v)),
  title: z.string().optional(),
  thesis: z.string().optional(),
  coreMetaphor: z.string().optional(),
  instrument: z.string().optional(),
  suspensePlan: z.string().optional(),
  reversals: z.union([z.number(), z.string()]).optional(),
  chapters: z.array(Chapter).min(1, { message: "至少 1 个章节" }).max(10),
  beats: z.array(Beat).min(8, { message: "至少 8 拍" }).max(45, { message: "最多 45 拍" }),
});

/** 字幕阅读节奏：约 5-8 字/秒，最低 2.5s */
export function estimateSubtitleSec(zh) {
  const chars = (zh || "").replace(/\s/g, "").length;
  return +clampNum(1.0 + chars * 0.22, 2.5, 4.5).toFixed(1);
}

function clampNum(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

export function validateStoryboard(json) {
  let parsed = json;
  if (typeof json === "string") {
    try { parsed = JSON.parse(json); } catch {
      return { ok: false, error: "storyboard 不是合法 JSON" };
    }
  }
  const result = StoryboardSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "根"}: ${i.message}`);
    return { ok: false, error: `分镜表校验失败:\n${issues.join("\n")}` };
  }
  const sb = result.data;
  for (const beat of sb.beats) {
    if (beat.durationSec == null) beat.durationSec = estimateSubtitleSec(beat.zh);
  }
  const warnings = [];
  /* chapter 索引与连续性 */
  const maxChapter = Math.max(...sb.beats.map(b => b.chapter));
  if (maxChapter >= sb.chapters.length) {
    return { ok: false, error: `存在未声明的章节索引 ${maxChapter}（chapters 只有 ${sb.chapters.length} 个）` };
  }
  for (const [i, beat] of sb.beats.entries()) {
    if (i > 0 && beat.chapter < sb.beats[i - 1].chapter) {
      warnings.push(`拍 ${beat.id}: chapter 索引回退（章节应按 beats 顺序分组）`);
    }
    const emCount = (beat.zh.match(/[「」]/g) || []).length / 2;
    if (emCount > 1) warnings.push(`拍 ${beat.id}: 强调词超过 1 处`);
    const chars = beat.zh.replace(/\s/g, "").length;
    if (chars > 24) warnings.push(`拍 ${beat.id}: 中文字幕 ${chars} 字超长（≤24，拆两句）`);
    if (!beat.en) warnings.push(`拍 ${beat.id}: 缺英文字幕`);
  }
  if (!sb.beats.some(b => b.role === "title")) {
    warnings.push("无 title 拍：片名卡将不出现在片中（建议在 10-25% 处安排一拍 role=title）");
  }
  for (const w of new Set(warnings)) console.warn(`[storyboard-schema] ${w}`);
  return { ok: true, storyboard: sb };
}

/* ───────── 场景函数批产物 lint（确定性渲染铁律） ───────── */

const FORBIDDEN_SCENE_PATTERNS = [
  { re: /Math\.random\s*\(/, msg: "Math.random()（非确定性）——用骨架内置固定种子 rnd() 或写死值" },
  { re: /Date\.now\s*\(|new\s+Date\b/, msg: "Date.now/new Date（非确定性）——禁止" },
  { re: /setTimeout|setInterval|requestAnimationFrame/, msg: "定时器/rAF（画面只由 t 决定）——禁止" },
  { re: /performance\.now/, msg: "performance.now（非确定性）——禁止" },
  { re: /window\.render\s*=/, msg: "禁止改写 window.render 入口" },
  { re: /\b(1920|1080)\b/, msg: "硬编码画幅数字——用 W/H/SC（横竖屏自适应）" },
  { re: /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/, msg: "硬编码颜色——用 T.* 主题色（主题一致性由骨架锁死）" },
];

/** 校验一批场景函数代码：返回错误列表（空=通过） */
export function validateSceneBatch(code, expectedFnNames) {
  const errors = [];
  if (!code || typeof code !== "string" || code.trim().length < 50) {
    return ["场景代码为空或过短"];
  }
  for (const { re, msg } of FORBIDDEN_SCENE_PATTERNS) {
    if (re.test(code)) errors.push(msg);
  }
  /* 语法解析（正则 lint 抓不到语法错误，new Function 编译一遍） */
  try {
    new Function(code);
  } catch (e) {
    errors.push(`场景代码语法错误: ${e.message}`);
  }
  for (const name of expectedFnNames) {
    if (!new RegExp(`function\\s+${name}\\s*\\(`).test(code)) {
      errors.push(`缺少函数 ${name}(t)`);
    }
  }
  return errors;
}

/** 组装后的整页 html 静态校验（渲染冒烟前的快速门） */
export function validateHtmlString(html) {
  const errors = [];
  if (!html.includes("window.render")) errors.push("缺少 window.render 入口");
  if (/@import\s+url|fonts\.googleapis|fonts\.gstatic/.test(html)) errors.push("含远程字体引用");
  if (/<script[^>]*src=["']https?:/.test(html)) errors.push("含远程脚本");
  if (/\/\*__DATA__\*\//.test(html) || /\/\*__SCENES__\*\//.test(html)) errors.push("注入标记未被替换");
  return errors;
}
