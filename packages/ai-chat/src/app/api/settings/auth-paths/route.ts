import { NextResponse } from "next/server";
import { readAuthPaths, writeAuthPaths } from "@/lib/settings/store";

export async function GET() {
  return NextResponse.json(readAuthPaths());
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  writeAuthPaths({
    protected: Array.isArray(body.protected)
      ? body.protected.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [],
  });
  return NextResponse.json({ ok: true });
}
