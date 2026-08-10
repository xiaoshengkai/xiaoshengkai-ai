/**
 * 上传 API — 支持图片/视频
 *
 * - MIME 白名单校验（防扩展名欺骗）
 * - 图片 → data/static/images/
 * - 视频 → data/static/videos/
 * - 大小上限：图片 20MB，视频 100MB
 */
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv"]);  // 移除 webm（M3 不支持）

const IMAGE_MAX = 10 * 1024 * 1024;   // 10MB（M3 图片上限）
const VIDEO_MAX = 50 * 1024 * 1024;  // 50MB（M3 视频 base64 上限）

const MIME_WHITELIST: Record<string, Set<string>> = {
  "image/png": new Set(["png"]),
  "image/jpeg": new Set(["jpg", "jpeg"]),
  "image/gif": new Set(["gif"]),
  "image/webp": new Set(["webp"]),
  "video/mp4": new Set(["mp4"]),
  "video/quicktime": new Set(["mov"]),
  "video/x-msvideo": new Set(["avi"]),
  "video/x-matroska": new Set(["mkv"]),
};

export async function POST(req: NextRequest) {
  try {
    const { base64, name, mimeType } = await req.json();
    if (!base64) return NextResponse.json({ error: "no file data" }, { status: 400 });

    // 提取扩展名（优先用客户端传的 name，其次 mimeType）
    const ext = (name?.split(".").pop() || "").toLowerCase();
    if (!ext) return NextResponse.json({ error: "missing file extension" }, { status: 400 });

    // MIME 校验
    const validExts = mimeType ? MIME_WHITELIST[mimeType] : null;
    if (mimeType && !validExts) {
      return NextResponse.json({
        error: `不支持的文件类型：${mimeType}。允许：${Object.keys(MIME_WHITELIST).join(", ")}`,
      }, { status: 400 });
    }
    if (validExts && !validExts.has(ext)) {
      return NextResponse.json({
        error: `扩展名 .${ext} 与 MIME ${mimeType} 不匹配`,
      }, { status: 400 });
    }
    // mimeType 缺失但扩展名有效：从扩展名推断
    if (!mimeType) {
      if (!IMAGE_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) {
        return NextResponse.json({
          error: `不支持的扩展名：.${ext}`,
        }, { status: 400 });
      }
    }

    // 解析 base64
    const base64Data = base64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // 大小校验
    const isVideo = VIDEO_EXTS.has(ext);
    const maxSize = isVideo ? VIDEO_MAX : IMAGE_MAX;
    if (buffer.length > maxSize) {
      return NextResponse.json({
        error: `${isVideo ? "视频" : "图片"}过大（${(buffer.length / 1024 / 1024).toFixed(1)}MB > ${maxSize / 1024 / 1024}MB）`,
      }, { status: 400 });
    }

    // 保存路径：图片 → images/，视频 → videos/
    const subdir = isVideo ? "videos" : "images";
    const filename = `${crypto.randomUUID()}.${ext}`;
    const uploadsDir = path.resolve(process.cwd(), "..", "..", "data", "static", subdir);
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, filename), buffer);

    return NextResponse.json({
      path: `/api/uploads/${filename}`,
      modality: isVideo ? "video" : "image",
      filename,
      size: buffer.length,
    });
  } catch (err) {
    console.error("upload error:", err);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}