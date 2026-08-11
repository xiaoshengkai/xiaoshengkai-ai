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
 * MiniMax provider — OpenAI 兼容接口
 *
 * fetch 拦截器：
 * 1. 把 video file 重写为 video_url（M3 文档要求）
 * 2. 把 image file 重写为 image_url
 * 3. 添加 reasoning_split=true
 */
export const minimax = createOpenAICompatible({
  name: "minimax",
  baseURL: process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1",
  apiKey: process.env.MINIMAX_API_KEY,
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
    return fetch(url, {
      ...init,
      body: JSON.stringify({ ...body, reasoning_split: true }),
    });
  },
});