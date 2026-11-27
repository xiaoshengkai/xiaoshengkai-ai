/**
 * 外卖开店模拟器 — 方案快照 API
 * ============================================================================
 * POST   { storeId, label, input, scenarios }  → 创建快照
 * GET    ?storeId=<storeId>                     → 某店铺快照列表（createdAt 倒序）
 * GET    ?id=<snapshotId>                       → 读取单个快照
 * DELETE ?id=<snapshotId>                       → 删除快照
 * POST   ?copy=1  { id, name }                  → 复制快照为新草稿
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { StoreSnapshot } from "@/lib/merchant-takeout/types";
import {
  createSnapshot,
  readSnapshot,
  listSnapshots,
  deleteSnapshot,
  copySnapshotToDraft,
} from "@/lib/merchant-takeout/snapshots";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const snapshot = readSnapshot(id);
    if (!snapshot) return NextResponse.json({ ok: false, error: "快照不存在" }, { status: 404 });
    return NextResponse.json({ ok: true, snapshot });
  }
  const storeId = req.nextUrl.searchParams.get("storeId") ?? undefined;
  return NextResponse.json({ ok: true, snapshots: listSnapshots(storeId) });
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("copy") === "1") {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "");
    const name = String(body?.name || "");
    const store = copySnapshotToDraft(id, name);
    if (!store) return NextResponse.json({ ok: false, error: "快照不存在" }, { status: 404 });
    return NextResponse.json({ ok: true, store });
  }

  const body = await req.json().catch(() => ({}));
  const storeId = String(body?.storeId || "").trim();
  if (!storeId) return NextResponse.json({ ok: false, error: "缺少 storeId" }, { status: 400 });
  const snapshot: StoreSnapshot = {
    id: randomUUID(),
    storeId,
    createdAt: Date.now(),
    label: String(body?.label || "").trim() || "未命名方案",
    input: body?.input,
    scenarios: Array.isArray(body?.scenarios) ? body.scenarios : [],
  };
  createSnapshot(snapshot);
  return NextResponse.json({ ok: true, snapshot });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  const ok = deleteSnapshot(id);
  return NextResponse.json({ ok });
}
