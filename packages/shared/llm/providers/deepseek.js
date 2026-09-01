import { getApiKey, getBaseUrl, getProviderModel } from "../config.js";

export async function callLLM({ system, user, model, temperature = 0.7, maxTokens = 8000, format = 'json_object', images = [] }) {
  const apiKey = getApiKey("deepseek", "DEEPSEEK_API_KEY");
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY');

  const baseURL = getBaseUrl("deepseek", "DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1");
  const actualModel = model || getProviderModel("deepseek", "chat", "DEEPSEEK_PRO_MODEL", "deepseek-v4-pro");
  console.log(`[deepseek] 当前调用: model=${actualModel} baseURL=${baseURL}`);

  const userContent = images.length > 0
    ? [{ type: "text", text: user }, ...images.map(d => ({ type: "image_url", image_url: { url: d } }))]
    : user;

  const body = {
    model: actualModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (format) body.response_format = { type: format };

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.log(`[deepseek] callLLM: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    throw new Error(`DeepSeek API 错误 (${res.status})`);
  }
  console.log(`[deepseek] usage: ${JSON.stringify(data.usage)}`);
  return {
    text: data.choices?.[0]?.message?.content || '',
    usage: {
      totalTokens: data.usage?.totalTokens || data.usage?.total_tokens || 0,
      completionTokens: data.usage?.completionTokens || data.usage?.completion_tokens || 0,
    },
  };
}
