const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";
const MINIMAX_IMAGE_MODEL = process.env.MINIMAX_IMAGE_MODEL || "image-01";
const MINIMAX_CHAT_MODEL = process.env.MINIMAX_CHAT_MODEL || "MiniMax-M3";

export async function callLLM({ system, user, model, temperature = 0.7, maxTokens = 2000 }) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("未配置 MINIMAX_API_KEY");

  const res = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || MINIMAX_CHAT_MODEL,
      response_format: { type: "json_object" },
      reasoning_split: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`[minimax] callLLM: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    throw new Error(`MiniMax API 错误 (${res.status}): ${data.error?.message || "未知错误"}`);
  }
  const msg = data.choices?.[0]?.message || {};
  console.error(`[minimax] usage: ${JSON.stringify(data.usage)}`);
  return {
    text: msg.content || "",
    usage: { totalTokens: data.usage?.totalTokens || data.usage?.total_tokens || 0 },
  };
}

export async function generateImage(prompt, { aspectRatio = "1:1", model = MINIMAX_IMAGE_MODEL } = {}) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("未配置 MINIMAX_API_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const res = await fetch(`${MINIMAX_BASE_URL}/image_generation`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      aspect_ratio: aspectRatio,
      n: 1,
      prompt_optimizer: true,
      response_format: "url",
    }),
  });
  clearTimeout(timeout);

  const result = await res.json();
  if (result.base_resp?.status_code !== 0) {
    throw new Error(result.base_resp?.status_msg || "图片生成失败");
  }

  const url = result.data?.image_urls?.[0];
  if (!url) throw new Error("未获取到图片 URL");

  return url;
}