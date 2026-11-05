/**
 * vibe-video 分镜表步骤（storyboard）+ 确认动作：
 * - generateStoryboard：LLM 按叙事规则出双语字幕分镜表（拍/中文字幕/英文字幕/章节/呈现动作），停靠 awaiting_input
 * - handleStoryboardConfirm：feedback 空 = 确认放行；非空 = 回 pending 带反馈重生成（person-research 同款 rearm 模式）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { validateStoryboard } from "./schema.js";
import { DATA_DIR, LOG_DIR, readState, writeState } from "../../../lib/state.js";
import { createDateLogger } from "@app/shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadNarrativeRules() {
  const dir = path.join(__dirname, "..", "narrative-rules");
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".md")).sort();
  return files.map(f => fs.readFileSync(path.join(dir, f), "utf-8")).join("\n\n");
}

const OUTPUT_SPEC = `
## 输出格式（严格 JSON，无其他文字）

{
  "schemaVersion": 1,
  "title": "片名（2-5 字，是概念本身或一个意象；定片名时把末句一起想好）",
  "thesis": "一句话论点（因果断言，如：不是A导致B，是B压低了A）",
  "coreMetaphor": "全片唯一核心比喻，开场就能画出来的具体东西",
  "instrument": "常驻读数计划：画面上挂什么仪器（表盘/进度条/计数），量什么、读数怎么随内容变化",
  "suspensePlan": "悬念在第几拍埋、第几拍解，具体到一个数或一个答案",
  "reversals": 2,
  "chapters": [
    { "label": "章节标签（≤8字，如：游戏规则）", "note": "章节屏上注释（出处/示意标注，可空）" }
  ],
  "beats": [
    {
      "id": 1,
      "role": "hook",
      "chapter": 0,
      "zh": "中文主句（≤20字，可含「强调词」≤1处）",
      "en": "English line (意译，短于中文)",
      "presentAction": "六种呈现动作之一 / 停住 / 回场 / 合体",
      "onScreen": "屏上是什么、在干什么（一个日常的词 + 一个动词）",
      "note": "屏上小字：数字出处（如：国家统计局 2022）或'示意'；无数字留空",
      "takeaway": "观众明白了什么（一句能与上一拍区分开的话）"
    }
  ]
}

字段约定：
- role 取值：hook / title / story / model / reveal / landing / outro
- title 拍：片名卡时刻（10-25% 处），zh 写副题问句、en 写英文副题；系统按它生成片名卡，该拍无字幕只有片名卡
- chapter 取值 0..n-1，按 beats 顺序连续分组；每章 3-6 章、每章 4-14 拍
- presentAction 取值：让观众动手 / 照句子演 / 小题现场跑 / 同版式对照 / 收进一张图 / 停住亮字 / 停住 / 回场 / 合体
- 不填 durationSec：系统按字幕字数自动计时（约 5-7 字/秒 + 呼吸）
- beats 25-40 拍（总时长 90-150 秒），按逐拍骨架填空

数字纪律：
- 每个含数字的拍，note 必须给出处或标"示意"；查不到可靠出处的数字不写
- 模拟类数字一律标"示意"

输出前自查（违反即重写）：
- 每一拍的 zh 和 en 都非空（缺任何一拍即失败）
- beats 总数在 8-45 之间（目标 25-36）
- chapter 索引从 0 连续递增到 chapters.length-1`;

export async function generateStoryboard(title, content, contentRequirement, style, orientation, executionDir) {
  const execId = path.basename(executionDir);
  const logger = createDateLogger("workflows", LOG_DIR, execId);
  const startTime = Date.now();

  // 修订模式：从 state 取反馈与旧版分镜
  let feedback = null;
  let previousStoryboard = null;
  try {
    const state = readState(executionDir);
    feedback = state?.storyboardTask?.feedback || null;
    const step = state?.steps?.find(s => s.id === "storyboard");
    if (step?.output?.storyboard) previousStoryboard = step.output.storyboard;
  } catch { /* state 不可读则全新生成 */ }

  const rules = loadNarrativeRules();
  const inputContent = content || title;

  const styleLine = style === "糖果色 Neo-Brutalism"
    ? "视觉主题：糖果色 Neo-Brutalism（纯白底/电光黄/黑边硬阴影卡片/Archivo 黑体）——画面想象围绕该风格"
    : "视觉主题：Vibe 深空金（深蓝黑底/金色衬线/纸艺母题）——画面想象围绕该风格";
  const orientationLine = orientation === "portrait"
    ? "画幅：竖屏 1080×1920（抖音信息流）——屏上构图按竖向想象"
    : "画幅：横屏 1920×1080（知识区大片）——屏上构图按横向想象";

  let userPrompt = `## 本次任务

为以下知识短片生成分镜表（只出分镜表，不出场景代码）：
- 标题: ${title}
- 内容: ${inputContent}
- ${styleLine}
- ${orientationLine}
${contentRequirement ? `- 内容要求: ${contentRequirement}` : ""}

按逐拍骨架填空，先自查（悬念埋/解位置、反转层数、末拍回扣钩子），再输出。`;

  if (feedback && previousStoryboard) {
    userPrompt += `

## 修订模式（以下反馈针对旧版分镜，逐条落实）

反馈: ${feedback}

旧版分镜表:
${previousStoryboard}

输出修订后的完整分镜表（全量，不是 diff）。`;
  }

  const allErrors = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const retryHint = allErrors.length > 0
      ? `\n\n## 之前校验失败，以下问题需一次性修正：\n${allErrors.join("\n")}\n`
      : "";
    logger.info(`[storyboard] 第 ${attempt + 1}/5 次尝试${feedback ? "（修订模式）" : ""}...`);

    try {
      const { text } = await callLLM({
        system: `${rules}\n\n${OUTPUT_SPEC}`,
        user: userPrompt + retryHint,
        maxTokens: 16000,
      });

      const result = validateStoryboard(parseJSON(text));
      if (!result.ok) {
        if (!allErrors.includes(result.error)) allErrors.push(result.error);
        logger.warn(`[storyboard] 校验失败: ${result.error}`);
        continue;
      }

      const sb = result.storyboard;
      const totalSec = sb.beats.reduce((sum, b) => sum + (b.durationSec || 3), 0);
      logger.info(`[storyboard] 完成: ${sb.beats.length} 拍 / ${sb.chapters.length} 章 / 约 ${totalSec.toFixed(0)}s (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
      return {
        storyboard: JSON.stringify(sb, null, 2),
        beatCount: sb.beats.length,
        chapterCount: sb.chapters.length,
        totalDurationSec: Math.round(totalSec),
        thesis: sb.thesis || "",
        coreMetaphor: sb.coreMetaphor || "",
        instrument: sb.instrument || "",
        suspensePlan: sb.suspensePlan || "",
        reversals: sb.reversals ?? 0,
      };
    } catch (e) {
      if (!allErrors.includes(e.message)) allErrors.push(e.message);
      logger.warn(`[storyboard] 失败: ${e.message}`);
    }
  }

  throw new Error(`分镜表生成失败（5 次尝试）:\n${allErrors.join("\n")}`);
}

export async function handleStoryboardConfirm({ params, request }) {
  const { feedback } = await request.json().catch(() => ({}));
  const dir = path.join(DATA_DIR, params.id);
  if (!fs.existsSync(path.join(dir, "state.json"))) {
    return { ok: false, error: "not found" };
  }
  const state = readState(dir);
  if (state.template !== "vibe-video") {
    return { ok: false, error: "非 vibe-video 任务" };
  }
  if (state.status !== "awaiting_input") {
    return { ok: false, error: "当前不在等待确认状态" };
  }
  const step = state.steps.find(s => s.id === "storyboard");
  if (!step) return { ok: false, error: "未找到分镜表步骤" };

  const text = feedback ? String(feedback).trim() : "";
  if (text) {
    state.storyboardTask = { feedback: text, at: new Date().toISOString() };
    step.status = "pending";
    step.output = null;
    step.error = null;
    step.startedAt = null;
    step.elapsed = null;
    state.status = "running";
    writeState(dir, state);
    return { ok: true, mode: "revising" };
  }

  delete state.storyboardTask;
  state.status = "running";
  writeState(dir, state);
  return { ok: true, mode: "confirmed" };
}
