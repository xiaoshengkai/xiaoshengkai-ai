import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { validateScript } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_STATIC_DIR = path.resolve(__dirname, "..", "..", "..", "..", "..", "data", "static");

function resolveImagePath(urlPath) {
  const filename = path.basename(urlPath);
  if (!/^[a-f0-9-]{36}\.\w+$/.test(filename)) return null;
  for (const subdir of ["images", "videos"]) {
    const fp = path.join(DATA_STATIC_DIR, subdir, filename);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

function imagesToDataURLs(imagePaths) {
  return imagePaths.map(p => {
    const fp = resolveImagePath(p);
    if (!fp) return null;
    const ext = path.extname(fp).slice(1);
    const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    const data = fs.readFileSync(fp);
    return `data:${mime};base64,${data.toString("base64")}`;
  }).filter(Boolean);
}

const SYSTEM_PROMPT = `你是视频脚本微调助手，不是从0生成。
输入：原 script.json + 用户自然语言反馈
输出：修改后的完整 script.json

约束：
1. 严格保持 scenes 数组的 id、顺序、数量不变
2. 只修改用户反馈中明确提到的字段（html、css、jsAnimation、narration、designTokens、bgm_prompt 等）
3. 其他字段原样保留，不要改动
4. 如用户要求"重新生成整个 hook"，重写第一个 scene 的 html/css/jsAnimation
5. 如用户要求"第3帧太暗"，只改 scene3 的配色（css 或 html 内 style）
6. 如用户要求"全局颜色改成蓝色"，修改 designTokens.palette 和所有 scene 的配色
7. 如用户要求"动画太快/太慢"，调整 data-duration 或 jsAnimation 的 duration
8. scenes 数量不变，顺序不变，id 不变

输出 JSON 时直接给完整脚本，不要任何其他文字。`;

export async function tweakScript(originalScript, feedback, imagePaths = []) {
  const images = imagesToDataURLs(imagePaths);
  const user = `原脚本：
${JSON.stringify(originalScript, null, 2)}

用户反馈：
${feedback}
${images.length > 0 ? `\n用户上传了 ${images.length} 张参考图片(已附在上下文):\n` : ""}

输出修改后的完整脚本：`;

  const { text } = await callLLM({
    system: SYSTEM_PROMPT,
    user,
    maxTokens: 32000,
    images,
  });

  const script = parseJSON(text);

  if (script && typeof script.schemaVersion === "string") {
    script.schemaVersion = Number(script.schemaVersion);
  }

  const result = validateScript(script);
  if (!result.ok) {
    throw new Error(`微调后脚本校验失败: ${result.error}`);
  }

  const tweaked = result.script;

  const origIds = originalScript.scenes.map(s => String(s.id));
  const newIds = tweaked.scenes.map(s => String(s.id));
  if (origIds.length !== newIds.length) {
    throw new Error(`微调后场景数量变化 (${origIds.length} → ${newIds.length})，请重新微调`);
  }
  for (let i = 0; i < origIds.length; i++) {
    if (origIds[i] !== newIds[i]) {
      throw new Error(`微调后场景 id 或顺序变化 (${origIds[i]} → ${newIds[i]})，请重新微调`);
    }
  }

  return {
    script: JSON.stringify(tweaked, null, 2),
    allHtml: tweaked.scenes.map(s => s.html).join("\n"),
    allNarration: tweaked.scenes.map(s => s.narration).join("\n"),
    css: tweaked.css || "",
    jsAnimation: tweaked.jsAnimation || "",
    scenesJson: JSON.stringify(tweaked.scenes),
    title: tweaked.title,
    bgm_prompt: tweaked.bgm_prompt,
  };
}