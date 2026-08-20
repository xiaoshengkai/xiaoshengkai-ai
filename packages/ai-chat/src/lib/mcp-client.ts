import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ponytail: MCP 子进程内 shared/llm 每次调用 fresh-read providers.json，无需重建客户端
let mcpClient: MCPClient | null = null;

export async function getMCPClient(): Promise<MCPClient> {
  if (mcpClient) return mcpClient;

  const transport = new StdioClientTransport({
    command: "node",
    args: ["../mcp/index.js"],
    cwd: process.cwd(),
  });

  mcpClient = await createMCPClient({
    transport,
    clientName: "ai-mcp-client",
  });

  return mcpClient;
}