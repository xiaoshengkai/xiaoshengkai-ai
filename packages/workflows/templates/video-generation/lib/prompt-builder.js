import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { validateScript, validateHTML, getScriptStats, checkScriptAgainstStoryboard } from "./schema.js";
import { ERRORS } from "./errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export async function generateScript(title, content, style, storyboardJson) {
  const startTime = Date.now();
  const rules = loadScriptRules();
  const designRules = loadDesignRules();
  const inputContent = content || title;

  // 分镜表阶段产物（旧执行/降级时为空字符串 → 走原有自由生成路径）
  let storyboard = null;
  if (storyboardJson && storyboardJson.trim()) {
    try {
      storyboard = typeof storyboardJson === "string" ? JSON.parse(storyboardJson) : storyboardJson;
    } catch {
      console.warn("[prompt-builder] storyboard JSON 解析失败，降级为自由生成");
    }
  }

  const userPickedStyle = style && style !== "自动（AI 决定）";
  const styleSection = userPickedStyle
    ? `\n## 指定风格\n用户选择: ${style}\n严格遵循以下风格指南：\n\n${loadStyleGuide(style)}`
    : "\n## 风格\n根据内容主题自由选择最合适的视觉风格";

  // 分镜表驱动：注入分镜表 + 讲解设计规则（句型→演法对照）
  const storyboardSection = storyboard
    ? `\n## 已确认分镜表（必须严格执行）

以下分镜表已经用户确认。场景生成必须逐拍对应（第 i 个场景执行第 i 拍）：

- **scenes 数量必须等于 beats 数量**，顺序一致
- **每场景 narration 使用对应 beat 的 narration 原句**（一字不改）
- **每场景 html 演出该 beat 的 onScreen 描述**：屏上出现的就是 onScreen 里的东西，发生的动作就是 presentAction 对应的演法
- **beat 的 note 落进场景 HTML 小字**：数字出处或"示意"标注（如"国家统计局 2022""示意"），放在不抢主体的角落
- **instrument 常驻读数**：若分镜表声明了仪器，相关场景以相同位置/相同样式复现该读数元素，读数随内容变化（"常驻"= 多场景同位复现）
- **每场景 data-duration 使用对应 beat 的 durationSec**（已按 TTS 语速公式算好）
- sceneType 决定布局骨架（stat-card/process-step/data-viz/comparison/quote/list）

分镜表:
\`\`\`json
${typeof storyboardJson === "string" ? storyboardJson : JSON.stringify(storyboard, null, 2)}
\`\`\`

bgm_prompt 需结合分镜表的情绪段落结构（bgm_outline）编写。`
    : "";

  const systemPrompt = storyboard
    ? `${rules}\n\n${designRules}\n\n${loadVisualizationRules()}`
    : `${rules}\n\n${designRules}`;

  const userPrompt = `${styleSection}${storyboardSection}

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

      // 分镜一致性软校验：只告警不否决
      if (storyboard) {
        const warnings = checkScriptAgainstStoryboard(schemaResult.script, storyboard);
        for (const w of warnings) console.warn(`[prompt-builder] 分镜一致性: ${w}`);
      }

      if (userPickedStyle && style) {
        schemaResult.script.style = style;
      }
      if (title) {
        schemaResult.script.title = title;
      }

      const stats = getScriptStats(schemaResult.script);
      console.log(`[prompt-builder] 完成: ${stats.sceneCount} 场景 (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
      return {
        script: JSON.stringify(schemaResult.script, null, 2),
        validated: true,
        stats,
        title: schemaResult.script.title,
        bgm_prompt: schemaResult.script.bgm_prompt,
        allHtml: schemaResult.script.scenes.map(s => s.html).join("\n"),
        allNarration: schemaResult.script.scenes.map(s => s.narration).join("\n"),
        css: schemaResult.script.css || "",
        jsAnimation: schemaResult.script.jsAnimation || "",
        scenesJson: JSON.stringify(schemaResult.script.scenes),
      };
    } catch (e) {
      if (!allErrors.includes(e.message)) allErrors.push(e.message);
      console.warn(`[prompt-builder] 解析失败: ${e.message}`);
    }
  }

  throw ERRORS.SCRIPT_VALIDATION_FAILED(allErrors.join("\n"));
}