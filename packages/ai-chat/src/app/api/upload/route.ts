import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function POST(req: NextRequest) {
  try {
    const { base64, name } = await req.json();
    if (!base64) return NextResponse.json({ error: "no file data" }, { status: 400 });

    const ext = name?.split(".").pop() || "bin";
    const filename = `${crypto.randomUUID()}.${ext}`;
    const uploadsDir = path.resolve(process.cwd(), "..", "..", "data", "uploads");
    await mkdir(uploadsDir, { recursive: true });

    const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
    await writeFile(path.join(uploadsDir, filename), buffer);

    return NextResponse.json({ path: `/api/uploads/${filename}` });
  } catch (err) {
    console.error("upload error:", err);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}