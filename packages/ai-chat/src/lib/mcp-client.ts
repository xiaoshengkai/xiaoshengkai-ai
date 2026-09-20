import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ponytail: MCP 子进程内 shared/llm 每次调用 fresh-read providers.json，无需重建客户端
// 缓存 Promise（而非实例）：避免并发首次请求 spawn 多个子进程
let mcpClientPromise: Promise<MCPClient> | null = null;

function createMCPClientInstance(): Promise<MCPClient> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["../mcp/index.js"],
    cwd: process.cwd(),
  });

  return createMCPClient({
    transport,
    clientName: "ai-mcp-client",
    // 客户端侧传输/解析错误也落日志（子进程死因在 MCP 侧另记）
    onUncaughtError: (error) =>
      console.error(`[mcp] client error - ${(error as Error)?.message ?? String(error)}`),
  });
}

export function getMCPClient(): Promise<MCPClient> {
  if (!mcpClientPromise) {
    mcpClientPromise = createMCPClientInstance().catch((err) => {
      mcpClientPromise = null; // 不缓存 rejected promise，初始化失败允许下次重试
      throw err;
    });
  }
  return mcpClientPromise;
}

// 子进程死亡/客户端关闭后清空单例，下次调用重新 spawn（自愈）
export function resetMCPClient(): void {
  const pending = mcpClientPromise;
  mcpClientPromise = null;
  pending?.then((c) => c.close().catch(() => {})).catch(() => {});
}