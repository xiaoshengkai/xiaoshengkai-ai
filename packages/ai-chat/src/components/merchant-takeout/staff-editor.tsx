"use client";

import { Plus, Trash2 } from "lucide-react";
import type { StaffMember, StaffingTier, StoreStaffing } from "@/lib/merchant-takeout/types";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const fmt = (n: number) =>
  `¥ ${(Number.isFinite(n) ? n : 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;

const staffCostTotal = (members: StaffMember[]) =>
  members.reduce((s, m) => s + (m.count || 0) * (m.monthlySalary || 0), 0);

const emptyMember = (): StaffMember => ({ role: "", count: 1, monthlySalary: 0 });

function MemberRow({
  member,
  onChange,
  onRemove,
}: {
  member: StaffMember;
  onChange: (m: StaffMember) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_64px_96px_28px] gap-2 items-end">
      <input
        type="text"
        value={member.role}
        onChange={(e) => onChange({ ...member, role: e.target.value })}
        placeholder="岗位（如：老板/厨师/店员）"
        className="w-full px-2 py-1.5 text-sm border-2 border-border bg-card"
      />
      <input
        type="number"
        min={0}
        value={member.count}
        onChange={(e) => onChange({ ...member, count: e.target.value === "" ? 0 : Number(e.target.value) })}
        placeholder="人数"
        className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
      />
      <input
        type="number"
        min={0}
        value={member.monthlySalary}
        onChange={(e) => onChange({ ...member, monthlySalary: e.target.value === "" ? 0 : Number(e.target.value) })}
        placeholder="月薪/人"
        className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
      />
      <button onClick={onRemove} className="brutal-btn p-1.5 text-muted-foreground">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface StaffEditorProps {
  staffing: StoreStaffing;
  onChange: (staffing: StoreStaffing) => void;
}

export default function StaffEditor({ staffing, onChange }: StaffEditorProps) {
  const base = staffing.base;
  const tiers = staffing.tiers;

  const setBase = (members: StaffMember[]) => onChange({ ...staffing, base: members });
  const setTiers = (next: StaffingTier[]) => onChange({ ...staffing, tiers: next });

  const baseCost = staffCostTotal(base);

  const patchMember = (list: StaffMember[], idx: number, m: StaffMember) =>
    list.map((x, i) => (i === idx ? m : x));

  const addTier = () => {
    const next = [...tiers, { minMonthlyOrders: 0, members: [] } as StaffingTier].sort(
      (a, b) => a.minMonthlyOrders - b.minMonthlyOrders,
    );
    setTiers(next);
  };

  return (
    <div className="space-y-4">
      {/* 基础人员 */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <span className="text-xs font-bold text-foreground">基础人员（无论销量都需要）</span>
          <span className="text-xs font-mono font-bold">月成本 {fmt(baseCost)}</span>
        </div>
        <div className="text-[11px] text-muted-foreground mb-2">
          老板本人参与经营时，应作为一条人员记录填写合理工资
        </div>
        <div className="space-y-2">
          {base.map((m, i) => (
            <MemberRow
              key={i}
              member={m}
              onChange={(v) => setBase(patchMember(base, i, v))}
              onRemove={() => setBase(base.filter((_, j) => j !== i))}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setBase([...base, emptyMember()])}
          className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-card text-foreground mt-2"
        >
          <Plus className="w-3.5 h-3.5" /> 添加人员
        </button>
      </div>

      {/* 阶梯增员 */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <span className="text-xs font-bold text-foreground">阶梯增员（按月订单量触发）</span>
          <button
            type="button"
            onClick={addTier}
            className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-card text-foreground"
          >
            <Plus className="w-3.5 h-3.5" /> 添加档位
          </button>
        </div>
        <div className="text-[11px] text-muted-foreground mb-2">
          每个档位的「人员」是累计新增人员（基础 + 到此档新增的全部），非单档增量
        </div>

        {tiers.length === 0 ? (
          <div className="brutal bg-card p-3 text-xs text-muted-foreground">
            暂无增员档位。销量超过基础人员负荷时再添加。
          </div>
        ) : (
          <ul className="space-y-2">
            {tiers.map((tier, ti) => {
              const memberCount = tier.members.reduce((s, m) => s + (m.count || 0), 0);
              const tierCost = baseCost + staffCostTotal(tier.members);
              return (
                <li key={ti} className="brutal bg-card p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground">触发月订单量 ≥</label>
                      <input
                        type="number"
                        min={0}
                        value={tier.minMonthlyOrders}
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                          const next = tiers
                            .map((t, i) => (i === ti ? { ...t, minMonthlyOrders: v } : t))
                            .sort((a, b) => a.minMonthlyOrders - b.minMonthlyOrders);
                          setTiers(next);
                        }}
                        className="w-24 px-2 py-1 text-sm font-mono border-2 border-border bg-card"
                      />
                      <span className="text-xs text-muted-foreground">单</span>
                    </div>
                    <button
                      onClick={() => setTiers(tiers.filter((_, j) => j !== ti))}
                      className="brutal-btn p-1.5 text-muted-foreground"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {tier.members.map((m, mi) => (
                      <MemberRow
                        key={mi}
                        member={m}
                        onChange={(v) => {
                          const next = tiers.map((t, i) =>
                            i === ti ? { ...t, members: patchMember(t.members, mi, v) } : t,
                          );
                          setTiers(next);
                        }}
                        onRemove={() => {
                          const next = tiers.map((t, i) =>
                            i === ti ? { ...t, members: t.members.filter((_, j) => j !== mi) } : t,
                          );
                          setTiers(next);
                        }}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        const next = tiers.map((t, i) =>
                          i === ti ? { ...t, members: [...t.members, emptyMember()] } : t,
                        );
                        setTiers(next);
                      }}
                      className="brutal-btn inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-bold bg-muted/40 text-foreground"
                    >
                      <Plus className="w-3 h-3" /> 添加人员
                    </button>
                  </div>

                  <div className="text-xs font-mono space-y-0.5 border-t-2 border-border pt-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">此档累计新增人数</span>
                      <span>{memberCount} 人</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">此档总人工成本</span>
                      <span>{fmt(tierCost)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
