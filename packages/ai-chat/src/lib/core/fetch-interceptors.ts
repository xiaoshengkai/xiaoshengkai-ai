/**
 * Fetch 拦截器集合 — 给不同 LLM 注入各自协议需要的非标字段
 *
 * 通用工具，不属于 strategy 层。
 */

// ponytail: Qwen3.8-Max 是思考模型，DashScope 兼容模式靠 enable_thinking 开关（而非 AI SDK 的 thinking 参数）
export function injectEnableThinking(doFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        body.enable_thinking = true;
        init = { ...init, body: JSON.stringify(body) };
      } catch { /* 非 JSON 不处理 */ }
    }
    return doFetch(input, init);
  };
}

// ponytail: M3 OpenAI 兼容模式需要 reasoning_split=true 把思考分离到 reasoning_details 字段（2026-08-19）
// 否则 thinking 内容会跟 text 混在一起输出 <think>...</think>
export function injectReasoningSplit(doFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        body.reasoning_split = true;
        init = { ...init, body: JSON.stringify(body) };
      } catch { /* 非 JSON 不处理 */ }
    }
    return doFetch(input, init);
  };
}