"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Competitor } from "@/lib/merchant-takeout/types";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const emptyCompetitor = (): Competitor => ({
  id: uid(),
  name: "",
  distance: 0,
  category: "",
  monthlyOrders: 0,
  avgTicket: 0,
  rating: 0,
  activities: "",
  hours: "",
  note: "",
});

function NumInput({
  id,
  value,
  onChange,
  step,
  min,
  max,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <input
      id={id}
      type="number"
      min={min ?? 0}
      max={max}
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      placeholder="0"
      className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
    />
  );
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2 py-1.5 text-sm border-2 border-border bg-card"
    />
  );
}

interface CompetitorEditorProps {
  competitors: Competitor[];
  onChange: (competitors: Competitor[]) => void;
}

export default function CompetitorEditor({ competitors, onChange }: CompetitorEditorProps) {
  const patch = (id: string, p: Partial<Competitor>) =>
    onChange(competitors.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = () => onChange([...competitors, emptyCompetitor()]);
  const remove = (id: string) => onChange(competitors.filter((x) => x.id !== id));

  return (
    <div className="space-y-2">
      {competitors.length === 0 ? (
        <div className="brutal bg-card p-3 text-xs text-muted-foreground">
          还没有结构化竞店。点击「添加竞店」录入月售、客单价、评分等指标。
        </div>
      ) : (
        <ul className="space-y-2">
          {competitors.map((c) => (
            <li key={c.id} className="brutal bg-card p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={c.name}
                  onChange={(e) => patch(c.id, { name: e.target.value })}
                  placeholder="竞店名称"
                  aria-label="竞店名称"
                  className="flex-1 px-2 py-1.5 text-sm font-bold border-2 border-border bg-card"
                />
                <button onClick={() => remove(c.id)} className="brutal-btn p-1.5 text-muted-foreground" aria-label="删除竞店">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div>
                  <label htmlFor={`cpt-dist-${c.id}`} className="text-[11px] text-muted-foreground block mb-0.5">距离（km）</label>
                  <NumInput id={`cpt-dist-${c.id}`} value={c.distance} onChange={(v) => patch(c.id, { distance: v })} step={0.1} />
                </div>
                <div>
                  <label htmlFor={`cpt-cat-${c.id}`} className="text-[11px] text-muted-foreground block mb-0.5">品类</label>
                  <TextInput id={`cpt-cat-${c.id}`} value={c.category} onChange={(v) => patch(c.id, { category: v })} placeholder="如：炸鸡" />
                </div>
                <div>
                  <label htmlFor={`cpt-orders-${c.id}`} className="text-[11px] text-muted-foreground block mb-0.5">月售（单）</label>
                  <NumInput id={`cpt-orders-${c.id}`} value={c.monthlyOrders} onChange={(v) => patch(c.id, { monthlyOrders: v })} />
                </div>
                <div>
                  <label htmlFor={`cpt-ticket-${c.id}`} className="text-[11px] text-muted-foreground block mb-0.5">客单价（元）</label>
                  <NumInput id={`cpt-ticket-${c.id}`} value={c.avgTicket} onChange={(v) => patch(c.id, { avgTicket: v })} step={0.5} />
                </div>
                <div>
                  <label htmlFor={`cpt-rating-${c.id}`} className="text-[11px] text-muted-foreground block mb-0.5">评分（0~5）</label>
                  <NumInput
                    id={`cpt-rating-${c.id}`}
                    value={c.rating}
                    onChange={(v) => patch(c.id, { rating: Math.min(5, Math.max(0, v)) })}
                    step={0.1}
                    min={0}
                    max={5}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label htmlFor={`cpt-act-${c.id}`} className="text-[11px] text-muted-foreground block mb-0.5">活动说明</label>
                  <TextInput id={`cpt-act-${c.id}`} value={c.activities} onChange={(v) => patch(c.id, { activities: v })} placeholder="如：满减频繁" />
                </div>
                <div>
                  <label htmlFor={`cpt-hours-${c.id}`} className="text-[11px] text-muted-foreground block mb-0.5">营业时间</label>
                  <TextInput id={`cpt-hours-${c.id}`} value={c.hours} onChange={(v) => patch(c.id, { hours: v })} placeholder="如：10:00-22:00" />
                </div>
                <div>
                  <label htmlFor={`cpt-note-${c.id}`} className="text-[11px] text-muted-foreground block mb-0.5">备注</label>
                  <TextInput id={`cpt-note-${c.id}`} value={c.note} onChange={(v) => patch(c.id, { note: v })} />
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
        <Plus className="w-3.5 h-3.5" /> 添加竞店
      </button>
    </div>
  );
}
