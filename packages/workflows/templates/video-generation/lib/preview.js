import fs from "node:fs";
import path from "node:path";
import { loadAnimationTemplate } from "../utils.js";

export async function buildPreviewHTML(html, workDir) {
  if (!html || html.trim() === "") {
    throw new Error("脚本内容为空，无法生成预览。请提供具体主题让 AI 生成脚本。");
  }

  const outputPath = path.join(workDir, "preview.html");

  // 如果 LLM 返回的是完整 HTML 文档（含 <!DOCTYPE 或 <html>），直接使用
  if (html.includes("<!DOCTYPE") || html.trim().startsWith("<html")) {
    fs.writeFileSync(outputPath, html);
    return { previewFile: outputPath };
  }

  // 否则用动画模板包装场景内容
  const template = loadAnimationTemplate();
  const final = template.replace("<!-- AI 在此处填充场景 -->", html);
  fs.writeFileSync(outputPath, final);
  return { previewFile: outputPath };
}