import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const UPLOAD_DIR = path.resolve(process.cwd(), "..", "..", "data", "static", "audio");

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase();
    if (![".mp3", ".wav", ".m4a", ".ogg"].includes(ext)) {
      return NextResponse.json({ error: "不支持的音频格式" }, { status: 400 });
    }

    const randomId = crypto.randomBytes(8).toString("hex");
    const filename = `${randomId}${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({ ok: true, tempPath: filePath, filename });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}