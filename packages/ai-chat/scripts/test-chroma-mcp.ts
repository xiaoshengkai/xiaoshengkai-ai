/**
 * chroma-server stdio MCP 集成测试
 * ============================================================================
 *
 * 模拟 ai-chat/src/app/api/chat/route.ts 的 getMCPClient() 方式:
 *   - spawn chroma-server 子进程
 *   - 经 stdio 协议列出工具
 *   - 调用 addKnowledge + searchKnowledge 验证 CRUD
 *
 * 用法:
 *   npx tsx scripts/test-chroma-mcp.ts
 *
 * 测试完后退出。
 * ============================================================================
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CHROMA_SERVER_PATH =
  "../mcp/index.js" as const;

async function main() {
  console.log("🧪 chroma-server stdio MCP 集成测试\n");

  // 1. spawn
  console.log("🔌 spawn chroma-server via stdio ...");
  const transport = new StdioClientTransport({
    command: "node",
    args: [CHROMA_SERVER_PATH],
  });
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  console.log("✅ 已连接\n");

  // 2. list tools
  console.log("📋 列出工具 ...");
  const { tools } = await client.listTools();
  console.log(`✅ 找到 ${tools.length} 个工具:`);
  for (const t of tools) {
    console.log(`   - ${t.name}: ${(t.description ?? '').slice(0, 50)}...`);
  }
  console.log();

  // 3. addKnowledge
  console.log("➕ 调用 addKnowledge ...");
  const addRes = (await client.callTool({
    name: "addKnowledge",
    arguments: {
      content: "Java Stream API 是惰性求值的,只有终止操作触发时才真正执行中间操作。",
      source: "integration-test",
    },
  })) as { content: { type: string; text: string }[] };
  const addData = JSON.parse(addRes.content[0].text);
  console.log("✅", addData);
  if (!addData.ok) throw new Error("addKnowledge 失败");
  const testId = addData.data.id;
  console.log(`   新增 id: ${testId}\n`);

  // 4. searchKnowledge
  console.log("🔍 调用 searchKnowledge ...");
  const searchRes = (await client.callTool({
    name: "searchKnowledge",
    arguments: { query: "Stream 惰性", topK: 3 },
  })) as { content: { type: string; text: string }[] };
  const searchData = JSON.parse(searchRes.content[0].text);
  console.log("✅", searchData);
  if (!searchData.ok) throw new Error("searchKnowledge 失败");
  const found = searchData.data.results.some(
    (r: { id: string }) => r.id === testId,
  );
  if (!found) {
    throw new Error(`刚 add 的 id ${testId} 没出现在 Top-3`);
  }
  console.log(`   ✅ 验证:刚新增的笔记出现在检索结果中\n`);

  // 5. deleteKnowledge
  console.log("🗑️  调用 deleteKnowledge(软删)...");
  const delRes = (await client.callTool({
    name: "deleteKnowledge",
    arguments: { id: testId },
  })) as { content: { type: string; text: string }[] };
  const delData = JSON.parse(delRes.content[0].text);
  console.log("✅", delData);
  if (!delData.ok) throw new Error("deleteKnowledge 失败");
  console.log();

  // 6. restoreKnowledgeById(3 秒内)
  console.log("↩️  调用 restoreKnowledgeById ...");
  const restoreRes = (await client.callTool({
    name: "restoreKnowledgeById",
    arguments: { id: testId },
  })) as { content: { type: string; text: string }[] };
  const restoreData = JSON.parse(restoreRes.content[0].text);
  console.log("✅", restoreData);
  if (!restoreData.ok || !restoreData.data.restored) {
    throw new Error("restoreKnowledgeById 失败");
  }
  console.log();

  // 7. updateKnowledge
  console.log("✏️  调用 updateKnowledge ...");
  const updRes = (await client.callTool({
    name: "updateKnowledge",
    arguments: {
      id: testId,
      newContent: "Java Stream API 是惰性求值的,补充:中间操作返回新 stream,不会修改源数据。",
    },
  })) as { content: { type: string; text: string }[] };
  const updData = JSON.parse(updRes.content[0].text);
  console.log("✅", updData);
  if (!updData.ok) throw new Error("updateKnowledge 失败");
  console.log();

  // 8. 清理(再次 delete,这次让它过期)
  console.log("🧹 清理测试数据(再次 delete,超时后自动消失)...");
  await client.callTool({
    name: "deleteKnowledge",
    arguments: { id: testId },
  });
  console.log("✅ 测试数据已软删,3 秒后会被 ai-chat 懒清理\n");

  // 9. 关闭
  await client.close();
  console.log("🎉 全部 5 个工具验证通过!");
  console.log("   chroma-server stdio MCP 协议工作正常,可以接入 ai-chat route.ts。");
}

main().catch((err) => {
  console.error("❌ 测试失败:", err);
  process.exit(1);
});