import { NextResponse } from "next/server";
import { readProviders, writeProviders } from "@/lib/settings/store";
import { initSettings } from "@/lib/settings/init";

export async function GET() {
  initSettings();
  const data = readProviders();
  return NextResponse.json(data);
}

export async function PUT(request: Request) {
  const body = await request.json();
  writeProviders(body);
  return NextResponse.json({ ok: true });
}