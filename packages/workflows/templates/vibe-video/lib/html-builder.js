/**
 * vibe-video html 步骤：骨架填充式生成 index.html（render(t) 纯函数契约）
 * ① 数据表确定性组装（分镜 beats → CFG/SUBTITLES/TITLE_CARD/SECTIONS，零 LLM）
 * ② 章节场景函数分批 LLM 生成（每章一函数 2-4k token，批内 lint + 缓存 + retryForce）
 * ③ 组装 + puppeteer 冒烟校验（加载页面跑遍采样时刻，坏代码活不到 30 分钟渲染）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { callLLM } from "@app/shared/llm/index.js";
import { validateStoryboard, validateSceneBatch, validateHtmlString } from "./schema.js";
import { findChromeExecutable } from "./browser.js";
import { LOG_DIR } from "../../../lib/state.js";
import { createDateLogger } from "@app/shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKELETON_PATH = path.resolve(__dirname, "..", "assets", "skeleton.html");
const FONTS_DIR = path.resolve(__dirname, "..", "assets", "fonts");
const CHAPTER_ATTEMPTS = 3;

/* ───────── 场景函数写作契约（每批 system prompt 核心） ───────── */
const SCENE_API_DOC = `# 场景函数写作契约（严格遵守，违反即校验失败）

你写的是"纯时间函数"渲染代码：骨架加载后 window.render(t) 每帧调用你的章节函数，t 为全片秒数。

## 可用全局（直接使用，禁止自己重定义）
- W, H：画布宽高（横屏 1920×1080 / 竖屏 1080×1920）；SC：比例尺 = min(W,H)/1080——所有尺寸/字号/坐标一律乘 SC 或用 W/H 比例
- scc：中央动画区画布 2D context（画你的一切）；rnd：固定种子随机数发生器（确定性，可放心用）
- T：当前主题对象——取色只允许 T.accent(强调) / T.ink(正文) / T.dim(注释) / T.alert(警示) / T.paper(卡底) / T.paperInk(卡上字)；字体 T.headFont / T.uiFont
- 工具：clamp(x,a,b) / lerp(a,b,t) / easeInOut(t) / easeOut(t) / easeOutBack(t) / fade(t,a,b,fin,fout)（出现-停留-消失包络）
- 布局：中央动画区纵向 8%~65%（sceneTop=H*0.08, sceneBottom=H*0.65）；y70% 是注释带、y84% 字幕带——你的元素不许伸进 66% 以下
- 母题函数（优先复用，不要裸写卡片）：
  - drawCard(c, x, y, w, h, rot, t)：主题卡片（vibe 纸艺软阴影 / candy 黑边硬阴影）；返回 {w,h,ink}（已乘 SC）
  - cardText(c, text, x, y, size, font?, color?)：卡上大字（size 乘 SC）
  - drawSeal(c, x, y, text)：印章/标签（vibe 红印章 / candy 黄块标签）
  - rollNumber(c, target, k, x, y, size, color?, font?)：数字滚动（k 走 0→1，先快后慢）
  - drawGauge(c, x, y, w, h, frac, label)：进度/量尺
  - drawClothesline(c, t, cards)：晾衣绳卡片串
  - txt(c, text, x, y, font, color, align?, baseline?)：低层文字（font 字符串自己拼，含 *SC）

## 硬性铁律（lint 拒绝）
1. 画面只由 t 决定：禁止 Math.random / Date.now / new Date / setTimeout / setInterval / requestAnimationFrame / performance.now
2. 禁止硬编码颜色（#hex）与画幅数字（1920/1080）——用 T.* 与 W/H/SC
3. 禁止改写 window.render、禁止操作 DOM（只用 canvas API 画 scc）
4. 每个函数只画自己章节时间窗内的画面；函数开头取本地时间 lt = t - 章起点，章内全用 lt
5. 出现-消失用 fade(t, 窗起点, 窗终点, 0.5, 0.5) 乘 globalAlpha；章与章重叠 0.5s 由骨架调度，你不用管
6. 画面密度与主体：每个时刻中央区必须有占 ≥30% 的可见主体（卡片/图形/大数字/演示装置），禁止只留字幕或大面积空白；同一画面停留 ≤4s 必须有新元素进场或微动（摆动/闪烁/计数跳）
7. 构图边界（重叠/溢出即失败）：所有元素坐标按 W/H 比例定位并 clamp 在画布内（x ∈ [0.06W, 0.94W]，y ∈ [sceneTop, sceneBottom]）；两组文字的包围盒不许互相重叠；竖屏宽仅 1080：并排元素 ≤ 4 个、卡片宽 ≤ 0.42W，元素上下排布
7. 数字滚动/计数要真数：值 = 目标 × easeOut(seg(...))，先算后画

## 写法
function sceneN(t) {
  var lt = t - 起点秒;
  // 按 beats 的 start/end 逐拍安排画面动作
  var k = easeInOut(clamp((lt - 1.2) / 1.5, 0, 1));
  scc.globalAlpha = k;
  drawCard(scc, W / 2, H * 0.35, 320, 180, 0, t);
  cardText(scc, '关键词', W / 2, H * 0.35, 64);
  scc.globalAlpha = 1;
}
只输出 JS 函数代码（无 markdown 围栏、无解释文字），每章一个 function sceneN(t)。`;

