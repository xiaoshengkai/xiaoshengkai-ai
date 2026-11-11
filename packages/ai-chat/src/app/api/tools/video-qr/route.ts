/**
 * 视频转二维码工具 API
 * ============================================================================
 * POST   multipart(file, title) → ffmpeg 转 H.264 → addMedia → { token, url }
 * GET    → 该工具的媒体列表（kind=video）
 * DELETE { token } → 删除媒体（链接即刻 404）
 */
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { addMedia, listMedia, deleteMedia } from "@app/shared/media.js";

const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "avi", "mkv"]);
const MAX_SIZE = 200 * 1024 * 1024; // 200MB
const TMP_DIR = path.resolve(process.cwd(), "..", "..", "data", "media", "tmp");

function transcode(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y",
        "-i", inputPath,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        outputPath,
      ],
      { timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          const tail = (stderr || "").trim().split("\n").slice(-5).join(" | ");
          reject(new Error(`转码失败：${tail || err.message}`));
        } else {
          resolve();
        }
      }
    );
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ ok: false, error: "缺少文件" }, { status: 400 });
    }
    const title = String(formData.get("title") || "").trim();
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!VIDEO_EXTS.has(ext)) {
      return NextResponse.json(
        { ok: false, error: `不支持的格式 .${ext}（允许 mp4/mov/webm/avi/mkv）` },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { ok: false, error: `视频过大（${(file.size / 1024 / 1024).toFixed(1)}MB > 200MB）` },
        { status: 400 }
      );
    }

    await mkdir(TMP_DIR, { recursive: true });
    const tmpName = `${crypto.randomBytes(8).toString("hex")}.${ext}`;
    const tmpIn = path.join(TMP_DIR, tmpName);
    const tmpOut = path.join(TMP_DIR, `${tmpName}.out.mp4`);
    await writeFile(tmpIn, new Uint8Array(await file.arrayBuffer()));

    try {
      await transcode(tmpIn, tmpOut);
      const token = addMedia({ filePath: tmpOut, mime: "video/mp4", title, kind: "video" });
      return NextResponse.json({ ok: true, token, url: `/m/${token}`, title });
    } finally {
      await unlink(tmpIn).catch(() => {});
      await unlink(tmpOut).catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  const items = listMedia().filter((m) => m.kind === "video");
  return NextResponse.json({ ok: true, items });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = body?.token;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ ok: false, error: "missing token" }, { status: 400 });
  }
  const ok = deleteMedia(token);
  return NextResponse.json({ ok });
}
