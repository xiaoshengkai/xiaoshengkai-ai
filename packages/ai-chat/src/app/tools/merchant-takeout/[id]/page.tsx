"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BASE } from "@/lib/utils/utils";
import type { MerchantStore } from "@/lib/merchant-takeout/types";
import Workbench from "@/components/merchant-takeout/workbench";

export default function StorePage() {
  const { id } = useParams<{ id: string }>();
  const [store, setStore] = useState<MerchantStore | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStore(null);
    setNotFound(false);
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/tools/merchant-takeout?id=${id}`);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.ok) setStore(data.store);
        else setNotFound(true);
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        {notFound ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-4xl">🔍</span>
            <p className="text-sm">店铺不存在或已被删除</p>
          </div>
        ) : store ? (
          <Workbench store={store} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-3xl">🏪</span>
            <p className="text-sm">加载中…</p>
          </div>
        )}
      </div>
    </div>
  );
}
