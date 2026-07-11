const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";

export async function callLLM({ system, user, model, temperature = 0.7, maxTokens = 2000 }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("未配置 DEEPSEEK_API_KEY");

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: { totalTokens: data.usage?.totalTokens || data.usage?.total_tokens || 0 },
  };
}