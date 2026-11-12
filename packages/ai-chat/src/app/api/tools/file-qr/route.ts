/**
 * 文件转二维码工具 API
 * ============================================================================
 * POST   multipart(file,title) → 按扩展名分流（视频转码 H.264 / 图片·PDF 直存）
 *        json(url,title)       → 链接条目（QR 直接编码目标 URL）
 * GET    → 全部条目列表
 * DELETE { token } → 删除（文件类 /m/<token> 即 404；链接类仅移除记录）
 */
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { addMedia, addLink, listMedia, deleteMedia } from "@app/shared/media.js";

const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "avi", "mkv"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const PDF_EXTS = new Set(["pdf"]);

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const LIMITS_MB = { video: 200, image: 20, pdf: 50 };
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

function classify(ext: string): { kind: "video" | "image" | "pdf" } | null {
  if (VIDEO_EXTS.has(ext)) return { kind: "video" };
  if (IMAGE_EXTS.has(ext)) return { kind: "image" };
  if (PDF_EXTS.has(ext)) return { kind: "pdf" };
  return null;
}

async function handleFileUpload(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ ok: false, error: "缺少文件" }, { status: 400 });
  }
  const title = String(formData.get("title") || "").trim();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const cls = classify(ext);
  if (!cls) {
    return NextResponse.json(
      { ok: false, error: `不支持的格式 .${ext}（图片 png/jpg/jpeg/gif/webp · 视频 mp4/mov/webm/avi/mkv · PDF）` },
      { status: 400 }
    );
  }

  const limitMb = LIMITS_MB[cls.kind];
  if (file.size > limitMb * 1024 * 1024) {
    return NextResponse.json(
      { ok: false, error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB > ${limitMb}MB）` },
      { status: 400 }
    );
  }

  await mkdir(TMP_DIR, { recursive: true });
  const tmpName = `${crypto.randomBytes(8).toString("hex")}.${ext}`;

  // 视频：转码 H.264
  if (cls.kind === "video") {
    const tmpIn = path.join(TMP_DIR, tmpName);
    const tmpOut = path.join(TMP_DIR, `${tmpName}.out.mp4`);
    await writeFile(tmpIn, new Uint8Array(await file.arrayBuffer()));
    try {
      await transcode(tmpIn, tmpOut);
      const token = addMedia({ filePath: tmpOut, mime: "video/mp4", title, kind: "video" });
      return NextResponse.json({ ok: true, token, url: `/m/${token}`, title, kind: "video" });
    } finally {
      await unlink(tmpIn).catch(() => {});
      await unlink(tmpOut).catch(() => {});
    }
  }

  // 图片 / PDF：直存
  const mime = cls.kind === "pdf" ? "application/pdf" : IMAGE_MIME[ext];
  const tmpFile = path.join(TMP_DIR, tmpName);
  await writeFile(tmpFile, new Uint8Array(await file.arrayBuffer()));
  try {
    const token = addMedia({ filePath: tmpFile, mime, title, kind: cls.kind });
    return NextResponse.json({ ok: true, token, url: `/m/${token}`, title, kind: cls.kind });
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

async function handleUrl(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = String(body?.url || "").trim();
  const title = String(body?.title || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "链接无效" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ ok: false, error: "仅支持 http/https 链接" }, { status: 400 });
  }
  const targetUrl = parsed.toString();
  const token = addLink({ targetUrl, title });
  return NextResponse.json({ ok: true, token, url: targetUrl, title, kind: "url" });
}

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
      return await handleFileUpload(req);
    }
    return await handleUrl(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  const items = listMedia();
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
