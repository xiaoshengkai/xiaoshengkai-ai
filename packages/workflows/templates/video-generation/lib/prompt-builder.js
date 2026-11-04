import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { validateScript, validateHTML, getScriptStats, checkScriptAgainstStoryboard, validateNoRemoteResources, hasInfiniteRepeat } from "./schema.js";
import { ERRORS } from "./errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 分批生成：每批拍数（4 拍 ≈ 4-6k 输出 token，远离 16k 截断线与长连接死亡区） */
export const BATCH_SIZE = 4;
const BATCH_ATTEMPTS = 3;
const FRAME_ATTEMPTS = 3;

function loadScriptRules() {
  const p = path.join(__dirname, "..", "script-rules.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
}

function loadDesignRules() {
  const dir = path.join(__dirname, "..", "design-rules");
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".md")).sort();
  return files.map(f => fs.readFileSync(path.join(dir, f), "utf-8")).join("\n\n");
}

function loadVisualizationRules() {
  const p = path.join(__dirname, "..", "narrative-rules", "02-visualization.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
}

function loadStyleGuide(style) {
  const name = style === "Neo-Brutalist" ? "neo-brutalist"
    : style === "奶油风" ? "cream"
    : style === "极简黑白" ? "bw"
    : "neo-brutalist";
  const p = path.join(__dirname, "..", "templates", "styles", `${name}.md`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
}

export async function generateScript(title, content, style, storyboardJson, executionDir) {
  const startTime = Date.now();

  // 分镜表阶段产物（旧执行/降级时为空 → 走原有自由生成路径）
  let storyboard = null;
  if (storyboardJson && String(storyboardJson).trim()) {
    try {
      storyboard = typeof storyboardJson === "string" ? JSON.parse(storyboardJson) : storyboardJson;
    } catch {
      console.warn("[prompt-builder] storyboard JSON 解析失败，降级为自由生成");
    }
  }

  if (storyboard?.beats?.length) {
    return generateScriptBatched({ title, style, storyboard, executionDir, startTime });
  }
  return generateScriptSingle({ title, content, style, startTime });
}

/* ══════════ 路径一：分批生成（有分镜，v0.11.63） ══════════ */

function styleSectionFor(style) {
  const userPicked = style && style !== "自动（AI 决定）";
  return userPicked
    ? `\n## 指定风格\n用户选择: ${style}\n严格遵循以下风格指南：\n\n${loadStyleGuide(style)}`
    : "\n## 风格\n根据内容主题自由选择最合适的视觉风格";
}

/** 从 state 直读 script 步骤的 retryForce（force 重试 = 全量重生成，普通补跑复用批次缓存） */
function readRetryForce(executionDir) {
  if (!executionDir) return false;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(executionDir, "state.json"), "utf-8"));
    return Boolean(state.steps?.find(s => s.id === "script")?.retryForce);
  } catch {
    return false;
  }
}

