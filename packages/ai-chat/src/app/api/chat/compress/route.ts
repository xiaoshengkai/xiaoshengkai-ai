import { generateText } from "ai";
import { deepseek } from "@/lib/providers";

const COMPRESS_PROMPT = `请将以下对话整理为上下文摘要，供后续对话参考。确保不丢失任何关键信息。

保留内容：
- 用户的每一条消息内容和意图
- AI 的每一条回复内容、建议、生成结果、提供的信息
- 图片、视频、音频、图表等媒体信息及其描述（URL、生成结果、主题等）
- 技术细节、代码片段、配置项
- 待办事项、行动计划、后续步骤
- 重要结论、解决方案、问题根因

丢弃内容：
- 纯问候、纯闲聊、纯确认性回复（"好的""收到"）
- 重复信息
- 失败的尝试（除非有参考价值）
- 注意：不要丢弃任何媒体信息（图片、视频、图表等）

注意：保留的是对话的完整信息，AI 的回复与用户消息同等重要，不要只保留用户说的话。

格式要求：
- 用 Markdown 列表，按主题分组
- 信息完整但不冗余，每条一行
- 关键代码/配置保留原文

对话：`.trim();

export async function POST(req: Request) {
  try {
    const { messages, previousSummary } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return Response.json({ error: "messages is required" }, { status: 400 });
    }

    const conversation = messages
      .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
      .map((m: { role: string; parts: { type: string; text?: string }[] }) => {
        const text = m.parts?.find((p: { type: string }) => p.type === "text")?.text ?? "";
        if (m.role === "assistant" && text.startsWith("[上下文摘要] ")) return null;
        return `${m.role === "user" ? "用户" : "AI"}: ${text}`;
      })
      .filter(Boolean)
      .join("\n\n");

    const fullContext = previousSummary
      ? `[之前摘要，必须完整保留]\n${previousSummary}\n\n[当前对话]\n${conversation}`
      : conversation;

    console.log(`[compress] ${messages.length} messages, prevSummary: ${previousSummary ? previousSummary.length + " chars" : "none"}`);

    const { text, usage } = await generateText({
      model: deepseek(process.env.DEEPSEEK_PRO_MODEL || "deepseek-v4-pro"),
      prompt: `${COMPRESS_PROMPT}\n\n${fullContext}`,
    });

    console.log(`[compress] output: ${text.length} chars, ${usage.totalTokens} tokens`);

    return Response.json({
      summary: text,
      usage: {
        totalTokens: usage.totalTokens ?? 0,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      },
    });
  } catch (error) {
    console.error("POST /api/chat/compress error:", error);
    return Response.json({ error: "压缩失败，请重试" }, { status: 500 });
  }
}