/**
 * M3 raw fetch 路径 — 视频需要绕过 AI SDK（OpenAI provider 不支持 video file）
 *
 * 注意：必须用 stream:false 时才能区分"流"和"一次性"调用
 */

const BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1';
const API_KEY = process.env.MINIMAX_API_KEY || '';
const DEFAULT_MODEL = 'MiniMax-M3';

interface CallOptions {
  modelName: string;
  systemPrompt: string;
  signal?: AbortSignal;
}

/**
 * 流式调用 M3（OpenAI 兼容接口）
 * 把 OpenAI SSE 转换为 AI SDK UI message stream 格式
 */
export async function m3ChatStream(
  messages: any[],
  opts: CallOptions
): Promise<Response> {
  const body = {
    model: opts.modelName || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      ...messages,
    ],
    stream: true,
    reasoning_split: true,
  };

  return rawFetch(body, opts.signal);
}

/**
 * 非流式调用 M3（preprocess 视频描述等场景）
 */
export async function m3ChatComplete(
  messages: any[],
  opts: Omit<CallOptions, 'signal'> & { signal?: AbortSignal }
): Promise<string | undefined> {
  const body = {
    model: opts.modelName || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      ...messages,
    ],
    stream: false,
    reasoning_split: false,
  };

  const response = await rawFetch(body, opts.signal);
  if (!response.ok) return undefined;
  const data = await response.json();
  return data.choices?.[0]?.message?.content;
}

async function rawFetch(body: any, signal?: AbortSignal): Promise<Response> {
  const url = `${BASE_URL}/chat/completions`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * OpenAI SSE → AI SDK UI message stream 格式
 * 包装响应流，返回标准 AI SDK 格式
 */
export async function toUIMessageStream(openaiResponse: Response): Promise<Response> {
  if (!openaiResponse.ok) {
    const errorBody = await openaiResponse.text();
    console.error('[m3-raw] API 错误:', openaiResponse.status, errorBody.slice(0, 500));
    return new Response(
      JSON.stringify({ error: `M3 API 错误 ${openaiResponse.status}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!openaiResponse.body) {
    return new Response(
      JSON.stringify({ error: 'M3 无响应 body' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();
  const reader = openaiResponse.body.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'finish' })}\n\n`)
              );
              continue;
            }
            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta;
              if (delta?.reasoning_content) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    type: 'reasoning-delta',
                    id: 'rs',
                    delta: delta.reasoning_content,
                  })}\n\n`)
                );
              }
              if (delta?.content) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    type: 'text-delta',
                    id: 'txt',
                    delta: delta.content,
                  })}\n\n`)
                );
              }
            } catch {
              // 跳过无法解析的 chunk
            }
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            errorText: (err as Error).message,
          })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}