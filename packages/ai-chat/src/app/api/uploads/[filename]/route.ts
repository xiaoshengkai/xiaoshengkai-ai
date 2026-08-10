/**
 * 上传文件访问 API
 *
 * 支持 Range（视频流式播放需要）
 * 支持路径：
 *   - data/static/images/<filename>  (图片)
 *   - data/static/videos/<filename>  (视频)
 *   - data/static/<filename>         (其他)
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  pdf: "application/pdf",
  txt: "text/plain",
  json: "application/json",
};

const STATIC_ROOT = path.resolve(process.cwd(), "..", "..", "data", "static");

const STATIC_DIRS = ["images", "videos", ""];  // "" = root

function isPathSafe(filename: string): boolean {
  // 防止路径穿越
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return false;
  }
  return /^[a-zA-Z0-9._-]+$/.test(filename);
}

async function findFile(filename: string): Promise<string | null> {
  if (!isPathSafe(filename)) return null;
  for (const subdir of STATIC_DIRS) {
    const fullPath = subdir ? path.join(STATIC_ROOT, subdir, filename) : path.join(STATIC_ROOT, filename);
    try {
      await stat(fullPath);
      return fullPath;
    } catch {
      // continue
    }
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const filePath = await findFile(filename);
  if (!filePath) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const contentType = MIME[ext] || "application/octet-stream";
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;

  // Range 请求（视频拖动播放需要）
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const stream = createReadStream(filePath, { start, end });
      // @ts-expect-error - Web ReadableStream from Node ReadStream
      return new NextResponse(stream, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
  }

  // 完整文件
  const buffer = await readFile(filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    },
  });
}