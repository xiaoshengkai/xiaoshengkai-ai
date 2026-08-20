import { listConversations } from "../_lib/store";

export async function GET() {
  console.log("[conv:getList] 获取对话列表");
  const list = listConversations();
  console.log(`[conv:getList] 返回 ${list.length} 个对话`);
  return Response.json(list);
}