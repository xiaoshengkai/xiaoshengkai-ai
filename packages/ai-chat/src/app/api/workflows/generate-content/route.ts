import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const PROMPT_PATH = path.resolve(process.cwd(), "src", "lib", "prompts", "video-content.txt");

export async function POST(request: Request) {
  const { title } = await request.json();
  if (!title) {
    return NextResponse.json({ error: "missing title" }, { status: 400 });
  }

  let systemPrompt = "你是一个短视频脚本策划助手，根据用户提供的视频标题生成详细的内容描述。";
  if (fs.existsSync(PROMPT_PATH)) {
    systemPrompt = fs.readFileSync(PROMPT_PATH, "utf-8");
  }

  try {
    const { callLLM } = await import("../../../../../../shared/llm/index.js");
    const { text } = await callLLM({
      system: systemPrompt,
      user: `视频标题：${title}\n\n请生成内容描述（最大3000字）`,
    });

    return NextResponse.json({ content: text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}