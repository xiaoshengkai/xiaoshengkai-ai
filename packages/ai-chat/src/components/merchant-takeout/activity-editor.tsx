"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { StoreActivities, StoreActivity } from "@/lib/merchant-takeout/types";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const fmt = (n: number) =>
  `¥ ${(Number.isFinite(n) ? n : 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;

const TYPE_LABELS: Record<StoreActivity["type"], string> = {
  discount: "折扣",
  fullReduction: "满减",
  redPacket: "红包",
};

function newActivity(type: StoreActivity["type"], id = uid()): StoreActivity {
  if (type === "discount") return { id, type, rate: 0.9, merchantShare: 1 };
  if (type === "fullReduction") return { id, type, threshold: 0, reduction: 0, merchantShare: 1 };
  return { id, type, amount: 0, merchantShare: 1 };
}

/** 每行的效果速览 */
function glance(a: StoreActivity): string {
  if (a.type === "discount") return `折后 ${(a.rate * 100).toFixed(0)}%`;
  if (a.type === "fullReduction") return `满 ${fmt(a.threshold)} 减 ${fmt(a.reduction)}`;
  return `${fmt(a.amount)} 红包`;
}

interface ActivityEditorProps {
  activities: StoreActivities;
  onChange: (activities: StoreActivities) => void;
}

export default function ActivityEditor({ activities, onChange }: ActivityEditorProps) {
  const emit = (list: StoreActivity[]) => onChange({ list, stackOrder: list.map((a) => a.id) });
  const patch = (id: string, p: Partial<StoreActivity>) =>
    emit(activities.list.map((a) => (a.id === id ? ({ ...a, ...p } as StoreActivity) : a)));
  const add = () => emit([...activities.list, newActivity("discount")]);
  const remove = (id: string) => emit(activities.list.filter((a) => a.id !== id));
  const move = (index: number, dir: -1 | 1) => {
    const next = [...activities.list];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    emit(next);
  };
  const setType = (id: string, type: StoreActivity["type"]) =>
    emit(activities.list.map((a) => (a.id === id ? newActivity(type, a.id) : a)));

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        列表顺序即叠加顺序（上方先应用）；商家承担比例默认 100%
      </div>

      {activities.list.length === 0 ? (
        <div className="brutal bg-card p-3 text-xs text-muted-foreground">
          还没有活动。点击「添加活动」配置折扣 / 满减 / 红包。
        </div>
      ) : (
        <ul className="space-y-2">
          {activities.list.map((a, i) => (
            <li key={a.id} className="brutal bg-card p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground font-mono shrink-0">#{i + 1}</span>
                <select
                  value={a.type}
                  onChange={(e) => setType(a.id, e.target.value as StoreActivity["type"])}
                  className="px-2 py-1.5 text-sm border-2 border-border bg-card"
                >
                  {(Object.keys(TYPE_LABELS) as StoreActivity["type"][]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground flex-1">{glance(a)}</span>
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="brutal-btn p-1.5 text-muted-foreground disabled:opacity-30"
                  title="上移（先应用）"
                  aria-label="上移"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === activities.list.length - 1}
                  className="brutal-btn p-1.5 text-muted-foreground disabled:opacity-30"
                  title="下移（后应用）"
                  aria-label="下移"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => remove(a.id)}
                  className="brutal-btn p-1.5 text-muted-foreground"
                  aria-label="删除活动"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {a.type === "discount" && (
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-0.5">折扣率（%，90=打9折）</label>
                    <input
                      type="number"
                      min={0}
                      value={Number.isFinite(a.rate) ? a.rate * 100 : 0}
                      onChange={(e) => patch(a.id, { rate: (e.target.value === "" ? 0 : Number(e.target.value)) / 100 })}
                      className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
                    />
                  </div>
                )}
                {a.type === "fullReduction" && (
                  <>
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-0.5">门槛（元）</label>
                      <input
                        type="number"
                        min={0}
                        value={Number.isFinite(a.threshold) ? a.threshold : 0}
                        onChange={(e) => patch(a.id, { threshold: e.target.value === "" ? 0 : Number(e.target.value) })}
                        className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-0.5">减免（元）</label>
                      <input
                        type="number"
                        min={0}
                        value={Number.isFinite(a.reduction) ? a.reduction : 0}
                        onChange={(e) => patch(a.id, { reduction: e.target.value === "" ? 0 : Number(e.target.value) })}
                        className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
                      />
                    </div>
                  </>
                )}
                {a.type === "redPacket" && (
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-0.5">红包金额（元）</label>
                    <input
                      type="number"
                      min={0}
                      value={Number.isFinite(a.amount) ? a.amount : 0}
                      onChange={(e) => patch(a.id, { amount: e.target.value === "" ? 0 : Number(e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-0.5">商家承担（%）</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={Number.isFinite(a.merchantShare) ? a.merchantShare * 100 : 100}
                    onChange={(e) => patch(a.id, { merchantShare: (e.target.value === "" ? 0 : Number(e.target.value)) / 100 })}
                    className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={add}
        className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue text-white"
      >
        <Plus className="w-3.5 h-3.5" /> 添加活动
      </button>
    </div>
  );
}
