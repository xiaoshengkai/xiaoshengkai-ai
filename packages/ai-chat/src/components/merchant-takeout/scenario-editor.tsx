"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  SalesPhase,
  StoreLoss,
  StoreTax,
  SweepConfig,
  StoreActivities,
  TaxBaseKind,
} from "@/lib/merchant-takeout/types";
import ActivityEditor from "./activity-editor";

const PHASE_META = [
  { monthIndex: 1, label: "第1月" },
  { monthIndex: 2, label: "第2月" },
  { monthIndex: 3, label: "第3月" },
  { monthIndex: 4, label: "稳定期" },
] as const;

const TAX_BASE_LABELS: Record<TaxBaseKind, string> = {
  productRevenue: "商品营业收入",
  platformSettlement: "平台结算收入",
  preTaxProfit: "税前利润",
  custom: "自定义金额",
};

const fmt = (n: number) => `¥ ${(Number.isFinite(n) ? n : 0).toLocaleString("zh-CN")}`;

interface ScenarioEditorProps {
  sales: SalesPhase[];
  loss: StoreLoss;
  tax: StoreTax;
  sweep: SweepConfig;
  activities: StoreActivities;
  onChange: (patch: { sales?: SalesPhase[]; loss?: StoreLoss; tax?: StoreTax; sweep?: SweepConfig }) => void;
}

function PhaseCard({
  phase,
  activities,
  onChange,
}: {
  phase: SalesPhase;
  activities: StoreActivities;
  onChange: (phase: SalesPhase) => void;
}) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const custom = phase.activities !== undefined;
  const totalOrders = (phase.naturalOrders || 0) + (phase.promotionOrders || 0);
  const acqCost = phase.promotionOrders > 0 ? (phase.promotionBudget || 0) / phase.promotionOrders : 0;

  const patch = (p: Partial<SalesPhase>) => onChange({ ...phase, ...p });

  return (
    <div className="brutal bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-foreground">第{phase.monthIndex}月 · {totalOrders} 单</div>
        <div className="text-xs font-mono text-muted-foreground">
          {phase.promotionOrders > 0 ? `获客成本 ${acqCost.toFixed(2)} 元/单` : "无推广订单"}
        </div>
      </div>

      {phase.naturalOrdersReference && (
        <div className="text-[11px] text-muted-foreground bg-muted px-2 py-1 border-2 border-border">
          AI 参考区间：{phase.naturalOrdersReference}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label htmlFor={`${uid}-natural`} className="text-[11px] text-muted-foreground block mb-0.5">自然订单量</label>
          <input
            id={`${uid}-natural`}
            type="number"
            min={0}
            value={Number.isFinite(phase.naturalOrders) ? phase.naturalOrders : 0}
            onChange={(e) => patch({ naturalOrders: e.target.value === "" ? 0 : Number(e.target.value) })}
            className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-budget`} className="text-[11px] text-muted-foreground block mb-0.5">推广预算（元）</label>
          <input
            id={`${uid}-budget`}
            type="number"
            min={0}
            value={Number.isFinite(phase.promotionBudget) ? phase.promotionBudget : 0}
            onChange={(e) => patch({ promotionBudget: e.target.value === "" ? 0 : Number(e.target.value) })}
            className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-promo`} className="text-[11px] text-muted-foreground block mb-0.5">推广新增订单</label>
          <input
            id={`${uid}-promo`}
            type="number"
            min={0}
            value={Number.isFinite(phase.promotionOrders) ? phase.promotionOrders : 0}
            onChange={(e) => patch({ promotionOrders: e.target.value === "" ? 0 : Number(e.target.value) })}
            className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          本阶段活动（{custom ? "自定义" : "沿用全局"}）
        </button>
        <button
          type="button"
          onClick={() =>
            custom ? patch({ activities: undefined }) : patch({ activities: JSON.parse(JSON.stringify(activities)) })
          }
          className="brutal-btn px-2 py-1 text-xs font-bold bg-blue text-white"
        >
          {custom ? "改用全局" : "自定义"}
        </button>
      </div>

      {open && (
        <ActivityEditor
          activities={phase.activities ?? activities}
          onChange={(a) => patch({ activities: a })}
        />
      )}
    </div>
  );
}

