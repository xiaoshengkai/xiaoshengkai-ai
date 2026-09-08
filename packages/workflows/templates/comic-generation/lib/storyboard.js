import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const STYLES_DIR = path.join(PROJECT_ROOT, "data", "workflows", "assets", "styles");

const MAX_DIALOGUE_LINES = 3;
const MAX_DIALOGUE_CHARS = 12;
const MULTI_PANEL_RE = /分格|上下两部分|双分|多格|分成上下|上半.*下半/;

function countDialogueLines(d) {
  if (!d) return 0;
  if (Array.isArray(d)) return d.filter(s => s && String(s).trim()).length;
  if (typeof d === "string") return d.split("\n").map(s => s.trim()).filter(Boolean).length;
  return 0;
}

function dialogueLines(d) {
  if (!d) return [];
  if (Array.isArray(d)) return d.map(s => String(s).trim()).filter(Boolean);
  if (typeof d === "string") return d.split("\n").map(s => s.trim()).filter(Boolean);
  return [];
}

function dialogueContentLength(line) {
  return String(line).replace(/^.*?[：:]/, "").replace(/\s/g, "").length;
}

export function validateStoryboard(script, minPages) {
  const errors = [];
  if (!script || typeof script !== "object") return ["脚本不是对象"];
  if (!Array.isArray(script.pages) || script.pages.length === 0) {
    return ["pages 必须是非空数组"];
  }
  const min = Number(minPages);
  if (min > 0 && script.pages.length < min) {
    errors.push(`页数不足：要求至少 ${min} 页，实际只有 ${script.pages.length} 页`);
  }
  script.pages.forEach((p, i) => {
    if (!p.imagePrompt || typeof p.imagePrompt !== "string") errors.push(`第 ${i + 1} 页缺少 imagePrompt`);
    if (!p.sceneId || typeof p.sceneId !== "string") errors.push(`第 ${i + 1} 页缺少 sceneId`);
    if (!p.scenePrompt || typeof p.scenePrompt !== "string") errors.push(`第 ${i + 1} 页缺少 scenePrompt`);
    if (p.dialogue === undefined) errors.push(`第 ${i + 1} 页缺少 dialogue`);
    if (p.narration !== undefined && typeof p.narration !== "string") errors.push(`第 ${i + 1} 页 narration 必须是字符串`);
    if (typeof p.narration === "string" && p.narration.replace(/\s/g, "").length > 30) errors.push(`第 ${i + 1} 页旁白过长（>30字）：${p.narration}`);
    const lines = dialogueLines(p.dialogue);
    const n = lines.length;
    if (n > MAX_DIALOGUE_LINES) errors.push(`第 ${i + 1} 页对白 ${n} 句过密（≤${MAX_DIALOGUE_LINES}），请拆成多页`);
    lines.forEach(line => {
      if (dialogueContentLength(line) > MAX_DIALOGUE_CHARS) errors.push(`第 ${i + 1} 页对白过长（>${MAX_DIALOGUE_CHARS}字）：${line}`);
    });
    if (n > 0 && (!Array.isArray(p.cast) || p.cast.length === 0)) errors.push(`第 ${i + 1} 页有对白但缺少 cast（说话人位置），请补充`);
    const castNames = (p.cast || []).map(c => c && c.name);
    lines.forEach(line => {
      const m = line.match(/^\s*([^：:]+)[：:]\s*/);
      const speaker = m ? m[1].trim() : null;
      if (speaker && castNames.length > 0 && !castNames.includes(speaker)) {
        errors.push(`第 ${i + 1} 页说话人「${speaker}」不在 cast 中，请补充或修正`);
      }
    });
    if (MULTI_PANEL_RE.test(p.imagePrompt || "")) errors.push(`第 ${i + 1} 页 imagePrompt 含多格/上下分屏，每页只画一个镜头，请拆分`);
  });
  return errors;
}

