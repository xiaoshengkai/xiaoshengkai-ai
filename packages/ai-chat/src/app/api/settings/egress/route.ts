import { NextResponse } from "next/server";
import { readEgress, writeEgress } from "@/lib/settings/store";

export async function GET() {
  return NextResponse.json(readEgress());
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  writeEgress({
    enabled: !!body.enabled,
    proxy: String(body.proxy || "127.0.0.1:11080").trim(),
    whitelist: Array.isArray(body.whitelist)
      ? body.whitelist.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [],
  });
  return NextResponse.json({ ok: true });
}
