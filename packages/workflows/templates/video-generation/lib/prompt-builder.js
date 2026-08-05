import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLLM } from "../../../../shared/llm/index.js";
import { validateScript, validateHTML, getScriptStats } from "../schema.js";
import { ERRORS } from "./errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadScriptRules() {
  const p = path.join(__dirname, "..", "script-rules.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
}

function parseJSON(text) {
  let cleaned = text.replace(/```\w*\n?|\n?```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("未找到 JSON");

  let depth = 0, inString = false, escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"' && !inString) { inString = true; continue; }
    if (ch === '"' && inString) { inString = false; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)); }
  }
  throw new Error("JSON 未闭合");
}

export async function generateScript(title, content, style) {
  const startTime = Date.now();
  const rules = loadScriptRules();
  const inputContent = content || title;
  const styleGuide = style || "Neo-Brutalist";

  let basePrompt = `${rules}

## 本次任务

视频标题: ${title}
内容描述: ${inputContent}
视觉风格: ${styleGuide}

## 输出要求

- 严格 JSON，无其他文字
- 数字必须拼读（narration 中）
- 每个场景的 html 必须包含 class="clip" 和 data-duration
- 场景数 3-12 个
- 第一场是 hook，最后一场是 outro
- 内联样式用 style 属性，禁止 class 样式
- 禁止 <script> 标签，禁止 jQuery

输出：`;

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const prompt = attempt === 0
      ? basePrompt
      : `${basePrompt}\n\n上次校验失败：${lastError}\n请修正后重新输出：`;

    console.log(`[prompt-builder] 第 ${attempt + 1} 次尝试...`);

    const { text } = await callLLM({
      system: "你是一个专业的短视频脚本策划，严格按规则输出 JSON。",
      user: prompt,
      maxTokens: 8000,
    });

    try {
      const script = parseJSON(text);

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
      };
    } catch (e) {
      lastError = e.message;
      console.warn(`[prompt-builder] 解析失败: ${lastError}`);
    }
  }

  throw ERRORS.SCRIPT_VALIDATION_FAILED(lastError);
}