import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";

const MAX_DIALOGUE_LINES = 3;
const MULTI_PANEL_RE = /分格|上下两部分|双分|多格|分成上下|上半.*下半/;

function countDialogueLines(d) {
  if (!d) return 0;
  if (Array.isArray(d)) return d.filter(s => s && String(s).trim()).length;
  if (typeof d === "string") return d.split("\n").map(s => s.trim()).filter(Boolean).length;
  return 0;
}

function validateStoryboard(script) {
  const errors = [];
  if (!script || typeof script !== "object") return ["脚本不是对象"];
  if (!Array.isArray(script.pages) || script.pages.length === 0) {
    return ["pages 必须是非空数组"];
  }
  script.pages.forEach((p, i) => {
    if (!p.imagePrompt || typeof p.imagePrompt !== "string") errors.push(`第 ${i + 1} 页缺少 imagePrompt`);
    if (p.dialogue === undefined) errors.push(`第 ${i + 1} 页缺少 dialogue`);
    const n = countDialogueLines(p.dialogue);
    if (n > MAX_DIALOGUE_LINES) errors.push(`第 ${i + 1} 页对白 ${n} 句过密（≤${MAX_DIALOGUE_LINES}），请拆成多页`);
    if (n > 0 && (!Array.isArray(p.cast) || p.cast.length === 0)) errors.push(`第 ${i + 1} 页有对白但缺少 cast（说话人位置），请补充`);
    if (MULTI_PANEL_RE.test(p.imagePrompt || "")) errors.push(`第 ${i + 1} 页 imagePrompt 含多格/上下分屏，每页只画一个镜头，请拆分`);
  });
  return errors;
}

export async function generateStoryboard(content, title, pageCount) {
  const storyText = content || title;
  if (!storyText) throw new Error("缺少故事内容");

  const pageConstraint = pageCount && Number(pageCount) > 0
    ? `\n## 页数\n必须生成恰好 ${pageCount} 页。`
    : "\n## 页数\n根据故事与对话密度自然决定页数；对话密集时拆成多页，不设上限。";

  const system = `你是专业的漫画分镜师。把故事拆成漫画分镜，每页一个画面。

每页 imagePrompt 必须包含四要素（缺一不可）：
1.【背景】时间+地点+环境道具（如"白天·开放式办公区，显示器/咖啡杯/绿植"），每页都要交代，不可省略。
2.【人物】本页出场的每个角色：名字+位置（左/右/前景/背景）+动作+表情。角色外貌由参考图锁定，用名字指代即可，不要重复描述外貌。
3.【构图】单一景别（特写/中景/全景）+机位。每页只画一个镜头、单一构图，禁止"分格/上下两部分/双分格/多格堆叠"。
4.【说话人】明确谁在说话、朝向与位置，使对白气泡能对准人物。
5.【cast】本页每个出场说话角色的位置：[{"name":"角色名","side":"left|right|center"}]，用于程序化放置对白气泡，必须与【人物】位置一致。

对白规则：
- dialogue 为字符串数组，每个元素一句「名字: 台词」。
- 每页对白≤3 句（1-2 个来回）。对话密集必须拆成多页，宁可页数多，不可一页堆对话。
- 谁说谁必须与故事原文严格对应，不得张冠李戴、不得合并/省略说话人。
- 无对白页 dialogue 为空数组 []。

只输出 JSON，格式：
{ "title": "标题", "pages": [ { "page": 1, "imagePrompt": "【背景】白天·办公区【人物】左:小张(皱眉) 右:PM(前倾)【构图】中景【说话人】PM在说话", "cast": [{"name":"小张","side":"left"},{"name":"PM","side":"right"}], "dialogue": ["PM: …", "小张: …"] } ] }`;

  const user = `故事标题: ${title || "未命名"}
故事内容:
${storyText}
${pageConstraint}

输出：`;

  const allErrors = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const retryHint = allErrors.length > 0
      ? `\n\n## 之前校验失败，需一次性修正以下问题：\n${allErrors.join("\n")}\n`
      : "";

    const finalUser = retryHint ? user + retryHint : user;
    console.log(`[storyboard] 第 ${attempt + 1}/5 次尝试...`);
    console.log(`[storyboard] 提交AI system prompt:\n${system}`);
    console.log(`[storyboard] 提交AI 最终user prompt:\n${finalUser}`);

    const { text } = await callLLM({
      system,
      user: finalUser,
    });
    console.log(`[storyboard] AI 原始返回:\n${text}`);

    try {
      const script = parseJSON(text);
      const errors = validateStoryboard(script);
      if (errors.length > 0) {
        errors.forEach(e => { if (!allErrors.includes(e)) allErrors.push(e); });
        console.warn(`[storyboard] 校验失败: ${errors.join("; ")}`);
        continue;
      }

      script.pages.forEach((p, i) => { if (!p.page) p.page = i + 1; });
      console.log(`[storyboard] 完成: ${script.pages.length} 页`);
      return {
        script: JSON.stringify(script, null, 2),
        pagesJson: JSON.stringify(script.pages),
        title: script.title || title,
      };
    } catch (e) {
      if (!allErrors.includes(e.message)) allErrors.push(e.message);
      console.warn(`[storyboard] 解析失败: ${e.message}`);
    }
  }

  throw new Error(`分镜生成失败: ${allErrors.join("\n")}`);
}
