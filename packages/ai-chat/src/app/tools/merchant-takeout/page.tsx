"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BASE } from "@/lib/utils/utils";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { MerchantStore } from "@/lib/merchant-takeout/types";
import StoreList from "@/components/merchant-takeout/store-list";
import StoreSetup from "@/components/merchant-takeout/store-setup";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function MerchantTakeoutPage() {
  const router = useRouter();
  const [stores, setStores] = useState<MerchantStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchStores = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/tools/merchant-takeout`);
      const data = await res.json();
      if (res.ok && data.ok) setStores(data.stores || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  const handleDelete = useCallback(async () => {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    try {
      const res = await fetch(`${BASE}/api/tools/merchant-takeout?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        toast("🟢 已删除");
        fetchStores();
      } else {
        toast("🔴 删除失败");
      }
    } catch {
      toast("🔴 请求失败");
    }
  }, [deleteId, fetchStores]);

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
        <div>
          <h2 className="text-lg font-bold text-foreground font-heading">外卖开店模拟器</h2>
          <p className="text-xs text-muted-foreground">从品类、选址到平台规则的 AI 外卖店数字沙盘</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/tools")}
            className="brutal-btn px-3 py-1.5 text-xs font-bold bg-card text-foreground"
          >
            返回
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-primary text-primary-foreground"
          >
            <Plus className="w-3.5 h-3.5" /> 创建模拟店铺
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-3xl">🏪</span>
            <p className="text-sm">加载中…</p>
          </div>
        ) : (
          <StoreList
            stores={stores}
            onOpen={(id) => router.push(`/tools/merchant-takeout/${id}`)}
            onDelete={setDeleteId}
          />
        )}
      </div>

      <StoreSetup open={createOpen} onClose={() => setCreateOpen(false)} />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="删除店铺"
        description="删除后该店铺的所有模拟数据将一并清除，且不可恢复。确定删除？"
        onConfirm={handleDelete}
      />
    </div>
  );
}
