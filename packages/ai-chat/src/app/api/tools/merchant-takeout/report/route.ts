import { NextRequest, NextResponse } from "next/server";
import { readStore } from "@/lib/merchant-takeout/store";
import { getReportReadiness } from "@/lib/merchant-takeout/calculate";
import { generateReport } from "@/lib/merchant-takeout/report";

/**
 * POST /api/tools/merchant-takeout/report  { storeId }
 * 生成 AI 经营报告。资料不完整时不调模型；模型失败时优雅降级（report=null）。
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const storeId = String(body?.storeId || "");
  const store = readStore(storeId);
  if (!store) return NextResponse.json({ ok: false, error: "店铺不存在" }, { status: 404 });

  const missing = getReportReadiness(store);
  if (missing.length > 0) {
    return NextResponse.json({ ok: true, ready: false, missing });
  }

  try {
    const report = await generateReport(store);
    return NextResponse.json({ ok: true, ready: true, report });
  } catch (e) {
    return NextResponse.json({
      ok: true,
      ready: true,
      report: null,
      error: String((e as Error)?.message || e),
    });
  }
}
