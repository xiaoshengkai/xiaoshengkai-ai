"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  ListChecks,
  MapPin,
  Coins,
  Users,
  Package,
  ShoppingBasket,
  Percent,
  Gift,
  TrendingUp,
  LineChart,
  Bot,
} from "lucide-react";
import type { MerchantStore } from "@/lib/merchant-takeout/types";
import { getReportReadiness } from "@/lib/merchant-takeout/calculate";
import { BASE } from "@/lib/utils/utils";
import { STATUS_META, READINESS_TOTAL } from "./meta";
import { useAutoSave } from "./use-auto-save";
import LocationEditor from "./location-editor";
import LocationCostForm from "./location-cost-form";
import CostEditor from "./cost-editor";
import StaffEditor from "./staff-editor";
import ProductEditor from "./product-editor";
import BasketEditor from "./basket-editor";
import PlatformRulesEditor from "./platform-rules-editor";
import ActivityEditor from "./activity-editor";
import ScenarioEditor from "./scenario-editor";
import SimulationDashboard from "./simulation-dashboard";
import ReportView from "./report-view";

const fmtMoney = (n: number) => `¥ ${n.toLocaleString("zh-CN")}`;

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="brutal bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-black text-foreground font-mono mt-1">{fmtMoney(value)}</div>
    </div>
  );
}

export default function Workbench({ initialStore }: { initialStore: MerchantStore }) {
  const router = useRouter();
  const [store, setStore] = useState<MerchantStore>(initialStore);

  const save = async (s: MerchantStore) => {
    const res = await fetch(`${BASE}/api/tools/merchant-takeout?id=${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    if (!res.ok) throw new Error("保存失败");
  };
  const { status, saveNow, error } = useAutoSave(store, save);

  const meta = STATUS_META[store.status] || STATUS_META.simulation;
  const missing = getReportReadiness(store);
  const pct = Math.max(0, Math.round(((READINESS_TOTAL - missing.length) / READINESS_TOTAL) * 100));
  const nextStep = missing[0];

  const selectedLocation = store.locations.find((l) => l.selected) ?? null;

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
          <div className="flex items-center gap-2 shrink-0">
            {status === "saving" && (
              <span className="brutal-chip px-2 py-0.5 text-[11px] bg-blue-soft">保存中…</span>
            )}
            {status === "saved" && (
              <span className="brutal-chip px-2 py-0.5 text-[11px] bg-lime-soft">已保存</span>
            )}
            {status === "error" && (
              <button
                onClick={() => void saveNow()}
                title={error || undefined}
                className="brutal-btn px-2 py-0.5 text-[11px] bg-orange-soft text-foreground"
              >
                保存失败·点击重试
              </button>
            )}
            <button
              onClick={() => router.push("/tools/merchant-takeout")}
              className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-card text-foreground shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> 返回列表
            </button>
          </div>
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

      {/* 选址 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="w-4 h-4" />
          <span className="text-sm font-bold text-foreground">选址</span>
        </div>
        <LocationEditor
          locations={store.locations}
          onChange={(locations) => setStore((prev) => ({ ...prev, locations }))}
        />
        {selectedLocation && (
          <div className="mt-4">
            <div className="text-xs font-bold text-foreground mb-2 border-t-2 border-border pt-3">
              候选地址成本明细（{selectedLocation.name || "当前经营地址"}）
            </div>
            <LocationCostForm
              location={selectedLocation}
              onChange={(patch) =>
                setStore((prev) => ({
                  ...prev,
                  locations: prev.locations.map((l) =>
                    l.id === selectedLocation.id ? { ...l, ...patch } : l,
                  ),
                }))
              }
            />
          </div>
        )}
      </div>

      {/* 成本 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Coins className="w-4 h-4" />
          <span className="text-sm font-bold text-foreground">成本</span>
        </div>
        <CostEditor
          costs={store.costs}
          selectedLocation={selectedLocation}
          onChange={(costs) => setStore((prev) => ({ ...prev, costs }))}
        />
      </div>

      {/* 人员与用工 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4" />
          <span className="text-sm font-bold text-foreground">人员与用工</span>
        </div>
        <StaffEditor
          staffing={store.staffing}
          onChange={(staffing) => setStore((prev) => ({ ...prev, staffing }))}
        />
      </div>

      {/* 商品与套餐 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-4 h-4" />
          <span className="text-sm font-bold text-foreground">商品与套餐</span>
        </div>
        <ProductEditor
          products={store.products}
          onChange={(products) => setStore((prev) => ({ ...prev, products }))}
        />
      </div>

      {/* 典型购物篮 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShoppingBasket className="w-4 h-4" />
          <span className="text-sm font-bold text-foreground">典型购物篮</span>
        </div>
        <BasketEditor
          baskets={store.baskets}
          products={store.products}
          onChange={(baskets) => setStore((prev) => ({ ...prev, baskets }))}
        />
      </div>

      {/* 淘宝闪购规则 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Percent className="w-4 h-4" />
          <span className="text-sm font-bold text-foreground">淘宝闪购规则</span>
        </div>
        <PlatformRulesEditor
          rules={store.platformRules}
          onChange={(platformRules) => setStore((prev) => ({ ...prev, platformRules }))}
          city={store.profile.city}
        />
      </div>

      {/* 活动方案 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Gift className="w-4 h-4" />
          <span className="text-sm font-bold text-foreground">活动方案</span>
        </div>
        <ActivityEditor
          activities={store.activities}
          onChange={(activities) => setStore((prev) => ({ ...prev, activities }))}
        />
      </div>

      {/* 销量与推广 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4" />
          <span className="text-sm font-bold text-foreground">销量与推广</span>
        </div>
        <ScenarioEditor
          sales={store.sales}
          loss={store.loss}
          tax={store.tax}
          sweep={store.sweep}
          activities={store.activities}
          onChange={(patch) => setStore((prev) => ({ ...prev, ...patch }))}
        />
      </div>

      {/* 经营沙盘 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <LineChart className="w-4 h-4" />
          <span className="text-sm font-bold text-foreground">经营沙盘</span>
        </div>
        <SimulationDashboard store={store} />
      </div>

      {/* AI 经营报告 */}
      <div className="brutal bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Bot className="w-4 h-4" />
          <span className="text-sm font-bold text-foreground">AI 经营报告</span>
        </div>
        <ReportView store={store} />
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
