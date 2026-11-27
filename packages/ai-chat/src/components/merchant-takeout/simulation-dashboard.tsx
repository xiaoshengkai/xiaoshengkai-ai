"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { MerchantStore } from "@/lib/merchant-takeout/types";
import {
  calculateSimulation,
  calculateMonth,
  buildPhases,
  getReportReadiness,
} from "@/lib/merchant-takeout/calculate";

const fmt = (n: number) => `${(Number.isFinite(n) ? n : 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
const fmtSigned = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n)}`;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="brutal bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-black text-foreground font-mono mt-1">{value}</div>
    </div>
  );
}

export default function SimulationDashboard({ store }: { store: MerchantStore }) {
  const ready = getReportReadiness(store).length === 0;
  const computable = store.baskets.length > 0 && store.products.length > 0;

  const sim = useMemo(
    () => (computable ? calculateSimulation(store, buildPhases(store)) : null),
    [store, computable],
  );

  const stable = store.sales.find((p) => p.monthIndex === 4);

  const sweepRows = useMemo(() => {
    if (!computable || !stable) return [];
    const { minOrders, maxOrders, step } = store.sweep;
    if (!(step > 0) || maxOrders < minOrders) return [];
    const rows: { totalOrders: number; netProfit: number; breakevenOrders: number | null; crossed: boolean }[] = [];
    let prevSign: number | null = null;
    for (let total = minOrders; total <= maxOrders + 1e-9; total += step) {
      const result = calculateMonth(store, {
        naturalOrders: Math.max(0, total - (stable.promotionOrders || 0)),
        promotionOrders: stable.promotionOrders || 0,
        promotionBudget: stable.promotionBudget || 0,
        activities: stable.activities ?? store.activities,
      });
      const sign = result.netProfit >= 0 ? 1 : -1;
      const crossed = prevSign !== null && sign !== prevSign;
      prevSign = sign;
      rows.push({ totalOrders: total, netProfit: result.netProfit, breakevenOrders: result.breakevenOrders, crossed });
    }
    return rows;
  }, [store, computable, stable]);

  if (!computable) {
    return (
      <div className="brutal bg-card p-4 text-sm text-muted-foreground">
        完善商品与购物篮后显示经营沙盘
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!ready && (
        <div className="brutal bg-yellow-soft p-3 flex items-start gap-2 text-xs text-foreground">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          资料未完整，经营沙盘为初步预览
        </div>
      )}

      {sim && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="一次性投入" value={`¥ ${fmt(sim.totalOneTimeCosts)}`} />
            <Metric label="启动资金" value={`¥ ${fmt(sim.startingCash)}`} />
            <Metric label="现金流最低点" value={`¥ ${fmt(sim.minCash)}`} />
            <Metric label="回本周期" value={sim.paybackMonths === null ? "未回本" : `第 ${sim.paybackMonths} 月`} />
          </div>

          <div className="brutal bg-card p-3 overflow-x-auto">
            <div className="text-sm font-bold text-foreground mb-2">各阶段推演</div>
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="py-1 pr-3 font-normal">阶段</th>
                  <th className="py-1 pr-3 font-normal text-right">订单量</th>
                  <th className="py-1 pr-3 font-normal text-right">单均贡献</th>
                  <th className="py-1 pr-3 font-normal text-right">月贡献</th>
                  <th className="py-1 pr-3 font-normal text-right">订单损失</th>
                  <th className="py-1 pr-3 font-normal text-right">人工</th>
                  <th className="py-1 pr-3 font-normal text-right">税前利润</th>
                  <th className="py-1 pr-3 font-normal text-right">税费</th>
                  <th className="py-1 pr-3 font-normal text-right">净利润</th>
                  <th className="py-1 pr-3 font-normal text-right">现金余额</th>
                  <th className="py-1 pr-3 font-normal text-right">保本单量</th>
                </tr>
              </thead>
              <tbody>
                {sim.months.map((m, i) => {
                  const r = m.result;
                  return (
                    <tr key={m.monthIndex} className="border-t border-border">
                      <td className="py-1 pr-3 text-foreground">{m.label}</td>
                      <td className="py-1 pr-3 text-right">{fmt(r.totalOrders)}</td>
                      <td className="py-1 pr-3 text-right">{fmt(r.avgContribution)}</td>
                      <td className="py-1 pr-3 text-right">{fmtSigned(r.monthContribution)}</td>
                      <td className="py-1 pr-3 text-right">{fmt(r.orderLossCost)}</td>
                      <td className="py-1 pr-3 text-right">{fmt(r.laborCost)}</td>
                      <td className="py-1 pr-3 text-right">{fmtSigned(r.preTaxProfit)}</td>
                      <td className="py-1 pr-3 text-right">{fmt(r.tax)}</td>
                      <td className="py-1 pr-3 text-right font-bold">{fmtSigned(r.netProfit)}</td>
                      <td className="py-1 pr-3 text-right">{fmt(sim.cumulativeCash[i])}</td>
                      <td className="py-1 pr-3 text-right">{r.breakevenOrders === null ? "—" : fmt(r.breakevenOrders)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {sweepRows.length > 0 && (
        <details className="brutal bg-card p-3">
          <summary className="cursor-pointer text-sm font-bold text-foreground">
            稳定期敏感性扫描（{fmt(store.sweep.minOrders)} ~ {fmt(store.sweep.maxOrders)} 单）
          </summary>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="py-1 pr-3 font-normal text-right">总订单量</th>
                  <th className="py-1 pr-3 font-normal text-right">净利润</th>
                  <th className="py-1 pr-3 font-normal text-right">保本单量</th>
                </tr>
              </thead>
              <tbody>
                {sweepRows.map((row) => (
                  <tr
                    key={row.totalOrders}
                    className={`border-t border-border ${row.crossed ? "bg-lime-soft" : ""}`}
                  >
                    <td className="py-1 pr-3 text-right">{fmt(row.totalOrders)}</td>
                    <td className="py-1 pr-3 text-right font-bold">{fmtSigned(row.netProfit)}</td>
                    <td className="py-1 pr-3 text-right">
                      {row.breakevenOrders === null ? "—" : fmt(row.breakevenOrders)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
