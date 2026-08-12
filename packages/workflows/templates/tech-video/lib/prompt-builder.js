import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLLM } from "../../../../shared/llm/index.js";
import { parseJSON } from "../../../../shared/llm/parse-json.js";
import { validateScript, getScriptStats } from "../schema.js";
import { ERRORS } from "./errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadScriptRules() {
  return fs.readFileSync(path.join(__dirname, "..", "script-rules.md"), "utf-8");
}

function loadExample() {
  return fs.readFileSync(path.join(__dirname, "example-script.json"), "utf-8");
}

// parseJSON — 已迁到 shared/llm/parse-json.js

export async function generateScript(title, content) {
  const startTime = Date.now();
  const rules = loadScriptRules();
  const example = loadExample();

  const inputContent = content || title;

  const prompt = `${rules}

## 参考示例

以下是一个高质量的 script.json 示例（基于"咖啡"主题）：

\`\`\`json
${example}
\`\`\`

## 本次任务

请根据以下主题和内容，生成一个 script.json：

- 视频标题: ${title}
- 内容描述: ${inputContent}

## 输出要求

- 严格 JSON，无其他文字
- 数字必须拼读（narration 中）
- 必须填满所有 inputs slot
- 场景数 3-12 个
- 第一场是 hook，最后一场是 outro

输出：`;

  console.log(`[prompt-builder] 生成 script，标题: ${title}`);

  const { text } = await callLLM({
    system: "你是一个专业的短视频脚本策划，严格按规则输出 JSON。",
    user: prompt,
    maxTokens: 8000,
  });

  try {
    const script = parseJSON(text);
    const result = validateScript(script);
    if (!result.ok) {
      console.warn(`[prompt-builder] 校验失败: ${result.error}`);
      return { script: JSON.stringify(script, null, 2), validated: false, error: result.error };
    }
    const stats = getScriptStats(result.script);
    console.log(`[prompt-builder] 完成: ${stats.sceneCount} 场景 (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
    return { script: JSON.stringify(result.script, null, 2), validated: true, stats };
  } catch (err) {
    console.warn(`[prompt-builder] 解析失败: ${err.message}，原文前200字: ${text.slice(0, 200)}`);
    return { script: text, validated: false, error: `JSON 解析失败: ${err.message}` };
  }
}

export async function validateScriptStep(input) {
  let parsed;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      throw ERRORS.SCRIPT_INVALID_JSON("解析失败");
    }
  } else {
    parsed = input;
  }

  const result = validateScript(parsed);
  if (!result.ok) {
    throw ERRORS.SCRIPT_VALIDATION_FAILED(result.error);
  }

  const stats = getScriptStats(result.script);
  return {
    output: `✅ 校验通过: ${stats.sceneCount} 个场景，约 ${stats.estimatedDurationSec} 秒，使用模板: ${stats.templates.join(", ")}`,
    script: result.script,
  };
}