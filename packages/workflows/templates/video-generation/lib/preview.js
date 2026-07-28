import fs from "node:fs";
import { loadStyleMD, loadAnimationTemplate } from "../utils.js";
import { callLLM } from "../../../../mcp/lib/llm.js";

export async function buildPreviewHTML(scriptHTML, workDir, style, duration) {
  const styleMD = loadStyleMD(style === "奶油风" ? "cream" : style === "极简黑白" ? "bw" : "default");
  const animationTemplate = loadAnimationTemplate();

  const width = 1080;
  const height = 1920;

  const SCRIPT_SYSTEM_PROMPT = `你是一个专业短视频生成器。根据用户输入的知识内容和风格参考，在动画骨架模板的基础上填充内容，生成完整的 HTML 文件。

动画骨架模板：
${animationTemplate}

风格参考：
${styleMD}

输出要求：
1. 在骨架模板的 <!-- AI 在此处扩展样式 --> 处扩展 CSS 样式
2. 在骨架模板的 <!-- AI 在此处填充场景 --> 处填充场景 HTML（使用 .scene 类）
3. 在骨架模板的 // AI 在此处填充 GSAP 动画代码 处填充 GSAP 动画
4. 视频尺寸为 ${width}×${height}，面向抖音等自媒体平台
5. 使用 GSAP 时间线，每个场景用 .scene 包裹
6. 转场用双层 wipe
7. 图表用内联 SVG + GSAP 动画
8. 开头必须有钩子：前 3 秒用动态大字 + 悬念/问题
9. 信息密度要高：每个场景 4-5 秒
10. 标题字号 ≤ 72px，正文 28-36px
11. 旁白要口语化、自然
12. 输出完整 HTML，不要用 markdown 代码块包裹
13. 禁止使用 jQuery
14. 输出格式必须是严格的 JSON：{ "html": "完整 HTML", "narration": "旁白文本", "bgm_prompt": "BGM描述", "title": "标题" }`;

  const { text: rawContent } = await callLLM({
    system: SCRIPT_SYSTEM_PROMPT,
    user: `内容: ${scriptHTML}${duration ? `\n目标时长: ${duration}秒` : ""}`,
  });

  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("脚本解析失败");
  const result = JSON.parse(jsonMatch[0]);

  const htmlPath = `${workDir}/preview.html`;
  fs.writeFileSync(htmlPath, result.html);
  return { previewFile: htmlPath, narration: result.narration, bgm_prompt: result.bgm_prompt, title: result.title };
}