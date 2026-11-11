/**
 * 公开媒体服务路由
 * ============================================================================
 * 扫码入口：{公网基址}/m/<token> → 查 index.json → Range 流式返回。
 * token 不可猜测、URL 无结构/扩展名/原名，mime 由服务端查表。
 * 公开访问（proxy.ts 豁免 /m/*），支持 Range（视频拖动播放）。
 */
import { createReadStream } from "node:fs";
import { getMedia } from "@app/shared/media.js";

const CACHE = "public, max-age=31536000, immutable"; // token 内容不可变

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const found = getMedia(token);
  if (!found) {
    return new Response("Not Found", { status: 404 });
  }

  const { meta, filePath } = found;
  const fileSize = meta.size;
  const contentType = meta.mime || "application/octet-stream";

  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : fileSize - 1;
      if (start >= fileSize || end >= fileSize || start > end) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }
      const stream = createReadStream(filePath, { start, end }) as unknown as ReadableStream;
      return new Response(stream, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": CACHE,
        },
      });
    }
  }

  const stream = createReadStream(filePath) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": CACHE,
    },
  });
}
