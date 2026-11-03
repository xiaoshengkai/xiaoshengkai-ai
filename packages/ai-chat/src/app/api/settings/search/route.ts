import { NextResponse } from "next/server";
import { readSearchSettings, writeSearchSettings } from "@/lib/settings/store";

// 搜索后端选择（fresh-read，search service 每次请求读取 data/settings/search.json）
export async function GET() {
  const settings = readSearchSettings();
  const firecrawlConfigured = !!process.env.FIRECRAWL_API_KEY;
  return NextResponse.json({ ...settings, firecrawlConfigured });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const provider = body.provider === "deepseek" || body.provider === "firecrawl" ? body.provider : "auto";
  writeSearchSettings({ provider });
  return NextResponse.json({ ok: true, provider });
}
