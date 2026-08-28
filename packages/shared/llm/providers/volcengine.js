import { getApiKey, getBaseUrl, getProviderModel } from "../config.js";

// aspectRatio → 2K 档宽高像素（Seedream 5.0 lite，方式2 指定 WxH）
const ASPECT_TO_SIZE = {
  "1:1": "2048x2048",
  "4:3": "2304x1728",
  "3:4": "1728x2304",
  "16:9": "2848x1600",
  "9:16": "1600x2848",
  "3:2": "2496x1664",
  "2:3": "1664x2496",
  "21:9": "3136x1344",
};

export async function generateImage(prompt, { aspectRatio = "1:1", model, image_url, n = 1, watermark = false } = {}) {
  const apiKey = getApiKey("volcengine", "VOLCENGINE_API_KEY");
  if (!apiKey) throw new Error("未配置 VOLCENGINE_API_KEY");

  const baseURL = getBaseUrl("volcengine", "VOLCENGINE_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3");
  const actualModel = model || getProviderModel("volcengine", "image", "VOLCENGINE_IMAGE_MODEL", "doubao-seedream-5-0-lite-260128");

  const body = {
    model: actualModel,
    prompt,
    size: ASPECT_TO_SIZE[aspectRatio] || "2048x2048",
    output_format: "png",
    response_format: "url",
    watermark,
  };
  if (image_url) body.image = image_url;
  if (n > 1) {
    body.sequential_image_generation = "auto";
    body.sequential_image_generation_options = { max_images: n };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${baseURL}/images/generations`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || data?.message || `Volcengine 图片生成失败 (${res.status})`);
    }
    const urls = (data.data || []).map(d => d.url).filter(Boolean);
    if (urls.length === 0) throw new Error("未获取到图片 URL");
    return urls;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("图片生成超时（120s）");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
