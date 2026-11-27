/**
 * 外卖开店模拟器 API
 * ============================================================================
 * GET                      → 店铺列表（updatedAt 倒序）
 * POST   { name }          → 创建店铺
 * GET    ?id=<storeId>     → 读取单个店铺
 * PUT    ?id=<storeId>     → 更新店铺（保留 createdAt，刷新 updatedAt）
 * DELETE ?id=<storeId>     → 删除店铺
 */
import { NextRequest, NextResponse } from "next/server";
import { createStore, readStore, writeStore, listStores, deleteStore } from "@/lib/merchant-takeout/store";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const store = readStore(id);
    if (!store) return NextResponse.json({ ok: false, error: "店铺不存在" }, { status: 404 });
    return NextResponse.json({ ok: true, store });
  }
  return NextResponse.json({ ok: true, stores: listStores() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ ok: false, error: "缺少店铺名称" }, { status: 400 });
  const store = createStore(name);
  return NextResponse.json({ ok: true, store });
}

export async function PUT(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  const existing = readStore(id);
  if (!existing) return NextResponse.json({ ok: false, error: "店铺不存在" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const store = writeStore({ ...existing, ...body, id });
  return NextResponse.json({ ok: true, store });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  const ok = deleteStore(id);
  return NextResponse.json({ ok });
}
