import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";

const SETTINGS_DIR = path.resolve(process.cwd(), "..", "..", "data", "settings");
const RELOAD_MARKER = path.join(SETTINGS_DIR, "reload-marker.json");

let mcpClient: MCPClient | null = null;
let lastMarkerAt: string | null = null;

function checkMarker(): boolean {
  try {
    if (!fs.existsSync(RELOAD_MARKER)) return false;
    const { at } = JSON.parse(fs.readFileSync(RELOAD_MARKER, "utf-8"));
    if (at !== lastMarkerAt) {
      lastMarkerAt = at;
      return true;
    }
  } catch {}
  return false;
}

export async function getMCPClient(): Promise<MCPClient> {
  if (mcpClient && !checkMarker()) return mcpClient;

  if (mcpClient) {
    await mcpClient.close().catch(() => {});
  }

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