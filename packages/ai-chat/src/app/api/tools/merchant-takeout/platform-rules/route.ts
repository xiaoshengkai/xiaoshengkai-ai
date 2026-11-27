/**
 * POST /api/tools/merchant-takeout/platform-rules
 * 联网检索淘宝闪购平台规则，并把命中引用套用到调用方当前规则。
 *
 * Body: { city?: string, rules?: PlatformRules }
 * 返回: { ok: true, references: RuleReference[], rules: PlatformRules }
 */
import { NextRequest, NextResponse } from "next/server";
import { searchPlatformRules, applyReferencesToRules } from "@/lib/merchant-takeout/rule-search";
import type { PlatformRules } from "@/lib/merchant-takeout/types";

const FALLBACK_RULES: PlatformRules = {
  platform: "taobao-flash",
  commissionBase: { includeProduct: true, includePackagingFee: false, includeDeliveryFee: false },
  discountBeforeCommission: false,
  confirmed: false,
  source: {},
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const city = typeof body?.city === "string" ? body.city : undefined;
    const references = await searchPlatformRules({ city });
    const current = (body?.rules ?? FALLBACK_RULES) as PlatformRules;
    const rules = applyReferencesToRules(references, current);
    return NextResponse.json({ ok: true, references, rules });
  } catch (error) {
    console.error("POST /api/tools/merchant-takeout/platform-rules error:", error);
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