/* ───────── 数据表确定性组装 ───────── */

function zhToHtml(zh) {
  return String(zh).replace(/「([^」]*)」/g, "<em>$1</em>");
}

export function buildDataJS(sb, { title, theme, orientation, watermark }) {
  /* 累计时间轴 */
  let t = 0;
  const timed = sb.beats.map(b => {
    const start = +t.toFixed(1);
    const end = +(t + (b.durationSec || 3)).toFixed(1);
    t = end;
    return { ...b, start, end };
  });
  const duration = +t.toFixed(1);

  /* 字幕表（title 拍不进字幕，进片名卡） */
  const subtitles = [];
  let titleCard = null;
  for (const b of timed) {
    if (b.role === "title") {
      titleCard = [b.start, b.end, `《${sb.title || title}》`, b.zh, b.en];
    } else {
      subtitles.push([b.start, b.end, zhToHtml(b.zh), b.en]);
    }
  }
  if (!titleCard) titleCard = [Math.min(4, duration * 0.12), Math.min(4, duration * 0.12) + 6, `《${sb.title || title}》`, "", ""];

  /* 章节表：SECTIONS（顶标签/注释）+ CHAPTERS（场景调度，含每拍时间，给场景函数对齐字幕） */
  const sections = [];
  const chapters = [];
  const chapterIdxSet = new Set(timed.map(b => b.chapter));
  for (let ci = 0; ci < sb.chapters.length; ci++) {
    if (!chapterIdxSet.has(ci)) continue;
    const ch = sb.chapters[ci];
    const beats = timed.filter(b => b.chapter === ci);
    if (beats.length === 0) continue;
    const start = beats[0].start;
    const end = beats[beats.length - 1].end;
    sections.push([start, ch.label || "", ch.note || ""]);
    chapters.push({
      index: chapters.length,
      label: ch.label || `第${ci + 1}章`,
      start,
      end: +end.toFixed(1),
      beats: beats.map(b => ({
        start: b.start, end: b.end, zh: b.zh, en: b.en,
        onScreen: b.onScreen, presentAction: b.presentAction, note: b.note || "", role: b.role,
      })),
    });
  }

  const cfg = {
    duration, fps: 30,
    orientation: orientation === "portrait" ? "portrait" : "landscape",
    theme: theme === "candy" ? "candy" : "vibe",
    topic: sb.title || title || "",
    watermark: watermark || "",
  };

  return {
    dataJS: `var CFG = ${JSON.stringify(cfg, null, 2)};\nvar SUBTITLES = ${JSON.stringify(subtitles)};\nvar TITLE_CARD = ${JSON.stringify(titleCard)};\nvar SECTIONS = ${JSON.stringify(sections)};`,
    chapters,
    duration,
    subtitles,
  };
}

/* ───────── 章节场景函数生成（每章一调用） ───────── */