export async function generateStoryboard(content, title, pageCount, styleId) {
  const storyText = content || title;
  if (!storyText) throw new Error("缺少故事内容");

  const pageConstraint = pageCount && Number(pageCount) > 0
    ? `\n## 页数\n必须生成至少 ${pageCount} 页（对话密集可适当多页，但不少于 ${pageCount} 页）。`
    : "\n## 页数\n根据故事与对话密度自然决定页数；对话密集时拆成多页，不设上限。";

  let styleDesc = "";
  try {
    styleDesc = JSON.parse(fs.readFileSync(path.join(STYLES_DIR, `${styleId}.json`), "utf-8")).description || "";
  } catch { /* use reference image */ }
  const system = buildStoryboardPrompt(styleDesc);

  const user = `故事标题: ${title || "未命名"}
故事内容:
${storyText}
${pageConstraint}

输出：`;

  const allErrors = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const retryHint = allErrors.length > 0
      ? `\n\n## 之前校验失败，需一次性修正以下问题：\n${allErrors.join("\n")}\n`
      : "";

    const finalUser = retryHint ? user + retryHint : user;
    console.log(`[storyboard] 第 ${attempt + 1}/5 次尝试...`);
    console.log(`[storyboard] 提交AI system prompt:\n${system}`);
    console.log(`[storyboard] 提交AI 最终user prompt:\n${finalUser}`);

    const { text } = await callLLM({
      system,
      user: finalUser,
    });
    console.log(`[storyboard] AI 原始返回:\n${text}`);

    try {
      const script = parseJSON(text);
      const errors = validateStoryboard(script, pageCount);
      if (errors.length > 0) {
        errors.forEach(e => { if (!allErrors.includes(e)) allErrors.push(e); });
        console.warn(`[storyboard] 校验失败: ${errors.join("; ")}`);
        continue;
      }

      script.pages.forEach((p, i) => { if (!p.page) p.page = i + 1; });
      console.log(`[storyboard] 完成: ${script.pages.length} 页`);
      return {
        script: JSON.stringify(script, null, 2),
        pagesJson: JSON.stringify(script.pages),
        title: script.title || title,
      };
    } catch (e) {
      if (!allErrors.includes(e.message)) allErrors.push(e.message);
      console.warn(`[storyboard] 解析失败: ${e.message}`);
    }
  }

  throw new Error(`分镜生成失败: ${allErrors.join("\n")}`);
}

export function buildStoryboardPrompt(styleDesc = "") {
  return `你是专业的漫画分镜师。把故事拆成漫画分镜，每页一个画面。

当前画风：${styleDesc || "未指定，以角色参考图为准"}

每页必须包含场景连续性字段：
- sceneId：同一地点、同一道具布局、同一连续对话使用同一个英文短横线 id，如 "bank-counter"；换时间/地点/剧情阶段才换新 id。
- scenePrompt：该 sceneId 的固定场景描述，同一 sceneId 必须逐字一致，写清地点、环境道具、人物基础站位、镜头轴线。

每页 imagePrompt 必须包含五要素（缺一不可）：
1.【背景】只写本页新增变化，不重复完整固定场景；固定场景放 scenePrompt。
2.【人物】本页出场的每个角色：名字+位置（左/右/前景/背景）+动作+表情。角色外貌由参考图锁定，用名字指代即可，不要重复描述外貌。动作必须符合当前画风中的角色造型能力；无肢体角色禁止描述抓手、摊手、挥手、指向、迈步等手脚动作，改用身体倾斜、人物距离、视线、眼睛、嘴型、动作线和情绪符号表达。表情必须写成可绘制的眼睛、嘴型、身体姿态和情绪符号，不得只写抽象情绪词。
3.【构图】单一景别（特写/中景/全景）+机位。每页只画一个镜头、单一构图，禁止"分格/上下两部分/双分格/多格堆叠"。
4.【说话人】明确谁在说话、朝向与位置，使对白气泡能对准人物。
5.【cast】本页每个出场说话角色的位置：[{"name":"角色名","side":"left|right|center"}]，必须与【人物】位置一致。

对白规则：
- dialogue 为字符串数组，每个元素一句「名字: 台词」。
- 每页对白≤3 句（1-2 个来回）。每句台词正文≤12个汉字，长句必须拆成多页或压缩表达。
- 谁说谁必须与故事原文严格对应，不得张冠李戴、不得合并/省略说话人。
- 无对白页 dialogue 为空数组 []。

旁白规则：
- narration 为可选字符串：转场/无对白页的旁白或独白文字。
- 只在需要旁白的页填（如时间跳转、环境交代），普通对话页省略或写空字符串 ""。
- 旁白正文≤30个汉字，只陈述事实，不抒情、不讲道理。

只输出 JSON，格式：
{ "title": "标题", "pages": [ { "page": 1, "sceneId": "office-desk", "scenePrompt": "固定场景：白天·开放式办公区，小张在左，PM在右，桌上有显示器、咖啡杯和绿植，镜头轴线保持左右对话。", "imagePrompt": "【背景】PM身体前倾【人物】左:小张(皱眉) 右:PM(前倾)【构图】中景【说话人】PM在说话", "cast": [{"name":"小张","side":"left"},{"name":"PM","side":"right"}], "dialogue": ["PM: …", "小张: …"], "narration": "" } ] }`;
}
