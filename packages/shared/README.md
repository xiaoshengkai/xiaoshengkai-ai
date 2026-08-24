# shared

跨包公共叶子包（`@app/shared`）：logger / network / utils / llm / capability（通用能力 dispatcher）。被 ai-chat、mcp、workflows、tasks 裸导入，不依赖任何业务包。

详见 [ARCHITECTURE.md — 目录结构](../../ARCHITECTURE.md#目录结构) 与 [能力注册机制](../../ARCHITECTURE.md#能力注册机制v0110)。
