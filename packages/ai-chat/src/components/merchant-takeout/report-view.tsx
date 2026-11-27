"use client";

import { useMemo, useState } from "react";
import { FileText, Loader2, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { AiReport, MerchantStore } from "@/lib/merchant-takeout/types";
import { calculateSimulation, buildPhases, getReportReadiness } from "@/lib/merchant-takeout/calculate";
import { BASE } from "@/lib/utils/utils";

const fmt = (n: number) =>
  `${(Number.isFinite(n) ? n : 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;

const FEASIBILITY_META: Record<AiReport["feasibility"], { label: string; accent: string }> = {
  较可行: { label: "较可行", accent: "bg-lime-soft" },
  谨慎考虑: { label: "谨慎考虑", accent: "bg-yellow-soft" },
  风险较高: { label: "风险较高", accent: "bg-orange-soft" },
  信息不足: { label: "信息不足", accent: "bg-muted" },
};

type Resp =
  | { ready: false; missing: string[] }
  | { ready: true; report: AiReport | null; error?: string };

function CompactMetrics({ store }: { store: MerchantStore }) {
  const computable = store.baskets.length > 0 && store.products.length > 0;
  const sim = useMemo(
    () => (computable ? calculateSimulation(store, buildPhases(store)) : null),
    [store, computable],
  );
  if (!sim) {
    return <div className="text-xs text-muted-foreground">完善商品与购物篮后可查看经营指标</div>;
  }
  const stable = sim.months[sim.months.length - 1]?.result;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      <div className="brutal bg-card p-2">
        <div className="text-[11px] text-muted-foreground">启动投入</div>
        <div className="text-sm font-black font-mono">¥ {fmt(sim.totalOneTimeCosts)}</div>
      </div>
      <div className="brutal bg-card p-2">
        <div className="text-[11px] text-muted-foreground">保本单量</div>
        <div className="text-sm font-black font-mono">
          {stable?.breakevenOrders === null || stable?.breakevenOrders === undefined
            ? "—"
            : fmt(stable.breakevenOrders)}
        </div>
      </div>
      <div className="brutal bg-card p-2">
        <div className="text-[11px] text-muted-foreground">基准月净利润</div>
        <div className="text-sm font-black font-mono">
          {stable ? `${stable.netProfit >= 0 ? "+" : ""}¥ ${fmt(stable.netProfit)}` : "—"}
        </div>
      </div>
      <div className="brutal bg-card p-2">
        <div className="text-[11px] text-muted-foreground">现金最低点</div>
        <div className="text-sm font-black font-mono">¥ {fmt(sim.minCash)}</div>
      </div>
      <div className="brutal bg-card p-2">
        <div className="text-[11px] text-muted-foreground">回本周期</div>
        <div className="text-sm font-black font-mono">
          {sim.paybackMonths === null ? "未回本" : `第 ${sim.paybackMonths} 月`}
        </div>
      </div>
    </div>
  );
}

export default function ReportView({ store }: { store: MerchantStore }) {
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<Resp | null>(null);
  const readyNow = getReportReadiness(store).length === 0;

  const generate = async () => {
    setLoading(true);
    setResp(null);
    try {
      const res = await fetch(`${BASE}/api/tools/merchant-takeout/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResp({ ready: false, missing: [data?.error || "请求失败"] });
      } else if (data.ready === false) {
        setResp({ ready: false, missing: data.missing ?? [] });
      } else {
        setResp({ ready: true, report: data.report ?? null, error: data.error });
      }
    } catch {
      setResp({ ready: false, missing: ["网络请求失败，请重试"] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 确定性指标先行 */}
      <CompactMetrics store={store} />

      <div className="flex items-center gap-2">
        <button
          onClick={() => void generate()}
          disabled={loading}
          className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-foreground text-background disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          {loading ? "生成中…" : "生成经营报告"}
        </button>
      </div>

      {resp && resp.ready === false && (
        <div className="brutal bg-yellow-soft p-3">
          <div className="flex items-start gap-2 text-xs text-foreground">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold mb-1">还缺以下资料，暂不能生成报告</div>
              <ul className="space-y-1">
                {resp.missing.map((m) => (
                  <li key={m}>· {m}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {resp && resp.ready === true && resp.report === null && (
        <div className="brutal bg-muted p-3 text-xs text-foreground">
          AI 分析暂时不可用，请查看下方经营指标。
        </div>
      )}

      {resp && resp.ready === true && resp.report && (
        <ReportCard report={resp.report} />
      )}

      <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="w-3 h-3 shrink-0 mt-0.5" />
        <span>以上 AI 结论基于你填写的经营数据与确定性测算，不构成开店成功率的概率预测。</span>
      </div>
    </div>
  );
}

function ReportCard({ report }: { report: AiReport }) {
  const meta = FEASIBILITY_META[report.feasibility];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">可行性结论</span>
        <span className={`brutal-chip px-2 py-0.5 text-xs font-bold ${meta.accent}`}>{meta.label}</span>
      </div>
      <div className="brutal bg-card p-3 text-sm text-foreground leading-relaxed">{report.summary}</div>

      {report.conditions.length > 0 && (
        <div className="brutal bg-card p-3">
          <div className="text-sm font-bold text-foreground mb-2 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-lime" /> 关键成立条件
          </div>
          <ul className="space-y-1.5 text-xs text-foreground">
            {report.conditions.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.risks.length > 0 && (
        <div className="brutal bg-card p-3">
          <div className="text-sm font-bold text-foreground mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-orange" /> 风险
          </div>
          <div className="space-y-3">
            {report.risks.map((r, i) => (
              <div key={i} className="border-l-2 border-orange pl-3">
                <div className="text-sm font-bold text-foreground">{r.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">依据：{r.evidence}</div>
                <div className="text-xs text-foreground mt-0.5">影响：{r.impact}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.recommendations.length > 0 && (
        <div className="brutal bg-card p-3">
          <div className="text-sm font-bold text-foreground mb-2 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-blue" /> 调整建议
          </div>
          <div className="space-y-3">
            {report.recommendations.map((r, i) => (
              <div key={i} className="border-l-2 border-blue pl-3">
                <div className="text-sm font-bold text-foreground">{r.action}</div>
                <div className="text-xs text-muted-foreground mt-0.5">依据：{r.evidence}</div>
                <div className="text-xs text-foreground mt-0.5">预期影响：{r.expectedImpact}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
