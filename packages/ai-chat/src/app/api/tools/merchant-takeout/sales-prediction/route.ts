/**
 * POST /api/tools/merchant-takeout/sales-prediction
 * 生成销量与推广四阶段预测（先展示不落盘，用户采用后才写回 store.sales）。
 *
 * Body: { storeId } → 生成预测
 * Body: { storeId, prediction, apply: true } → 采用基准方案并写回 store.sales
 * 返回: { ok: true, prediction, store? }；缺店 404；异常 500（predictSales 内部已降级，极少触发）。
 */
import { NextRequest, NextResponse } from "next/server";
import { readStore, writeStore } from "@/lib/merchant-takeout/store";
import { predictSales, applyBaselinePrediction } from "@/lib/merchant-takeout/predict-sales";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const storeId = String(body?.storeId || "");
    const store = readStore(storeId);
    if (!store) return NextResponse.json({ ok: false, error: "店铺不存在" }, { status: 404 });

    const prediction = body?.prediction ?? null;
    if (body?.apply && prediction) {
      const withPrediction = { ...store, salesPrediction: prediction };
      const applied = writeStore(applyBaselinePrediction(withPrediction));
      return NextResponse.json({ ok: true, prediction, store: applied });
    }

    const result = await predictSales(store);
    return NextResponse.json({ ok: true, prediction: result });
  } catch (error) {
    console.error("POST /api/tools/merchant-takeout/sales-prediction error:", error);
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
