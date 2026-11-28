"use client";

import { useId } from "react";
import type { LocationCosts, StoreLocation } from "@/lib/merchant-takeout/types";
import CompetitorEditor from "./competitor-editor";

/** 零值 LocationCosts，新增候选地址时使用 */
export function defaultLocationCosts(): LocationCosts {
  return {
    annualRent: 0,
    deposit: 0,
    depositRefundable: true,
    transferFee: 0,
    propertyFee: 0,
    agencyFee: 0,
    renovation: 0,
    waterPrice: 0,
    waterUsage: 0,
    electricityPrice: 0,
    electricityUsage: 0,
    gasPrice: 0,
    gasUsage: 0,
    area: 0,
    floor: "",
    pickupConvenience: "",
    conditions: "",
  };
}

interface LocationCostFormProps {
  location: StoreLocation;
  onChange: (patch: Partial<StoreLocation>) => void;
}

function NumField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted-foreground block mb-1">
        {label}
        {unit ? <span className="text-muted-foreground/60">（{unit}）</span> : null}
      </label>
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

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted-foreground block mb-1">{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border-2 border-border bg-card"
      />
    </div>
  );
}

const fmt = (n: number) => `¥ ${(Number.isFinite(n) ? n : 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;

export default function LocationCostForm({ location, onChange }: LocationCostFormProps) {
  const c = location.costs;
  const competitorsId = useId();
  const set = (patch: Partial<LocationCosts>) => onChange({ costs: { ...c, ...patch } });

  const monthlyRent = (c.annualRent || 0) / 12;
  const monthlyWater = (c.waterPrice || 0) * (c.waterUsage || 0);
  const monthlyElectricity = (c.electricityPrice || 0) * (c.electricityUsage || 0);
  const monthlyGas = (c.gasPrice || 0) * (c.gasUsage || 0);
  const monthlyTotal = monthlyRent + monthlyWater + monthlyElectricity + monthlyGas;

  return (
    <div className="space-y-3">
      {/* 租金与押金 */}
      <div>
        <div className="text-xs font-bold text-foreground mb-1.5">租金与押金</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <NumField label="年租金" unit="元" value={c.annualRent} onChange={(v) => set({ annualRent: v })} />
          <NumField label="押金" unit="元" value={c.deposit} onChange={(v) => set({ deposit: v })} />
          <NumField label="转让费" unit="元" value={c.transferFee} onChange={(v) => set({ transferFee: v })} />
          <NumField label="中介费" unit="元" value={c.agencyFee} onChange={(v) => set({ agencyFee: v })} />
          <NumField label="月物业费" unit="元" value={c.propertyFee} onChange={(v) => set({ propertyFee: v })} />
          <NumField label="装修预计" unit="元" value={c.renovation} onChange={(v) => set({ renovation: v })} />
        </div>
        <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={c.depositRefundable}
            onChange={(e) => set({ depositRefundable: e.target.checked })}
            className="accent-foreground"
          />
          押金可回收
        </label>
      </div>

      {/* 水电气 */}
      <div>
        <div className="text-xs font-bold text-foreground mb-1.5">水电气</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <NumField label="水费单价" unit="元/吨" value={c.waterPrice} onChange={(v) => set({ waterPrice: v })} />
          <NumField label="月用水量" unit="吨" value={c.waterUsage} onChange={(v) => set({ waterUsage: v })} />
          <NumField label="电费单价" unit="元/度" value={c.electricityPrice} onChange={(v) => set({ electricityPrice: v })} />
          <NumField label="月用电量" unit="度" value={c.electricityUsage} onChange={(v) => set({ electricityUsage: v })} />
          <NumField label="燃气单价" unit="元/m³" value={c.gasPrice} onChange={(v) => set({ gasPrice: v })} />
          <NumField label="月用气量" unit="m³" value={c.gasUsage} onChange={(v) => set({ gasUsage: v })} />
        </div>
      </div>

      {/* 场地与经营条件 */}
      <div>
        <div className="text-xs font-bold text-foreground mb-1.5">场地与经营条件</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <NumField label="面积" unit="㎡" value={c.area} onChange={(v) => set({ area: v })} />
          <TextField label="楼层" value={c.floor} onChange={(v) => set({ floor: v })} />
        </div>
        <div className="mt-2 space-y-2">
          <TextField label="骑手取餐便利说明" value={c.pickupConvenience} onChange={(v) => set({ pickupConvenience: v })} />
          <TextField label="排烟/消防/用电/餐饮经营条件" value={c.conditions} onChange={(v) => set({ conditions: v })} />
        </div>
      </div>

      {/* 竞店说明 */}
      <div>
        <div className="text-xs font-bold text-foreground mb-1.5">竞店说明</div>
        <label htmlFor={competitorsId} className="text-xs text-muted-foreground block mb-1">
          代表竞店的月售/评分/价格/活动等说明
        </label>
        <textarea
          id={competitorsId}
          value={location.competitors}
          onChange={(e) => onChange({ competitors: e.target.value })}
          rows={3}
          placeholder="如：500m 内一家月售 2000+ 的同品类店，客单价 ¥25，满减活动频繁…"
          className="w-full px-2 py-1.5 text-sm border-2 border-border bg-card"
        />
      </div>

      {/* 结构化竞店卡片 */}
      <div>
        <div className="text-xs font-bold text-foreground mb-1.5">竞店卡片</div>
        <CompetitorEditor
          competitors={location.competitorList ?? []}
          onChange={(list) => onChange({ competitorList: list })}
        />
      </div>

      {/* 月度成本合计 */}
      <div className="brutal bg-muted/40 p-3 text-xs space-y-1 font-mono">
        <div className="flex justify-between"><span>月租金（年租金/12）</span><span>{fmt(monthlyRent)}</span></div>
        <div className="flex justify-between"><span>月水费</span><span>{fmt(monthlyWater)}</span></div>
        <div className="flex justify-between"><span>月电费</span><span>{fmt(monthlyElectricity)}</span></div>
        <div className="flex justify-between"><span>月燃气费</span><span>{fmt(monthlyGas)}</span></div>
        <div className="flex justify-between border-t-2 border-border pt-1 font-bold">
          <span>水电燃气月合计</span>
          <span>{fmt(monthlyTotal)}</span>
        </div>
      </div>
    </div>
  );
}
