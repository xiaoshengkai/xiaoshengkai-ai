"use client";

import { ArrowRight, Trash2 } from "lucide-react";
import type { MerchantStore } from "@/lib/merchant-takeout/types";
import { getReportReadiness } from "@/lib/merchant-takeout/calculate";
import { STATUS_META, READINESS_TOTAL } from "./meta";

interface StoreListProps {
  stores: MerchantStore[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

const fmtTime = (t: number) => new Date(t).toLocaleString("zh-CN", { hour12: false });

function completeness(store: MerchantStore): number {
  const missing = getReportReadiness(store).length;
  return Math.max(0, Math.round(((READINESS_TOTAL - missing) / READINESS_TOTAL) * 100));
}

export default function StoreList({ stores, onOpen, onDelete }: StoreListProps) {
  if (stores.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <span className="text-4xl">🏪</span>
        <p className="text-sm">还没有店铺</p>
        <p className="text-xs text-muted-foreground/60">点右上角「创建模拟店铺」开始</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {stores.map((store) => {
        const meta = STATUS_META[store.status] || STATUS_META.simulation;
        const pct = completeness(store);
        return (
          <div key={store.id} className="brutal bg-card p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 shrink-0 border-2 border-border bg-orange-soft flex items-center justify-center text-base">
                  🏪
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-black text-foreground truncate block">
                    {store.profile.name}
                  </span>
                  <div className="flex items-center flex-wrap gap-1.5 mt-1">
                    {store.profile.category && (
                      <span className="brutal-chip px-1.5 py-0 text-[10px] bg-card">{store.profile.category}</span>
                    )}
                    <span className={`brutal-chip px-1.5 py-0 text-[10px] ${meta.accent}`}>{meta.label}</span>
                    {store.profile.city && (
                      <span className="text-[10px] text-muted-foreground/70 font-mono">📍 {store.profile.city}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground/70 font-mono">保存于 {fmtTime(store.updatedAt)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="hidden sm:flex flex-col items-end gap-1">
                  <span className="text-[10px] text-muted-foreground font-mono">完整度 {pct}%</span>
                  <div className="w-20 h-2 border-2 border-border bg-muted overflow-hidden">
                    <div className="h-full bg-lime" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <button
                  onClick={() => onOpen(store.id)}
                  className="brutal-sm bg-card text-foreground px-2 py-0.5 text-xs font-bold inline-flex items-center gap-1"
                >
                  继续完善 <ArrowRight className="w-3 h-3" />
                </button>
                <button
                  onClick={() => onDelete(store.id)}
                  className="brutal-sm bg-destructive text-white px-2 py-0.5 text-xs font-bold inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> 删除
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
