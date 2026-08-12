import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { extractReasoningMiddleware, wrapLanguageModel } from "ai";
import { env } from "../utils/env"

export const glm = createOpenAICompatible({
  name: "glm",
  baseURL: env.GLM_BASE_URL,
  apiKey: env.GLM_API_KEY,
});

export const deepseek = createOpenAICompatible({
  name: "deepseek",
  baseURL: env.DEEPSEEK_BASE_URL,
  apiKey: env.DEEPSEEK_API_KEY,
});

/**
 * MiniMax provider — OpenAI 兼容接口
 *
 * fetch 拦截器：
 * 1. 把 video file 重写为 video_url（M3 文档要求）
 * 2. 把 image file 重写为 image_url
 * 3. **不** 注入 reasoning_split：让 M3 用默认行为（false），
 *    thinking 留在 content 的 <think>...</think> 标签里，
 *    再由 getMinimaxModel 的 extractReasoningMiddleware 抽取。
 *    （原 reasoning_split:true 会让思考进 reasoning_details，
 *     openai-compatible provider 不解析该字段 → 思考丢失）
 */
export const minimax = createOpenAICompatible({
  name: "minimax",
  baseURL: env.MINIMAX_BASE_URL,
  apiKey: env.MINIMAX_API_KEY,
  fetch: async (url, init) => {
    let body = JSON.parse(init?.body as string || "{}");
    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content) {
          if (part?.type === 'file' && part.mediaType?.startsWith('video/')) {
            part.type = 'video_url';
            part.video_url = { url: part.data, detail: 'default', fps: 1 };
            delete part.mediaType;
            delete part.data;
          } else if (part?.type === 'file' && part.mediaType?.startsWith('image/')) {
            part.type = 'image_url';
            part.image_url = {
              url: part.data,
              detail: part.mediaType === 'image/jpeg' ? 'low' : 'default',
            };
            delete part.mediaType;
            delete part.data;
          } else if (part?.type === 'image' && part.image?.startsWith?.('data:video/')) {
            part.type = 'video_url';
            part.video_url = { url: part.image, detail: 'default', fps: 1 };
            delete part.image;
          }
        }
      }
    }
    return fetch(url, init);
  },
});

/**
 * 包一层 extractReasoningMiddleware — 抽取 M3 content 里的 <think>...</think> 标签
 * 成独立的 reasoning 事件，让前端能显示 [思考过程] 折叠区。
 * 工具事件透传不受影响。
 */
export function getMinimaxModel(modelId: string) {
  return wrapLanguageModel({
    model: minimax(modelId),
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  });
}