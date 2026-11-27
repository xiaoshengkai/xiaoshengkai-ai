"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Copy, Trash2, Loader2 } from "lucide-react";
import type { MerchantStore, StoreScenario, StoreSnapshot } from "@/lib/merchant-takeout/types";
import { calculateSimulation, buildPhases } from "@/lib/merchant-takeout/calculate";
import { BASE } from "@/lib/utils/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleString("zh-CN", { hour12: false });

export default function SnapshotPanel({ store }: { store: MerchantStore }) {
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<StoreSnapshot[]>([]);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StoreSnapshot | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/tools/merchant-takeout/snapshots?storeId=${store.id}`);
      const data = await res.json();
      if (data.ok) setSnapshots(data.snapshots ?? []);
    } catch {
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  const saveSnapshot = async () => {
    setSaving(true);
    try {
      const phases = buildPhases(store);
      const sim = calculateSimulation(store, phases);
      const scenarios: StoreScenario[] = sim.months.map((m, i) => ({
        id: crypto.randomUUID(),
        label: m.label,
        monthIndex: m.monthIndex,
        naturalOrders: phases[i].naturalOrders,
        promotionOrders: phases[i].promotionOrders,
        totalOrders: m.result.totalOrders,
        avgContributionProfit: m.result.avgContribution,
        monthlyNetProfit: m.result.netProfit,
        breakevenOrders: m.result.breakevenOrders ?? 0,
        tax: m.result.tax,
      }));
      const res = await fetch(`${BASE}/api/tools/merchant-takeout/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.id, label, input: store, scenarios }),
      });
      if (res.ok) {
        setLabel("");
        await refresh();
      }
    } finally {
      setSaving(false);
    }
  };

  const copySnapshot = async (s: StoreSnapshot) => {
    const res = await fetch(`${BASE}/api/tools/merchant-takeout/snapshots?copy=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, name: `${s.label} (复制)` }),
    });
    const data = await res.json();
    if (data.ok && data.store) router.push(`/tools/merchant-takeout/${data.store.id}`);
  };

  const doDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await fetch(`${BASE}/api/tools/merchant-takeout/snapshots?id=${pendingDelete.id}`, {
        method: "DELETE",
      });
      setPendingDelete(null);
      await refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="快照名称（可选）"
          className="flex-1 px-3 py-1.5 text-sm border-2 border-border bg-card"
        />
        <button
          onClick={() => void saveSnapshot()}
          disabled={saving}
          className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-foreground text-background disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          保存当前方案为快照
        </button>
      </div>

      {loading && <div className="text-xs text-muted-foreground">加载中…</div>}

      {!loading && snapshots.length === 0 && (
        <div className="text-xs text-muted-foreground">还没有保存的方案快照</div>
      )}

      {snapshots.map((s) => (
        <div key={s.id} className="brutal bg-card p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-foreground truncate">{s.label}</div>
            <div className="text-[11px] text-muted-foreground font-mono">{fmtDate(s.createdAt)}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void copySnapshot(s)}
              className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-blue text-white"
            >
              <Copy className="w-3.5 h-3.5" /> 复制为新方案
            </button>
            <button
              onClick={() => setPendingDelete(s)}
              className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-card text-foreground"
            >
              <Trash2 className="w-3.5 h-3.5" /> 删除
            </button>
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除方案快照"
        description={`确认删除「${pendingDelete?.label ?? ""}」？此操作不可撤销。`}
        confirmLabel="删除"
        loading={deleting}
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}
