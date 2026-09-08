/**
 * comic-generation 特有动作：AI 生成漫画故事（含角色与关系）
 * 参考 video-generation generate-content；输出自然语言故事供 storyboard 解析
 */

import { callLLM } from "@app/shared/llm/index.js";

const COMIC_STORY_PROMPT = `你是专业的漫画编剧。根据用户提供的标题，创作一个适合改编成漫画的故事。

要求：
1. 明确列出所有角色：每个角色的名字、性别、年龄、外貌特征（发型、服装等）。
2. 明确角色之间的关系（如兄妹、同学、情侣、对手等）。
3. 写一个有起承转合的完整剧情（开端、发展、高潮、结局），页数由分镜根据剧情与对话密度决定。
4. 剧情要有画面感，便于分镜。

只输出故事正文（自然语言），不要输出 JSON 或标题。`;

export async function handle({ request }) {
  const { title, requirement } = await request.json();
  if (!title) {
    return Response.json({ ok: false, error: "missing title" }, { status: 400 });
  }

  try {
    const { text } = await callLLM({
      system: COMIC_STORY_PROMPT,
      user: `标题: ${title}
要求: ${requirement || "无"}

输出：`,
      format: "text",
    });
    return { content: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
