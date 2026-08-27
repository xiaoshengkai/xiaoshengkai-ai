/**
 * Preprocess 路径 — 给纯文本 provider 用（M3 用于多模态描述生成）
 *
 * 流式路径已删除 — 主对话走 chat strategy（route.ts）
 * ponytail: 重命名自 m3-raw-fetch.ts（2026-08-19），去掉文件名里的模型名
 */

import { getProviderConfig } from "@/lib/settings/dispatcher";

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
 * 非流式调用 preprocess model（图片/视频描述生成）
 * 读 preprocess module 配置（默认 M3，支持视觉）
 */
export async function preprocessChat(
  messages: OpenAIMessage[],
  opts: Omit<CallOptions, 'signal'> & { signal?: AbortSignal }
): Promise<string> {
  const cfg = getProviderConfig("preprocess");
  const body: Record<string, unknown> = {
    model: opts.modelName || cfg.model,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      ...messages,
    ],
    stream: false,
  };
  // minimax 用 reasoning_split，qwen 用 enable_thinking（参数不通用，按 provider 分支）
  if (cfg.provider === "minimax") body.reasoning_split = true;
  else body.enable_thinking = false;

  const response = await fetch(`${cfg.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`preprocess 调用失败 (${response.status}): ${raw.slice(0, 200)}`);
  }
  if (!raw.trim()) throw new Error("preprocess 返回空响应");
  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`preprocess 返回无效 JSON: ${raw.slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("preprocess 返回空内容");
  return content;
}