export default function ScenarioEditor({ sales, loss, tax, sweep, activities, onChange }: ScenarioEditorProps) {
  const phases: SalesPhase[] = PHASE_META.map(
    (m) =>
      sales.find((p) => p.monthIndex === m.monthIndex) ?? {
        monthIndex: m.monthIndex,
        naturalOrders: 0,
        promotionBudget: 0,
        promotionOrders: 0,
      },
  );

  const patchPhase = (monthIndex: number, next: SalesPhase) =>
    onChange({ sales: PHASE_META.map((m) => (m.monthIndex === monthIndex ? next : phases.find((p) => p.monthIndex === m.monthIndex)!)) });

  const num = (v: number) => (Number.isFinite(v) ? v : 0);
  const uid = useId();

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        四个阶段：前三月逐月推演，稳定期代表长期经营常态。自然订单量可先填 AI 参考值再人工确认。
      </div>

      <div className="space-y-3">
        {phases.map((p) => (
          <PhaseCard
            key={p.monthIndex}
            phase={p}
            activities={activities}
            onChange={(next) => patchPhase(p.monthIndex, next)}
          />
        ))}
      </div>

      <div className="brutal bg-card p-3 space-y-3">
        <div className="text-sm font-bold text-foreground">订单损失</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${uid}-lossRate`} className="text-[11px] text-muted-foreground block mb-0.5">订单损失率（%）</label>
            <input
              id={`${uid}-lossRate`}
              type="number"
              min={0}
              max={100}
              value={num(loss.orderLossRate) * 100}
              onChange={(e) =>
                onChange({ loss: { ...loss, orderLossRate: (e.target.value === "" ? 0 : Number(e.target.value)) / 100 } })
              }
              className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-lossAmount`} className="text-[11px] text-muted-foreground block mb-0.5">单笔损失金额（元）</label>
            <input
              id={`${uid}-lossAmount`}
              type="number"
              min={0}
              value={num(loss.lossAmountPerOrder)}
              onChange={(e) =>
                onChange({ loss: { ...loss, lossAmountPerOrder: e.target.value === "" ? 0 : Number(e.target.value) } })
              }
              className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={loss.confirmed}
            onChange={(e) => onChange({ loss: { ...loss, confirmed: e.target.checked } })}
            className="accent-foreground"
          />
          已确认（含 0 值场景）
        </label>
      </div>

      <div className="brutal bg-card p-3 space-y-3">
        <div className="text-sm font-bold text-foreground">税费</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${uid}-taxRate`} className="text-[11px] text-muted-foreground block mb-0.5">综合税率（%）</label>
            <input
              id={`${uid}-taxRate`}
              type="number"
              min={0}
              max={100}
              value={num(tax.rate) * 100}
              onChange={(e) =>
                onChange({ tax: { ...tax, rate: (e.target.value === "" ? 0 : Number(e.target.value)) / 100 } })
              }
              className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-taxBase`} className="text-[11px] text-muted-foreground block mb-0.5">计税基数</label>
            <select
              id={`${uid}-taxBase`}
              value={tax.base}
              onChange={(e) => onChange({ tax: { ...tax, base: e.target.value as TaxBaseKind } })}
              className="w-full px-2 py-1.5 text-sm border-2 border-border bg-card"
            >
              {(Object.keys(TAX_BASE_LABELS) as TaxBaseKind[]).map((k) => (
                <option key={k} value={k}>
                  {TAX_BASE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {tax.base === "custom" && (
          <div>
            <label htmlFor={`${uid}-customBase`} className="text-[11px] text-muted-foreground block mb-0.5">自定义计税基数（元）</label>
            <input
              id={`${uid}-customBase`}
              type="number"
              min={0}
              value={num(tax.customBase ?? 0)}
              onChange={(e) =>
                onChange({ tax: { ...tax, customBase: e.target.value === "" ? 0 : Number(e.target.value) } })
              }
              className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
            />
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={tax.confirmed}
            onChange={(e) => onChange({ tax: { ...tax, confirmed: e.target.checked } })}
            className="accent-foreground"
          />
          已确认（含 0 值场景）
        </label>
      </div>

      <div className="brutal bg-card p-3 space-y-3">
        <div className="text-sm font-bold text-foreground">敏感性扫描范围（稳定期）</div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor={`${uid}-minOrders`} className="text-[11px] text-muted-foreground block mb-0.5">最低单量</label>
            <input
              id={`${uid}-minOrders`}
              type="number"
              min={0}
              value={num(sweep.minOrders)}
              onChange={(e) => onChange({ sweep: { ...sweep, minOrders: e.target.value === "" ? 0 : Number(e.target.value) } })}
              className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-maxOrders`} className="text-[11px] text-muted-foreground block mb-0.5">最高单量</label>
            <input
              id={`${uid}-maxOrders`}
              type="number"
              min={0}
              value={num(sweep.maxOrders)}
              onChange={(e) => onChange({ sweep: { ...sweep, maxOrders: e.target.value === "" ? 0 : Number(e.target.value) } })}
              className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-step`} className="text-[11px] text-muted-foreground block mb-0.5">步长</label>
            <input
              id={`${uid}-step`}
              type="number"
              min={1}
              value={num(sweep.step)}
              onChange={(e) => onChange({ sweep: { ...sweep, step: e.target.value === "" ? 1 : Number(e.target.value) } })}
              className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
            />
          </div>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        各阶段总订单量 = 自然订单 + 推广新增；获客成本 = 推广预算 ÷ 推广新增订单。{fmt(0)} 为占位。
      </div>
    </div>
  );
}
