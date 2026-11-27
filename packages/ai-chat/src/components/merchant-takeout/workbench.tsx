"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, CheckCircle2, ListChecks } from "lucide-react";
import type { MerchantStore } from "@/lib/merchant-takeout/types";
import { getReportReadiness } from "@/lib/merchant-takeout/calculate";
import { STATUS_META, READINESS_TOTAL } from "./meta";

const fmtMoney = (n: number) => `¥ ${n.toLocaleString("zh-CN")}`;

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="brutal bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-black text-foreground font-mono mt-1">{fmtMoney(value)}</div>
    </div>
  );
}

export default function Workbench({ store }: { store: MerchantStore }) {
  const router = useRouter();
  const meta = STATUS_META[store.status] || STATUS_META.simulation;
  const missing = getReportReadiness(store);
  const pct = Math.max(0, Math.round(((READINESS_TOTAL - missing.length) / READINESS_TOTAL) * 100));
  const nextStep = missing[0];

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 店铺头 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black font-heading text-foreground truncate">{store.profile.name}</h2>
            <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
              <span className={`brutal-chip px-2 py-0.5 text-[11px] ${meta.accent}`}>{meta.label}</span>
              {store.profile.category && (
                <span className="brutal-chip px-2 py-0.5 text-[11px] bg-card">{store.profile.category}</span>
              )}
              {store.profile.city && (
                <span className="text-xs text-muted-foreground font-mono">📍 {store.profile.city}</span>
              )}
              {store.profile.tags.length > 0 && (
                <span className="text-xs text-muted-foreground/70">#{store.profile.tags.join(" #")}</span>
              )}
            </div>
          </div>
          <button
            onClick={() => router.push("/tools/merchant-takeout")}
            className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-card text-foreground shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> 返回列表
          </button>
        </div>
      </div>

      {/* 资料完整度 + 待完善清单 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4" />
            <span className="text-sm font-bold text-foreground">资料完整度</span>
          </div>
          <span className="text-xl font-black text-foreground">{pct}%</span>
        </div>
        <div className="h-3 border-2 border-border bg-muted overflow-hidden mb-3">
          <div className="h-full bg-lime" style={{ width: `${pct}%` }} />
        </div>
        {missing.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-lime">
            <CheckCircle2 className="w-4 h-4" /> 资料已完整，可生成经营报告
          </div>
        ) : (
          <ul className="space-y-1.5">
            {missing.map((m) => (
              <li key={m} className="flex items-center gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="w-3.5 h-3.5 text-orange shrink-0" /> {m}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 指标 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Metric label="可投入资金" value={store.profile.availableCapital} />
        <Metric label="预留周转金" value={store.profile.workingCapital} />
        <Metric label="目标月净利润" value={store.profile.targetNetProfit} />
      </div>
      <div className="brutal bg-card p-3 text-xs text-muted-foreground">
        💡 月净利润 / 保本单量等经营指标：完成菜单与平台规则后可计算
      </div>

      {/* 下一步建议 */}
      <div className="brutal bg-card p-4">
        <div className="text-xs text-muted-foreground mb-1">下一步建议</div>
        <div className="text-sm font-bold text-foreground">
          {nextStep ? nextStep : "完善菜单与成本后可计算经营指标"}
        </div>
      </div>
    </div>
  );
}
