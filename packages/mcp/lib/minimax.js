const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";

export async function generateImage(prompt, { aspectRatio = "1:1", model = "image-01" } = {}) {
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