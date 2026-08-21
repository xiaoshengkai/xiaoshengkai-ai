/**
 * video-generation 特有动作：生成视频内容描述（LLM）
 * 从 ai-chat app/api/workflows/generate-content 迁入；由 capability custom 原语调用
 */

import { callLLM, getWorkflowProvider } from "@app/shared/llm/index.js";
import { VIDEO_CONTENT_PROMPT, buildVideoContentPrompt } from "./prompt.js";

export async function handle({ request }) {
  const { title, requirement } = await request.json();
  console.log(`[generate-content] 开始: title="${title}"`);
  if (!title) {
    return Response.json({ ok: false, error: "missing title" }, { status: 400 });
  }

  try {
    console.log(`[generate-content] 调用 LLM: provider=${getWorkflowProvider()}`);
    const { text } = await callLLM({
      system: VIDEO_CONTENT_PROMPT,
      user: buildVideoContentPrompt({ title, requirement }),
      format: 'text',
    });

    console.log(`[generate-content] 完成: ${text.length} chars`);
    return { content: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[generate-content] 失败: ${message}`);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
