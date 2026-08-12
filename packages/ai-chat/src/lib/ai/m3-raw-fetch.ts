/**
 * M3 preprocess 路径 — 给 DeepSeek 等纯文本 provider 用
 *
 * 只保留 m3ChatComplete（非流式调用），用于 preprocessImagesDescription / preprocessVideoDescription
 * 流式路径（m3ChatStream / toUIMessageStream）已删除 — M3 现在用 Anthropic 协议，由 AI SDK 原生处理
 */

import { env } from "../utils/env"

const BASE_URL = env.MINIMAX_BASE_URL;
const API_KEY = env.MINIMAX_API_KEY;
const DEFAULT_MODEL = 'MiniMax-M3';

/** OpenAI 格式 message（preprocess 路径用） */
interface OpenAIMessage {
  role: string;
  content: string | unknown[];
}

interface CallOptions {
  modelName: string;
  systemPrompt: string;
  signal?: AbortSignal;
}

/**
 * 非流式调用 M3（preprocess 图片/视频描述等场景）
 * 用 OpenAI 兼容接口（非 Anthropic），因为 preprocess 只是简单的一次性描述，不需要流式/thinking
 */
export async function m3ChatComplete(
  messages: OpenAIMessage[],
  opts: Omit<CallOptions, 'signal'> & { signal?: AbortSignal }
): Promise<string | undefined> {
  const body = {
    model: opts.modelName || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      ...messages,
    ],
    stream: false,
    reasoning_split: true,
  };

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!response.ok) return undefined;
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content;
}