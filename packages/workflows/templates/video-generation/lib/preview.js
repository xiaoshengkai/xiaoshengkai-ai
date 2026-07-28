import fs from "node:fs";
import { loadAnimationTemplate } from "../utils.js";

export async function buildPreviewHTML(html, workDir) {
  const template = loadAnimationTemplate();
  const final = template.replace("<!-- AI 在此处填充场景 -->", html);

  const htmlPath = `${workDir}/preview.html`;
  fs.writeFileSync(htmlPath, final);
  return { previewFile: htmlPath };
}