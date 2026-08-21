import { NextResponse } from "next/server";

import { VIDEO_CONTENT_PROMPT, buildVideoContentPrompt } from "./_lib/prompt";
import { callLLM, getWorkflowProvider } from "@app/shared/llm/index.js";

export async function POST(request: Request) {
  const { title, requirement } = await request.json();
  console.log(`[generate-content] 开始: title="${title}"`);
  if (!title) {
    return NextResponse.json({ error: "missing title" }, { status: 400 });
  }

  try {
    console.log(`[generate-content] 调用 LLM: provider=${getWorkflowProvider()}`);
    const { text } = await callLLM({
      system: VIDEO_CONTENT_PROMPT,
      user: buildVideoContentPrompt({ title, requirement }),
      format: 'text',
    });

    console.log(`[generate-content] 完成: ${text.length} chars`);
    return NextResponse.json({ content: text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[generate-content] 失败: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}