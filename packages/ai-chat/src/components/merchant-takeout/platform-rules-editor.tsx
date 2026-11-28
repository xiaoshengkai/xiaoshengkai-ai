"use client";

import { useId, useState } from "react";
import { AlertTriangle, Loader2, Globe } from "lucide-react";
import { toast } from "sonner";
import { BASE } from "@/lib/utils/utils";
import type { CommissionBase, PlatformRules } from "@/lib/merchant-takeout/types";
import { COMMISSION_BASE_LABELS, describeRuleSource } from "@/lib/merchant-takeout/platform";
import { useMerchantApi } from "./api";

const fmtPct = (v?: number) => (Number.isFinite(v) ? (v as number) * 100 : 0);

function NumInput({
  id,
  value,
  onChange,
  suffix,
}: {
  id?: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        id={id}
        type="number"
        min={0}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        placeholder="0"
        className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
      />
      {suffix && <span className="text-xs text-muted-foreground shrink-0">{suffix}</span>}
    </div>
  );
}

interface PlatformRulesEditorProps {
  rules: PlatformRules;
  onChange: (rules: PlatformRules) => void;
  city?: string;
}

export default function PlatformRulesEditor({ rules, onChange, city }: PlatformRulesEditorProps) {
  const [fetching, setFetching] = useState(false);
  const uid = useId();
  const api = useMerchantApi();
  const patch = (p: Partial<PlatformRules>) => onChange({ ...rules, ...p });
  const patchBase = (p: Partial<CommissionBase>) =>
    onChange({ ...rules, commissionBase: { ...rules.commissionBase, ...p } });

  const fetchReferences = async () => {
    setFetching(true);
    try {
      const res = await api(`${BASE}/api/tools/merchant-takeout/platform-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, rules }),
      });
      const data = await res.json();
      if (!data.ok || !data.rules) {
        toast.error(data.error || "联网检索失败");
        return;
      }
      if (!Array.isArray(data.references) || data.references.length === 0) {
        toast("未找到可靠参考来源，请按商家后台手动填写");
        return;
      }
      onChange(data.rules);
      toast("已填充 AI 参考规则，请核对商家后台");
    } catch {
      toast.error("联网检索失败，请稍后重试");
    } finally {
      setFetching(false);
    }
  };

  const baseKeys = Object.keys(COMMISSION_BASE_LABELS) as (keyof CommissionBase)[];
  const hasSource = !!(
    rules.source?.sourceUrl ||
    rules.source?.publishedAt ||
    rules.source?.fetchedAt ||
    rules.source?.region ||
    rules.source?.confidence ||
    rules.source?.conflictNote
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${uid}-rate`} className="text-xs text-muted-foreground block mb-1">平台扣点（%）</label>
          <NumInput id={`${uid}-rate`} value={fmtPct(rules.commissionRate)} onChange={(v) => patch({ commissionRate: v / 100 })} suffix="%" />
        </div>
        <div>
          <label htmlFor={`${uid}-fixed`} className="text-xs text-muted-foreground block mb-1">平台固定服务费（元/单）</label>
          <NumInput id={`${uid}-fixed`} value={rules.fixedServiceFee ?? 0} onChange={(v) => patch({ fixedServiceFee: v })} suffix="元" />
        </div>
        <div>
          <label htmlFor={`${uid}-customerFee`} className="text-xs text-muted-foreground block mb-1">向顾客收取配送费（元/单）</label>
          <NumInput id={`${uid}-customerFee`} value={rules.customerDeliveryFee ?? 0} onChange={(v) => patch({ customerDeliveryFee: v })} suffix="元" />
        </div>
        <div>
          <label htmlFor={`${uid}-merchantFee`} className="text-xs text-muted-foreground block mb-1">商家承担配送费（元/单）</label>
          <NumInput id={`${uid}-merchantFee`} value={rules.merchantDeliveryFee ?? 0} onChange={(v) => patch({ merchantDeliveryFee: v })} suffix="元" />
        </div>
      </div>

      {/* 扣点基数 */}
      <div>
        <div className="text-xs font-bold text-foreground mb-1.5">扣点基数（计入平台扣点的收入项）</div>
        <div className="flex flex-wrap gap-2">
          {baseKeys.map((key) => (
            <label key={key} className="brutal bg-card px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={rules.commissionBase[key]}
                onChange={(e) => patchBase({ [key]: e.target.checked } as Partial<CommissionBase>)}
              />
              {COMMISSION_BASE_LABELS[key]}
            </label>
          ))}
        </div>
      </div>

      {/* 优惠扣点先后 */}
      <label className="brutal bg-card px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={rules.discountBeforeCommission}
          onChange={(e) => patch({ discountBeforeCommission: e.target.checked })}
        />
        优惠在扣点前扣除
      </label>

      {/* 来源 */}
      <div className="brutal bg-muted/40 p-3 text-xs">
        <div className="font-bold text-foreground mb-1 flex items-center justify-between gap-2">
          <span>AI 参考来源</span>
          <button
            type="button"
            onClick={fetchReferences}
            disabled={fetching}
            className="brutal bg-card px-2 py-1 flex items-center gap-1.5 text-xs font-bold disabled:opacity-50"
          >
            {fetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
            {fetching ? "检索中…" : "联网获取参考规则"}
          </button>
        </div>
        {hasSource ? (
          <div className="text-muted-foreground break-all">{describeRuleSource(rules.source)}</div>
        ) : (
          <div className="text-muted-foreground/70">暂无 AI 参考来源（点击右上角联网拉取）</div>
        )}
      </div>

      {/* 确认 */}
      <label className="brutal bg-card px-3 py-2 text-xs flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={rules.confirmed}
          onChange={(e) => patch({ confirmed: e.target.checked })}
        />
        <span className="font-bold">我已核对商家后台并确认以上平台规则</span>
      </label>

      {!rules.confirmed && (
        <div className="brutal bg-orange-soft p-3 text-xs flex items-center gap-2 text-foreground">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          规则未确认，仅可预览，不能生成正式报告
        </div>
      )}
    </div>
  );
}
