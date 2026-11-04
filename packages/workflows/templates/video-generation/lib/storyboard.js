/**
 * video-generation 分镜表步骤（storyboard）+ 确认动作：
 * - generateStoryboard：LLM 按叙事规则出分镜表（拍/旁白/呈现动作/屏上动作），步骤完成后引擎停靠 awaiting_input
 * - handleStoryboardConfirm（custom handler）：feedback 空 = 确认放行；非空 = 回 pending 带反馈重生成
 *   （前端随后调既有 POST /execution/:id/auto 驱动，person-research 同款 rearm 模式）
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
  "title": "片名（2-5 字，是概念本身或一个意象）",
  "coreMetaphor": "全片唯一核心比喻，开场就能画出来的具体东西",
  "suspensePlan": "悬念在第几拍埋、第几拍解，具体到一个数或一个答案",
  "reversals": 2,
  "bgm_outline": "按段落百分比描述情绪起伏，如：0-25% 平静铺垫；25-70% 渐强推进；70-85% 高潮揭晓；85-100% 收束回落",
  "beats": [
    {
      "id": 1,
      "role": "hook",
      "narration": "本拍旁白句（15-30 字，中文口语，数字拼读）",
      "presentAction": "六种呈现动作之一 / 停住 / 回场 / 合体",
      "onScreen": "屏上是什么、在干什么（一个日常的词 + 一个动词）",
      "sceneType": "stat-card"
    }
  ]
}

字段约定：
- role 取值：hook / title / story / model / reveal / landing / outro
- presentAction 取值：让观众动手 / 照句子演 / 小题现场跑 / 同版式对照 / 收进一张图 / 停住亮字 / 停住 / 回场 / 合体
- sceneType 取值（与场景实现共用一套词汇）：
  - stat-card：大数字 + 单位 + 副标题
  - process-step：STEP 标签 + 步骤标题 + 简短说明
  - data-viz：可视化数据（柱状图/饼图/进度条/节点图/折线）
  - comparison：左右对比（A vs B）
  - quote：大字金句 + 装饰
  - list：多项目列表（icon + 文字）
- 不填 durationSec：系统按 4.5 字/秒语速公式自动计算
- beats 数量即后续场景数量，8-20 拍，按逐拍骨架填空`;

export async function generateStoryboard(title, content, style, contentRequirement, executionDir) {
  const execId = path.basename(executionDir);
  const logger = createDateLogger("workflows", LOG_DIR, execId);
  const startTime = Date.now();

  // 修订模式：从 state 取反馈与旧版分镜（storyboard-confirm 动作写入）
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

  const styleSection = style && style !== "自动（AI 决定）"
    ? `视觉风格约束: ${style}（分镜的画面想象围绕该风格）`
    : "视觉风格: 自由选择最合适的";

  let userPrompt = `## 本次任务

为以下短视频生成分镜表（只出分镜表，不出场景 HTML）：
- 标题: ${title}
- 内容: ${inputContent}
- ${styleSection}
${contentRequirement ? `- 内容要求: ${contentRequirement}` : ""}

按逐拍骨架填空，先自查三件事（悬念埋/解位置、反转层数、末拍呼应钩子），再输出。`;

  if (feedback && previousStoryboard) {
    userPrompt += `

## 修订模式（以下反馈针对旧版分镜表，逐条落实）

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
      });

      const result = validateStoryboard(parseJSON(text));
      if (!result.ok) {
        if (!allErrors.includes(result.error)) allErrors.push(result.error);
        logger.warn(`[storyboard] 校验失败: ${result.error}`);
        continue;
      }

      const sb = result.storyboard;
      const totalSec = sb.beats.reduce((sum, b) => sum + (b.durationSec || 3), 0);
      logger.info(`[storyboard] 完成: ${sb.beats.length} 拍 / 约 ${totalSec.toFixed(0)}s (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
      return {
        storyboard: JSON.stringify(sb, null, 2),
        beatCount: sb.beats.length,
        totalDurationSec: Math.round(totalSec),
        coreMetaphor: sb.coreMetaphor || "",
        suspensePlan: sb.suspensePlan || "",
        reversals: sb.reversals ?? 0,
        bgm_outline: sb.bgm_outline || "",
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
  if (state.template !== "video-generation") {
    return { ok: false, error: "非 video-generation 任务" };
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
