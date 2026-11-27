"use client";

import { useRouter } from "next/navigation";

// 占位页：真实店铺列表 UI 在 Task 3 落地，这里只保留头部 + 空态。
export default function MerchantTakeoutPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
        <div>
          <h2 className="text-lg font-bold text-foreground font-heading">外卖开店模拟器</h2>
          <p className="text-xs text-muted-foreground">从品类、选址到平台规则的 AI 外卖店数字沙盘</p>
        </div>
        <button
          onClick={() => router.push("/tools")}
          className="brutal-btn px-3 py-1.5 text-xs font-bold bg-card text-foreground"
        >
          返回
        </button>
      </div>

      {/* 空态 */}
      <div className="flex-1 overflow-auto p-4">
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
          <span className="text-4xl">🏪</span>
          <p className="text-sm">还没有店铺</p>
        </div>
      </div>
    </div>
  );
}
