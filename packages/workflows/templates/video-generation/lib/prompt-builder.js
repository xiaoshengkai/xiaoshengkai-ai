import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLLM } from "../../../../shared/llm/index.js";
import { validateScript, validateHTML, getScriptStats } from "./schema.js";
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

function loadStyleGuide(style) {
  const name = style === "Neo-Brutalist" ? "neo-brutalist"
    : style === "奶油风" ? "cream"
    : style === "极简黑白" ? "bw"
    : "neo-brutalist";
  const p = path.join(__dirname, "..", "templates", "styles", `${name}.md`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
}

function parseJSON(text) {
  let cleaned = text.replace(/```\w*\n?|\n?```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) {
    const preview = cleaned.slice(0, 300);
    throw new Error(`未找到 JSON 起始符 { (文本长度=${cleaned.length})\n文本片段:\n${preview}...`);
  }

  let depth = 0, inString = false, escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch (e) {
          const snippet = cleaned.slice(Math.max(0, i - 100), Math.min(i + 100, cleaned.length));
          throw new Error(`JSON 语法错误 (位置 ${i}): ${e.message}\n文本片段:\n${snippet}`);
        }
      }
    }
  }
  const snippet = cleaned.slice(start, Math.min(start + 300, cleaned.length));
  throw new Error(`JSON 未闭合 (depth=${depth}, 文本长度=${cleaned.length})\n文本片段:\n${snippet}...`);
}

export async function generateScript(title, content, style) {
  const startTime = Date.now();
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

  let lastError;
  let currentMaxTokens = 8000;
  const MAX_TOKENS_CAP = 32000;

  for (let attempt = 0; attempt < 5; attempt++) {
    const retryHint = attempt > 0
      ? `\n\n## 上次校验失败，请修正后重新输出\n${lastError}\n`
      : "";

    const finalUserPrompt = retryHint ? `${userPrompt}${retryHint}` : userPrompt;

    console.log(`[prompt-builder] 第 ${attempt + 1}/5 次尝试 (maxTokens=${currentMaxTokens})...`);

    const { text, usage } = await callLLM({
      system: systemPrompt,
      user: finalUserPrompt,
      maxTokens: currentMaxTokens,
    });

    const completionTokens = usage?.completionTokens || 0;
    if (completionTokens >= currentMaxTokens * 0.95 && currentMaxTokens < MAX_TOKENS_CAP) {
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
        lastError = schemaResult.error;
        console.warn(`[prompt-builder] schema 校验失败: ${lastError}`);
        continue;
      }

      const htmlResult = validateHTML(schemaResult.script);
      if (!htmlResult.ok) {
        lastError = htmlResult.error;
        console.warn(`[prompt-builder] HTML 校验失败: ${lastError}`);
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
      lastError = e.message;
      console.warn(`[prompt-builder] 解析失败: ${lastError}`);
    }
  }

  throw ERRORS.SCRIPT_VALIDATION_FAILED(lastError);
}