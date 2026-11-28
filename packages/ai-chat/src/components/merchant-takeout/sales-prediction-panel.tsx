"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import type { MerchantStore, SalesPrediction, SalesPhasePrediction } from "@/lib/merchant-takeout/types";
import { BASE } from "@/lib/utils/utils";
import { useMerchantApi } from "./api";

const PHASE_LABELS: Record<number, string> = { 1: "第1月", 2: "第2月", 3: "第3月", 4: "稳定期" };

const CONFIDENCE_META: Record<SalesPrediction["confidence"], { label: string; cls: string }> = {
  low: { label: "低", cls: "bg-muted text-muted-foreground" },
  medium: { label: "中", cls: "bg-yellow text-foreground" },
  high: { label: "高", cls: "bg-lime text-foreground" },
};

const fmt = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("zh-CN");

interface SalesPredictionPanelProps {
  store: MerchantStore;
  onUpdate: (store: MerchantStore) => void;
}

function Collapsible({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details className="brutal bg-muted p-2 group">
      <summary className="text-xs font-bold text-foreground cursor-pointer">{title}（{items.length}）</summary>
      <ul className="mt-2 space-y-1">
        {items.map((s, i) => (
          <li key={i} className="text-xs text-muted-foreground break-words">{s}</li>
        ))}
      </ul>
    </details>
  );
}

export default function SalesPredictionPanel({ store, onUpdate }: SalesPredictionPanelProps) {
  const uid = useId();
  const api = useMerchantApi();
  const [prediction, setPrediction] = useState<SalesPrediction | null>(store.salesPrediction ?? null);
  const [predicting, setPredicting] = useState(false);
  const [applying, setApplying] = useState(false);

  const predict = async () => {
    setPredicting(true);
    try {
      const res = await api(`${BASE}/api/tools/merchant-takeout/sales-prediction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.id }),
      });
      const data = await res.json();
      if (!data.ok || !data.prediction) {
        toast.error(data.error || "预测失败，请稍后重试");
        return;
      }
      setPrediction(data.prediction);
    } catch {
      toast.error("预测失败，请稍后重试");
    } finally {
      setPredicting(false);
    }
  };

  const apply = async () => {
    if (!prediction) return;
    setApplying(true);
    try {
      const res = await api(`${BASE}/api/tools/merchant-takeout/sales-prediction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.id, prediction, apply: true }),
      });
      const data = await res.json();
      if (!data.ok || !data.store) {
        toast.error(data.error || "采用失败，请稍后重试");
        return;
      }
      onUpdate(data.store);
      toast("已采用基准方案，写入经营沙盘");
    } catch {
      toast.error("采用失败，请稍后重试");
    } finally {
      setApplying(false);
    }
  };

  const conf = prediction ? CONFIDENCE_META[prediction.confidence] : null;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${uid}-cap`} className="text-[11px] text-muted-foreground block mb-0.5">
          月推广预算上限（元，0 表示不设上限）
        </label>
        <input
          id={`${uid}-cap`}
          type="number"
          min={0}
          value={Number.isFinite(store.profile.promotionBudgetCap) ? store.profile.promotionBudgetCap : 0}
          onChange={(e) => {
            const v = e.target.value === "" ? 0 : Number(e.target.value);
            onUpdate({ ...store, profile: { ...store.profile, promotionBudgetCap: v } });
          }}
          className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
        />
      </div>

      <button
        type="button"
        onClick={predict}
        disabled={predicting}
        className="brutal-btn px-3 py-2 text-sm font-bold bg-blue text-white disabled:opacity-50"
      >
        {predicting ? "预测中…" : "AI 预测销量与推广"}
      </button>

      {prediction && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-bold text-foreground">预测结果</div>
            {conf && (
              <span className={`brutal-chip px-2 py-0.5 text-[11px] ${conf.cls}`}>可信度：{conf.label}</span>
            )}
          </div>

          <div className="overflow-x-auto border-2 border-border">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted">
                <tr>
                  <th className="px-2 py-1.5 font-bold">阶段</th>
                  <th className="px-2 py-1.5 font-bold">保守</th>
                  <th className="px-2 py-1.5 font-bold">基准</th>
                  <th className="px-2 py-1.5 font-bold">乐观</th>
                  <th className="px-2 py-1.5 font-bold">推荐预算</th>
                  <th className="px-2 py-1.5 font-bold">新增订单</th>
                  <th className="px-2 py-1.5 font-bold">获客成本</th>
                </tr>
              </thead>
              <tbody>
                {prediction.phases.map((p: SalesPhasePrediction) => {
                  const acq = p.promotionOrders > 0 ? p.promotionBudget / p.promotionOrders : 0;
                  return (
                    <tr key={p.monthIndex} className="border-t-2 border-border">
                      <td className="px-2 py-1.5 font-bold">{PHASE_LABELS[p.monthIndex] ?? p.monthIndex}</td>
                      <td className="px-2 py-1.5 font-mono">{fmt(p.conservative)}</td>
                      <td className="px-2 py-1.5 font-mono font-bold">{fmt(p.baseline)}</td>
                      <td className="px-2 py-1.5 font-mono">{fmt(p.optimistic)}</td>
                      <td className="px-2 py-1.5 font-mono">{fmt(p.promotionBudget)}</td>
                      <td className="px-2 py-1.5 font-mono">{fmt(p.promotionOrders)}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {p.promotionOrders > 0 ? `${acq.toFixed(2)} 元/单` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Collapsible title="预测依据" items={prediction.basis} />
          <Collapsible title="资料来源" items={prediction.sources} />
          <Collapsible title="假设" items={prediction.assumptions} />
          <Collapsible title="缺失信息" items={prediction.missing} />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={apply}
              disabled={applying}
              className="brutal-btn px-3 py-2 text-sm font-bold bg-lime text-foreground disabled:opacity-50"
            >
              {applying ? "采用中…" : "采用基准方案"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPrediction(null);
                void predict();
              }}
              disabled={predicting}
              className="brutal-btn px-3 py-2 text-sm font-bold bg-card text-foreground disabled:opacity-50"
            >
              {predicting ? "预测中…" : "重新预测"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