async function generateScriptBatched({ title, style, storyboard, executionDir, startTime }) {
  const systemPrompt = `${loadScriptRules()}\n\n${loadDesignRules()}\n\n${loadVisualizationRules()}`;
  const styleSection = styleSectionFor(style);
  const beats = storyboard.beats;

  const cacheDir = executionDir ? path.join(executionDir, "script-batches") : null;
  const retryForce = readRetryForce(executionDir);
  if (cacheDir && !retryForce) fs.mkdirSync(cacheDir, { recursive: true });

  // ── ① 全片框架（designTokens/全局 css/统一风格锚，后续每批共用） ──
  let frame;
  const frameCache = cacheDir && !retryForce ? path.join(cacheDir, "frame.json") : null;
  if (frameCache && fs.existsSync(frameCache)) {
    frame = JSON.parse(fs.readFileSync(frameCache, "utf-8"));
    console.log("[prompt-builder] frame 缓存命中");
  } else {
    frame = await generateFrame({ storyboard, styleSection, systemPrompt });
    if (frameCache) fs.writeFileSync(frameCache, JSON.stringify(frame, null, 2));
  }

  // ── ② 按 4 拍分批生成场景（单批失败只重试该批，产物缓存） ──
  const batches = chunkBeats(beats, BATCH_SIZE);
  const scenes = [];
  for (let i = 0; i < batches.length; i++) {
    const batchCache = cacheDir && !retryForce ? path.join(cacheDir, `batch-${i}.json`) : null;
    let batchScenes = null;
    if (batchCache && fs.existsSync(batchCache)) {
      try {
        const cached = JSON.parse(fs.readFileSync(batchCache, "utf-8"));
        if (validateBatchScenes(cached, batches[i]).length === 0) {
          batchScenes = cached;
          console.log(`[prompt-builder] 批 ${i + 1}/${batches.length} 缓存命中`);
        }
      } catch { /* 缓存损坏则重生成 */ }
    }
    if (!batchScenes) {
      const batchStart = Date.now();
      batchScenes = await generateBatch({ batchIndex: i, batchCount: batches.length, beats: batches[i], frame, styleSection, systemPrompt });
      console.log(`[prompt-builder] 批 ${i + 1}/${batches.length} 完成: ${batchScenes.length} 场景 (${((Date.now() - batchStart) / 1000).toFixed(1)}s, ${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
      if (batchCache) fs.writeFileSync(batchCache, JSON.stringify(batchScenes, null, 2));
    }
    scenes.push(...batchScenes);
  }

  // ── ③ 组装 + 整体校验（跨批问题的最终闸门；失败清缓存防死循环重试） ──
  const script = {
    schemaVersion: 1,
    title: title || frame.title || storyboard.title || "未命名",
    style: frame.style || "Neo-Brutalist",
    bgm_prompt: frame.bgm_prompt || storyboard.bgm_outline || "轻快电子",
    designTokens: frame.designTokens,
    css: frame.css || "",
    jsAnimation: frame.jsAnimation || "",
    scenes,
  };
  if (style && style !== "自动（AI 决定）") script.style = style;

  const schemaResult = validateScript(script);
  const htmlResult = schemaResult.ok ? validateHTML(schemaResult.script) : { ok: false, error: "schema 未过" };
  if (!schemaResult.ok || !htmlResult.ok) {
    if (cacheDir && fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
    throw ERRORS.SCRIPT_VALIDATION_FAILED(`${schemaResult.error || ""} ${htmlResult.error || ""}`.trim());
  }

  const warnings = checkScriptAgainstStoryboard(schemaResult.script, storyboard);
  for (const w of warnings) console.warn(`[prompt-builder] 分镜一致性: ${w}`);

  const stats = getScriptStats(schemaResult.script);
  console.log(`[prompt-builder] 分批完成: ${stats.sceneCount} 场景 / ${batches.length} 批 (${((Date.now() - startTime) / 1000).toFixed(1)}s total)`);
  return buildOutput(schemaResult.script);
}

async function generateFrame({ storyboard, styleSection, systemPrompt }) {
  const userPrompt = `${styleSection}

## 任务：生成全片框架（只出全局字段，不出场景）

根据分镜表输出 JSON（无其他文字）：
{ "title": "片名", "style": "风格名", "bgm_prompt": "结合情绪段落的配乐描述", "designTokens": { "palette": { "background": "#...", "primary": "#...", "secondary": "#..." }, "fonts": { "heading": "字体名", "body": "字体名" } }, "css": "全局共用基础样式（卡片/标签基础类；禁止重写 .clip 基类、禁止改 body）", "jsAnimation": "全局 GSAP 辅助代码（可为空字符串）" }

硬要求：
- designTokens 必须填充实对象（palette 三色 + fonts 二字体）——每个场景批次都会拿到这份框架锁风格
- 全片风格统一：配色/字体全片一套不换
- 确定性渲染铁律：jsAnimation 禁止 repeat:-1（无限循环）、Math.random()、Date.now()
- bgm_prompt 情绪参考：${storyboard.bgm_outline || "按内容自定"}

分镜概要（${storyboard.beats.length} 拍）：${storyboard.thesis || ""} ${storyboard.coreMetaphor || ""} ${JSON.stringify(storyboard.beats.map(b => ({ role: b.role, sceneType: b.sceneType })))}

输出：`;

  const allErrors = [];
  for (let attempt = 0; attempt < FRAME_ATTEMPTS; attempt++) {
    const retryHint = allErrors.length > 0 ? `\n\n## 之前失败，需修正：\n${allErrors.join("\n")}\n` : "";
    try {
      const { text } = await callLLM({ system: systemPrompt, user: userPrompt + retryHint, maxTokens: 8000 });
      const frame = parseJSON(text);
      if (!frame || typeof frame !== "object" || !frame.designTokens) {
        throw new Error("frame 缺少 designTokens");
      }
      console.log("[prompt-builder] frame 完成");
      return frame;
    } catch (e) {
      if (!allErrors.includes(e.message)) allErrors.push(e.message);
      console.warn(`[prompt-builder] frame 第 ${attempt + 1} 次失败: ${e.message}`);
    }
  }
  throw new Error(`全片框架生成失败（${FRAME_ATTEMPTS} 次尝试）:\n${allErrors.join("\n")}`);
}

async function generateBatch({ batchIndex, batchCount, beats, frame, styleSection, systemPrompt }) {
  const firstBeatNo = batchIndex * BATCH_SIZE + 1;
  const lastBeatNo = firstBeatNo + beats.length - 1;

  const userPrompt = `${styleSection}

## 已确认的全片框架（严格遵守：配色/字体/全局样式全片统一）

${JSON.stringify(frame, null, 2)}

## 任务：生成本批场景（全片第 ${firstBeatNo}–${lastBeatNo} 幕，共 ${beats.length} 幕）

严格按以下 beats 逐拍生成 scenes 数组，输出形如 {"scenes":[...]} 的 JSON 对象（无其他文字）：
- scenes 数组元素与 beats 一一对应、顺序一致，id 用 beat 的 id
- 每场景结构：{ "id": "拍id", "type": "role", "narration": "beat 的 narration 原句一字不改", "html": "...", "css": "本场景专属样式", "jsAnimation": "本场景 GSAP 动画" }
- html 必须含 class="clip" id="clip-{id}" data-duration="{durationSec}"，演出该拍 onScreen 描述，sceneType 决定布局骨架（stat-card/process-step/data-viz/comparison/quote/list）
- data-duration 用该拍 durationSec 的数值
- beat 的 note（若有）落进 html 小字（出处/示意标注），放不抢主体的角落
- class/id 必须全片唯一（可用 b{拍id}- 前缀防跨批撞名）
- 遵守全部设计规则与动画策略（每场景至少 1 个 GSAP 动画或声明式 data-animate 属性）
- **确定性渲染铁律：禁止 jsAnimation 出现 repeat:-1（无限循环）、Math.random()、Date.now()——微动效用有限 repeat（如 repeat: 4），否则逐帧渲染引擎直接报废**

本批 beats:
${JSON.stringify(beats, null, 2)}

输出（严格 JSON：{"scenes":[...]}）：`;

  const allErrors = [];
  let currentMaxTokens = 16000;
  for (let attempt = 0; attempt < BATCH_ATTEMPTS; attempt++) {
    const retryHint = allErrors.length > 0
      ? `\n\n## 之前校验失败，以下问题需一次性修正：\n${allErrors.join("\n")}\n`
      : "";
    console.log(`[prompt-builder] 批 ${batchIndex + 1}/${batchCount} 第 ${attempt + 1}/${BATCH_ATTEMPTS} 次尝试 (maxTokens=${currentMaxTokens})...`);

    try {
      const { text, usage } = await callLLM({
        system: systemPrompt,
        user: userPrompt + retryHint,
        maxTokens: currentMaxTokens,
      });
      const completionTokens = usage?.completionTokens || 0;
      if (completionTokens >= currentMaxTokens * 0.95 && currentMaxTokens < 32000) {
        currentMaxTokens = 32000;
        console.log(`[prompt-builder] 批 ${batchIndex + 1} 检测到截断 (completionTokens=${completionTokens})，下次 maxTokens → 32000`);
      }

      // json_object 模式强制顶层为对象：要求 {"scenes":[...]}，此处兼容裸数组
      const parsed = parseJSON(text);
      const scenes = Array.isArray(parsed) ? parsed : parsed?.scenes;
      const batchErrors = validateBatchScenes(scenes, beats);
      if (batchErrors.length > 0) {
        for (const e of batchErrors) if (!allErrors.includes(e)) allErrors.push(e);
        console.warn(`[prompt-builder] 批 ${batchIndex + 1} 校验失败: ${batchErrors.join("; ")}`);
        continue;
      }
      return scenes;
    } catch (e) {
      if (!allErrors.includes(e.message)) allErrors.push(e.message);
      console.warn(`[prompt-builder] 批 ${batchIndex + 1} 失败: ${e.message}`);
    }
  }
  throw new Error(`第 ${batchIndex + 1} 批场景生成失败（${BATCH_ATTEMPTS} 次尝试）:\n${allErrors.join("\n")}`);
}

/** 切批（纯函数，可测） */
export function chunkBeats(beats, size) {
  const result = [];
  for (let i = 0; i < beats.length; i += size) result.push(beats.slice(i, i + size));
  return result;
}

/** 批内校验（纯函数，可测）：数量/对应/旁白原句/clip 标记/时长/HTML 约束 */
export function validateBatchScenes(scenes, beats) {
  const errors = [];
  if (!Array.isArray(scenes)) return ["输出不是 JSON 数组"];
  if (scenes.length !== beats.length) {
    errors.push(`场景数 ${scenes.length} != 拍数 ${beats.length}`);
    return errors;
  }
  for (let i = 0; i < beats.length; i++) {
    const scene = scenes[i] || {};
    const beat = beats[i];
    const prefix = `拍 ${beat.id}`;
    if (String(scene.id) !== String(beat.id)) errors.push(`${prefix}: id 不匹配 (${scene.id})`);
    if (String(scene.narration || "").trim() !== String(beat.narration || "").trim()) {
      errors.push(`${prefix}: narration 与分镜原句不一致`);
    }
    const html = scene.html || "";
    if (!html) { errors.push(`${prefix}: html 为空`); continue; }
    const clipId = `clip-${beat.id}`;
    if (!html.includes(`id="${clipId}"`)) errors.push(`${prefix}: 缺少 id="${clipId}"`);
    if (!/class="[^"]*clip/.test(html)) errors.push(`${prefix}: 缺少 class="clip"`);
    const durMatch = html.match(/data-duration=["']?(\d+(?:\.\d+)?)["']?/);
    if (!durMatch) errors.push(`${prefix}: 缺少 data-duration`);
    else if (Math.abs(parseFloat(durMatch[1]) - (beat.durationSec ?? 0)) > 0.01) {
      errors.push(`${prefix}: data-duration=${durMatch[1]} != ${beat.durationSec}`);
    }
    if (/<script/i.test(html)) errors.push(`${prefix}: html 含 script 标签`);
    if (hasInfiniteRepeat(scene.jsAnimation)) {
      errors.push(`${prefix}: jsAnimation 含 repeat:-1 无限循环（确定性渲染硬杀手），改用有限次数如 repeat: 4`);
    }
    const remoteErr = validateNoRemoteResources(html);
    if (remoteErr) errors.push(`${prefix}: ${remoteErr}`);
  }
  return errors;
}

function buildOutput(script) {
  return {
    script: JSON.stringify(script, null, 2),
    validated: true,
    stats: getScriptStats(script),
    title: script.title,
    bgm_prompt: script.bgm_prompt,
    allHtml: script.scenes.map(s => s.html).join("\n"),
    allNarration: script.scenes.map(s => s.narration).join("\n"),
    css: script.css || "",
    jsAnimation: script.jsAnimation || "",
    scenesJson: JSON.stringify(script.scenes),
  };
}

/* ══════════ 路径二：单发生成（无分镜，旧路径原样保留） ══════════ */

async function generateScriptSingle({ title, content, style, startTime }) {
  const rules = loadScriptRules();
  const designRules = loadDesignRules();
  const inputContent = content || title;

  const userPickedStyle = style && style !== "自动（AI 决定）";
  const styleSection = userPickedStyle
    ? `\n## 指定风格\n用户选择: ${style}\n严格遵循以下风格指南：\n\n${loadStyleGuide(style)}`
    : "\n## 风格\n根据内容主题自由选择最合适的视觉风格";

  const systemPrompt = `${rules}\n\n${designRules}`;

  const userPrompt = `${styleSection}

## 本次任务

视频标题: ${title}
内容描述: ${inputContent}

输出：`;

  const allErrors = [];
  let currentMaxTokens = 16000;
  const MAX_TOKENS_CAP = 32000;

  for (let attempt = 0; attempt < 5; attempt++) {
    const retryHint = allErrors.length > 0
      ? `\n\n## 之前全部校验失败，以下所有问题都需一次性修正：\n${allErrors.join("\n")}\n`
      : "";

    const finalUserPrompt = retryHint ? `${userPrompt}${retryHint}` : userPrompt;

    console.log(`[prompt-builder] 第 ${attempt + 1}/5 次尝试 (maxTokens=${currentMaxTokens})...`);

    const { text, usage } = await callLLM({
      system: systemPrompt,
      user: finalUserPrompt,
      maxTokens: currentMaxTokens,
    });

    const completionTokens = usage?.completionTokens || 0;
    if ((completionTokens >= 7900 || completionTokens >= currentMaxTokens * 0.95) && currentMaxTokens < MAX_TOKENS_CAP) {
      const next = Math.min(currentMaxTokens * 2, MAX_TOKENS_CAP);
      console.log(`[prompt-builder] 检测到截断 (completionTokens=${completionTokens} >= ${currentMaxTokens}*0.95), 下次 maxTokens → ${next}`);
      currentMaxTokens = next;
    }

    try {
      const script = parseJSON(text);

      if (script && typeof script.schemaVersion === "string") {
        script.schemaVersion = Number(script.schemaVersion);
      }

      const schemaResult = validateScript(script);
      if (!schemaResult.ok) {
        schemaResult.error.split('\n').forEach(function(l) {
          var t = l.trim();
          if (t.startsWith('- ') && !allErrors.includes(t)) allErrors.push(t);
        });
        console.warn(`[prompt-builder] schema 校验失败: ${schemaResult.error}`);
        continue;
      }

      const htmlResult = validateHTML(schemaResult.script);
      if (!htmlResult.ok) {
        if (!allErrors.includes(htmlResult.error)) allErrors.push(htmlResult.error);
        console.warn(`[prompt-builder] HTML 校验失败: ${htmlResult.error}`);
        continue;
      }

      if (userPickedStyle && style) {
        schemaResult.script.style = style;
      }
      if (title) {
        schemaResult.script.title = title;
      }

      const stats = getScriptStats(schemaResult.script);
      console.log(`[prompt-builder] 完成: ${stats.sceneCount} 场景 (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
      return buildOutput(schemaResult.script);
    } catch (e) {
      if (!allErrors.includes(e.message)) allErrors.push(e.message);
      console.warn(`[prompt-builder] 解析失败: ${e.message}`);
    }
  }

  throw ERRORS.SCRIPT_VALIDATION_FAILED(allErrors.join("\n"));
}
