import { getApiKey, getBaseUrl, getProviderModel } from "../config.js";

export async function callLLM({ system, user, model, temperature = 0.7, maxTokens = 8000, format = 'json_object' }) {
  const apiKey = getApiKey("glm", "GLM_API_KEY");
  if (!apiKey) throw new Error("未配置 GLM_API_KEY");

  const baseURL = getBaseUrl("glm", "GLM_BASE_URL", "https://open.bigmodel.cn/api/paas/v4");
  const actualModel = model || getProviderModel("glm", "chat", "GLM_CHAT_MODEL", "glm-5.2");
  console.log(`[glm] 当前调用: model=${actualModel} baseURL=${baseURL}`);

  const body = {
    model: actualModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (format) body.response_format = { type: format };

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.log(`[glm] callLLM: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    throw new Error(`GLM API 错误 (${res.status})`);
  }
  console.log(`[glm] usage: ${JSON.stringify(data.usage)}`);
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: {
      totalTokens: data.usage?.totalTokens || data.usage?.total_tokens || 0,
      completionTokens: data.usage?.completionTokens || data.usage?.completion_tokens || 0,
    },
  };
}