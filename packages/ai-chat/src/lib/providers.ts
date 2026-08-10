import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const glm = createOpenAICompatible({
  name: "glm",
  baseURL: process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
  apiKey: process.env.GLM_API_KEY,
});

export const deepseek = createOpenAICompatible({
  name: "aether",
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

/**
 * MiniMax provider
 *
 * fetch 拦截器做了两件事：
 * 1. 把 image_url 中 MIME 是 video/* 的部分重写为 video_url（M3 专用）
 * 2. 添加 reasoning_split=true 让思考内容分离
 */
export const minimax = createOpenAICompatible({
  name: "minimax",
  baseURL: process.env.MINIMAX_BASE_URL || "https://api.minimax.chat/v1",
  apiKey: process.env.MINIMAX_API_KEY,
  fetch: async (url, init) => {
    let body = JSON.parse(init?.body as string || "{}");
    // 把视频 MIME 的 image_url 重写为 video_url（M3 文档要求）
    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content) {
          if (part?.type === 'image_url' && part.image_url?.url?.startsWith('data:video/')) {
            part.type = 'video_url';
            part.video_url = {
              url: part.image_url.url,
              detail: 'default',
              fps: 1,
            };
            delete part.image_url;
          }
        }
      }
    }
    return fetch(url, {
      ...init,
      body: JSON.stringify({ ...body, reasoning_split: true }),
    });
  },
});