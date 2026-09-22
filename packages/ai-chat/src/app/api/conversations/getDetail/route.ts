import { gzipSync } from "node:zlib";
import { readConversation, trimToolOutputs } from "../_lib/store";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id 必填" }, { status: 400 });

  console.log(`[conv:getDetail] id=${id}`);
  const record = readConversation(id);
  if (!record) return Response.json({ error: "对话不存在" }, { status: 404 });

  // 响应瘦身：tool output 截断（存储无损，save 时按 toolCallId 合并回完整值）
  const body = JSON.stringify(trimToolOutputs(record));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Vary: "Accept-Encoding",
  };
  // App Router 不自动压缩：3.3MB 明文在公网慢链路上是秒级传输，gzip 手动补
  if ((req.headers.get("accept-encoding") || "").includes("gzip")) {
    return new Response(gzipSync(Buffer.from(body)), {
      headers: { ...headers, "Content-Encoding": "gzip" },
    });
  }
  return new Response(body, { headers });
}
