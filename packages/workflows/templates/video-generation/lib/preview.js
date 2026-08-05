import fs from "node:fs";
import path from "node:path";
import { loadAnimationTemplate } from "../utils.js";

export async function buildPreviewHTML(html, workDir) {
  const startTime = Date.now();
  if (!html || html.trim() === "") {
    throw new Error("脚本内容为空，无法生成预览。请提供具体主题让 AI 生成脚本。");
  }

  let content = html;
  try {
    const obj = JSON.parse(html);
    if (obj.html) { content = obj.html; }
    else if (obj.output) {
      try { const inner = JSON.parse(obj.output); content = inner.html || inner.output || obj.output; }
      catch { content = obj.output; }
    }
  } catch {}

  if (!content || content.trim() === "") {
    throw new Error("脚本内容为空，无法生成预览。请提供具体主题让 AI 生成脚本。");
  }

  const outputPath = path.join(workDir, "preview.html");

  if (content.includes("<!DOCTYPE") || content.trim().startsWith("<html")) {
    fs.writeFileSync(outputPath, content);
  } else {
    const template = loadAnimationTemplate();
    const final = template.replace("<!-- AI 在此处填充场景 -->", content);
    fs.writeFileSync(outputPath, final);
  }
  console.log(`[preview] 完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
  return { previewFile: outputPath };
}