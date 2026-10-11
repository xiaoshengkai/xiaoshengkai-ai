import type { ModelMessage as AISDKModelMessage } from "ai";

/**
 * UIMessage → ModelMessage 转换（全量保留，不截断）
 * ============================================================================
 *
 * 关键：MiniMax 多轮 Function Call 官方要求把**完整的 assistant 消息**
 * （含 tool_calls + 思考）加回历史以保持思维链连续。故这里保留：
 *   - text / file
 *   - assistant 的 reasoning → `reasoning` part（provider 会发为 reasoning_content）
 *   - assistant 的 tool-call → `tool-call` part（provider 会发为 tool_calls）
 *   - tool-result → 紧随其后的 `role:'tool'` 消息
 *
 * 不截断：上下文治理交给「压缩」功能（/api/chat/compress）。
 * 自写而非用 AI SDK convertToModelMessages：后者会丢 file.data。
 */

type UIPart = {
  type: string;
  text?: string;
  mediaType?: string;
  data?: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type UIMessageLike = { role: string; parts?: UIPart[] };

function wrapToolOutput(output: unknown): Record<string, unknown> {
  if (typeof output === "string") return { type: "text", value: output };
  return { type: "json", value: output };
}

export function toModelMessages(messages: UIMessageLike[]): AISDKModelMessage[] {
  const out: AISDKModelMessage[] = [];

  for (const msg of messages) {
    const parts = msg.parts || [];

    if (msg.role === "user") {
      const content: Array<Record<string, unknown>> = [];
      for (const p of parts) {
        if (p.type === "text") content.push({ type: "text", text: p.text ?? "" });
        else if (p.type === "file") content.push({ type: "file", mediaType: p.mediaType, data: p.data });
      }
      out.push({ role: "user", content } as unknown as AISDKModelMessage);
      continue;
    }

    if (msg.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      const toolResults: Array<Record<string, unknown>> = [];
      for (const p of parts) {
        if (p.type === "reasoning") {
          if (p.text) content.push({ type: "reasoning", text: p.text });
        } else if (p.type === "text") {
          content.push({ type: "text", text: p.text ?? "" });
        } else if (p.type === "dynamic-tool" || p.type.startsWith("tool-")) {
          if (p.state === "output-available") {
            content.push({ type: "tool-call", toolCallId: p.toolCallId, toolName: p.toolName, input: p.input });
            toolResults.push({ type: "tool-result", toolCallId: p.toolCallId, toolName: p.toolName, output: wrapToolOutput(p.output) });
          } else if (p.state === "output-error") {
            content.push({ type: "tool-call", toolCallId: p.toolCallId, toolName: p.toolName, input: p.input });
            toolResults.push({ type: "tool-result", toolCallId: p.toolCallId, toolName: p.toolName, output: { type: "error-text", value: p.errorText || "tool error" } });
          }
          // input-streaming / input-available：跳过，避免产生无结果的悬空 tool-call
        }
      }
      if (content.length > 0) out.push({ role: "assistant", content } as unknown as AISDKModelMessage);
      if (toolResults.length > 0) out.push({ role: "tool", content: toolResults } as unknown as AISDKModelMessage);
      continue;
    }

    // system / 其它角色：仅文本
    const content = parts.filter((p) => p.type === "text").map((p) => ({ type: "text", text: p.text ?? "" }));
    out.push({ role: msg.role, content } as unknown as AISDKModelMessage);
  }

  return out;
}