async function generateChapterScenes({ chapter, chapterCount, theme, orientation, sb, systemPrompt, logger }) {
  const userPrompt = `## 全片设定
- 主题: ${theme === "candy" ? "糖果色 Neo-Brutalism（纯白底/电光黄强调/黑边硬阴影卡片）" : "Vibe 深空金（深蓝黑底/金色强调/纸艺卡）"}
- 画幅: ${orientation === "portrait" ? "竖屏 1080×1920（构图竖向，元素上下排布）" : "横屏 1920×1080（构图横向）"}
- 全片论点: ${sb.thesis || ""}
- 核心比喻: ${sb.coreMetaphor || ""}${sb.instrument ? `\n- 常驻仪器: ${sb.instrument}（相关拍让读数变化）` : ""}
- 本章（第 ${chapter.index + 1}/${chapterCount} 章 ${chapter.label}）时间窗: ${chapter.start}s ~ ${chapter.end}s

## 本章逐拍（每拍 = 屏幕时间窗 + 双语字幕 + 屏上动作）
${JSON.stringify(chapter.beats, null, 2)}

## 任务
写 function scene${chapter.index}(t) 演出本章全部画面：
- 逐拍对照 zh/onScreen/presentAction：字幕说的名词屏上要出现，动词真的发生
- 每拍至少一个进场或变化动作（用包络/滚动/计数）；常驻元素微动保证画面一直在动
- 数字类内容用 rollNumber 真数；note 里的出处画成角落小字（txt + 24px + T.dim）
- 只输出 JS 函数代码。`;

  const errors = [];
  for (let attempt = 0; attempt < CHAPTER_ATTEMPTS; attempt++) {
    const retryHint = errors.length > 0 ? `\n\n## 之前校验失败，修正后重发：\n${errors.join("\n")}\n` : "";
    logger.info(`[html] 章 ${chapter.index + 1}/${chapterCount} 第 ${attempt + 1}/${CHAPTER_ATTEMPTS} 次尝试...`);
    try {
      const { text } = await callLLM({
        system: systemPrompt,
        user: userPrompt + retryHint,
        maxTokens: 8000,
        format: null, /* 场景函数是裸 JS 代码，不走 json_object 模式 */
      });
      let code = String(text).trim();
      code = code.replace(/^```(?:js|javascript)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const lintErrors = validateSceneBatch(code, [`scene${chapter.index}`]);
      if (lintErrors.length > 0) {
        for (const e of lintErrors) if (!errors.includes(e)) errors.push(e);
        logger.warn(`[html] 章 ${chapter.index + 1} lint 失败: ${lintErrors.join("; ")}`);
        continue;
      }
      return code;
    } catch (e) {
      if (!errors.includes(e.message)) errors.push(e.message);
      logger.warn(`[html] 章 ${chapter.index + 1} 失败: ${e.message}`);
    }
  }
  throw new Error(`第 ${chapter.index + 1} 章场景函数生成失败（${CHAPTER_ATTEMPTS} 次尝试）:\n${errors.join("\n")}`);
}

/* ───────── 冒烟校验（渲染前的黑屏防火墙） ───────── */

async function smokeValidate(htmlPath, duration, logger) {
  const browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(e.message.slice(0, 200)));
    page.on("console", m => {
      if (m.type() === "error" || (m.type() === "warning" && m.text().includes("[scene"))) {
        pageErrors.push(m.text().slice(0, 200));
      }
    });
    try {
      await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0", timeout: 60000 });
    } catch (e) {
      /* 导航异常（偶发挂起）也走失败路径：保住缓存清理与干净报错 */
      return { ok: false, errors: [`页面加载失败: ${e.message.slice(0, 150)}`] };
    }
    await page.evaluate(() => document.fonts.ready);
    const samples = Math.min(20, Math.max(8, Math.ceil(duration / 5)));
    let result;
    try {
      result = await page.evaluate((n) => {
        if (typeof window.getRenderMeta !== "function") return { meta: null, errs: ["页面脚本未执行完（window.getRenderMeta 缺失——注入代码可能有语法错误）"] };
        const meta = window.getRenderMeta();
        const errs = [];
        for (let i = 0; i <= n; i++) {
          const t = (meta.duration * i) / n;
          try { window.render(t); } catch (e) { errs.push(`t=${t.toFixed(1)}s: ${e.message}`); }
        }
        return { meta, errs };
      }, samples);
    } catch (e) {
      return { ok: false, errors: [`页面执行失败: ${e.message.slice(0, 150)}`] };
    }
    const allErrors = [...pageErrors, ...result.errs];
    if (allErrors.length > 0) {
      logger.warn(`[html] 冒烟失败: ${allErrors.slice(0, 5).join(" | ")}`);
      return { ok: false, errors: allErrors, meta: result.meta };
    }
    logger.info(`[html] 冒烟通过: ${result.meta.chapters} 章 / ${result.meta.duration}s / ${result.meta.W}x${result.meta.H}`);
    return { ok: true, meta: result.meta };
  } finally {
    await browser.close();
  }
}

/* ───────── 主入口 ───────── */

function readRetryForce(executionDir) {
  if (!executionDir) return false;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(executionDir, "state.json"), "utf-8"));
    return Boolean(state.steps?.find(s => s.id === "html")?.retryForce);
  } catch {
    return false;
  }
}

export async function generateHtml(executionDir, title, style, orientationParam, watermark, storyboardJson) {
  const execId = path.basename(executionDir);
  const logger = createDateLogger("workflows", LOG_DIR, execId);
  const startTime = Date.now();

  const theme = style === "糖果色 Neo-Brutalism" ? "candy" : "vibe";
  const orientation = String(orientationParam || "").includes("竖") ? "portrait" : "landscape";
  const sbResult = validateStoryboard(storyboardJson);
  if (!sbResult.ok) throw new Error(`分镜表校验失败: ${sbResult.error}`);
  const sb = sbResult.storyboard;

  /* ① 数据表（确定性，零 LLM） */
  const { dataJS, chapters, duration } = buildDataJS(sb, { title, theme, orientation, watermark });

  /* ② 章节场景函数（每章一调用，缓存按 主题+画幅 隔离防撞车，retryForce 全失效） */
  const cacheDir = executionDir ? path.join(executionDir, "html-batches", `${theme}-${orientation === "portrait" ? "portrait" : "landscape"}`) : null;
  const retryForce = readRetryForce(executionDir);
  if (cacheDir && !retryForce) fs.mkdirSync(cacheDir, { recursive: true });

  const systemPrompt = SCENE_API_DOC;
  const sceneCodes = [];
  for (const chapter of chapters) {
    const cachePath = cacheDir && !retryForce ? path.join(cacheDir, `chapter-${chapter.index}.js`) : null;
    let code = null;
    if (cachePath && fs.existsSync(cachePath)) {
      const cached = fs.readFileSync(cachePath, "utf-8");
      if (validateSceneBatch(cached, [`scene${chapter.index}`]).length === 0) {
        code = cached;
        logger.info(`[html] 章 ${chapter.index + 1}/${chapters.length} 缓存命中`);
      }
    }
    if (!code) {
      const t0 = Date.now();
      code = await generateChapterScenes({ chapter, chapterCount: chapters.length, theme, orientation, sb, systemPrompt, logger });
      logger.info(`[html] 章 ${chapter.index + 1}/${chapters.length} 完成 (${((Date.now() - t0) / 1000).toFixed(1)}s, ${code.length} 字符)`);
      if (cachePath) fs.writeFileSync(cachePath, code);
    }
    sceneCodes.push(code);
  }

  /* ③ 组装 */
  const skeleton = fs.readFileSync(SKELETON_PATH, "utf-8");
  const chapterTables = chapters.map((ch, i) => ({
    start: ch.start, end: ch.end, label: ch.label, fn: `scene${i}`,
  }));
  const scenesJS = `${sceneCodes.join("\n\n")}\n\nvar CHAPTERS = ${JSON.stringify(chapterTables, null, 2).replace(/"fn": "scene(\d+)"/g, '"fn": scene$1')};`;
  let html = skeleton.replace("/*__DATA__*/", dataJS).replace("/*__SCENES__*/", scenesJS);

  const staticErrors = validateHtmlString(html);
  if (staticErrors.length > 0) {
    throw new Error(`组装校验失败: ${staticErrors.join("; ")}`);
  }

  /* 写盘：index.html + fonts/（iframe 实时预览 + 渲染共用） */
  fs.writeFileSync(path.join(executionDir, "index.html"), html);
  const destFonts = path.join(executionDir, "fonts");
  if (!fs.existsSync(destFonts)) fs.cpSync(FONTS_DIR, destFonts, { recursive: true });

  /* ④ 冒烟校验（失败清章节缓存防重试死循环） */
  const smoke = await smokeValidate(path.join(executionDir, "index.html"), duration, logger);
  if (!smoke.ok) {
    const batchesRoot = path.join(executionDir, "html-batches");
    if (fs.existsSync(batchesRoot)) fs.rmSync(batchesRoot, { recursive: true, force: true });
    throw new Error(`页面冒烟校验失败（坏代码活不到渲染）:\n${smoke.errors.slice(0, 5).join("\n")}`);
  }

  logger.info(`[html] 完成: ${chapters.length} 章 / ${duration}s / ${theme} / ${smoke.meta.W}x${smoke.meta.H} (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
  return {
    htmlFile: "index.html",
    durationSec: duration,
    chapterCount: chapters.length,
    theme,
    orientation: smoke.meta.orientation || orientation,
    width: smoke.meta.W,
    height: smoke.meta.H,
  };
}
