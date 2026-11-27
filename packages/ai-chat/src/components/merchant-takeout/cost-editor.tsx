"use client";

import { useId } from "react";
import { MapPin } from "lucide-react";
import type { OneTimeCosts, MonthlyFixedCosts, StoreCosts, StoreLocation } from "@/lib/merchant-takeout/types";

const fmt = (n: number) =>
  `¥ ${(Number.isFinite(n) ? n : 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted-foreground block mb-1">{label}（元）</label>
      <input
        id={id}
        type="number"
        min={0}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        placeholder="0"
        className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
      />
    </div>
  );
}

interface CostEditorProps {
  costs: StoreCosts;
  onChange: (costs: StoreCosts) => void;
  selectedLocation?: StoreLocation | null;
}

export default function CostEditor({ costs, onChange, selectedLocation }: CostEditorProps) {
  const setOneTime = (patch: Partial<OneTimeCosts>) =>
    onChange({ ...costs, oneTime: { ...costs.oneTime, ...patch } });
  const setMonthly = (patch: Partial<MonthlyFixedCosts>) =>
    onChange({ ...costs, monthlyFixed: { ...costs.monthlyFixed, ...patch } });

  const applyFromLocation = () => {
    if (!selectedLocation) return;
    const c = selectedLocation.costs;
    const utilities =
      (c.waterPrice || 0) * (c.waterUsage || 0) +
      (c.electricityPrice || 0) * (c.electricityUsage || 0) +
      (c.gasPrice || 0) * (c.gasUsage || 0);
    setMonthly({ rent: (c.annualRent || 0) / 12, utilities });
  };

  const oneTimeFields: { key: keyof OneTimeCosts; label: string }[] = [
    { key: "renovation", label: "装修" },
    { key: "equipment", label: "设备" },
    { key: "franchiseFee", label: "加盟费" },
    { key: "transferFee", label: "转让费" },
    { key: "agencyFee", label: "中介费" },
    { key: "license", label: "证照" },
    { key: "initialInventory", label: "首批原料" },
    { key: "openingPromotion", label: "开业推广" },
  ];

  const monthlyFields: { key: keyof MonthlyFixedCosts; label: string }[] = [
    { key: "rent", label: "房租" },
    { key: "utilities", label: "水电气" },
    { key: "property", label: "物业" },
    { key: "network", label: "网络" },
    { key: "garbage", label: "垃圾处理" },
    { key: "other", label: "其他" },
  ];

  const oneTimeTotal = oneTimeFields.reduce((s, f) => s + (costs.oneTime[f.key] || 0), 0);
  const monthlyTotal = monthlyFields.reduce((s, f) => s + (costs.monthlyFixed[f.key] || 0), 0);

  return (
    <div className="space-y-4">
      {/* 地址带入 */}
      {selectedLocation && (
        <div className="brutal bg-muted/40 p-3 space-y-2">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            来源地址：{selectedLocation.name || selectedLocation.address || "当前经营地址"}
          </div>
          <button
            type="button"
            onClick={applyFromLocation}
            className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue text-white"
          >
            从选中地址带入租金与水电
          </button>
          <div className="text-[11px] text-muted-foreground">
            带入后仍可手动修改，避免地址成本重复维护
          </div>
        </div>
      )}

      {/* 一次性投入 */}
      <div>
        <div className="text-xs font-bold text-foreground mb-1.5">一次性投入（进启动资金，不摊入月利润）</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {oneTimeFields.map((f) => (
            <NumField
              key={f.key}
              label={f.label}
              value={costs.oneTime[f.key]}
              onChange={(v) => setOneTime({ [f.key]: v })}
            />
          ))}
          <NumField
            label="押金（可回收）"
            value={costs.oneTime.refundableDeposit}
            onChange={(v) => setOneTime({ refundableDeposit: v })}
          />
        </div>
        <div className="flex items-start justify-between gap-3 mt-2">
          <div className="text-[11px] text-muted-foreground">
            押金到期可回收，不计入一次性投入，也不摊入月利润
          </div>
          <div className="text-xs font-mono font-bold shrink-0">合计 {fmt(oneTimeTotal)}</div>
        </div>
      </div>

      {/* 月固定成本 */}
      <div>
        <div className="text-xs font-bold text-foreground mb-1.5">月固定成本（用于月经营利润与保本单量）</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {monthlyFields.map((f) => (
            <NumField
              key={f.key}
              label={f.label}
              value={costs.monthlyFixed[f.key]}
              onChange={(v) => setMonthly({ [f.key]: v })}
            />
          ))}
        </div>
        <div className="flex items-start justify-between gap-3 mt-2">
          <div className="text-[11px] text-muted-foreground">人工成本由「人员与用工」模块统一维护，此处不含人工</div>
          <div className="text-xs font-mono font-bold shrink-0">合计 {fmt(monthlyTotal)}</div>
        </div>
      </div>
    </div>
  );
}
