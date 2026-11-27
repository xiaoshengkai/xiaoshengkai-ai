"use client";

import { Plus, Trash2 } from "lucide-react";
import type { StoreProduct } from "@/lib/merchant-takeout/types";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const fmt = (n: number) =>
  `¥ ${(Number.isFinite(n) ? n : 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;

const emptyProduct = (): StoreProduct => ({
  id: uid(),
  name: "",
  price: 0,
  ingredientCost: 0,
  lossRate: 0,
  packagingCost: 0,
  packagingFee: 0,
});

function NumInput({
  id,
  value,
  onChange,
  className,
  placeholder,
  step,
}: {
  id?: string;
  value: number;
  onChange: (v: number) => void;
  className?: string;
  placeholder?: string;
  step?: number;
}) {
  return (
    <input
      id={id}
      type="number"
      min={0}
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      placeholder={placeholder || "0"}
      className={`w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card ${className || ""}`}
    />
  );
}

interface ProductEditorProps {
  products: StoreProduct[];
  onChange: (products: StoreProduct[]) => void;
}

export default function ProductEditor({ products, onChange }: ProductEditorProps) {
  const patch = (id: string, p: Partial<StoreProduct>) =>
    onChange(products.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = () => onChange([...products, emptyProduct()]);
  const remove = (id: string) => onChange(products.filter((x) => x.id !== id));

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        套餐与单品同模型，直接填单份食材总成本，不做原料配方
      </div>

      {products.length === 0 ? (
        <div className="brutal bg-card p-3 text-xs text-muted-foreground">
          还没有商品。点击「添加商品」录入售价与成本。
        </div>
      ) : (
        <ul className="space-y-2">
          {products.map((p) => (
            <li key={p.id} className="brutal bg-card p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => patch(p.id, { name: e.target.value })}
                  placeholder="名称（如：招牌鸡腿饭 / 双人套餐）"
                  aria-label="商品名称"
                  className="flex-1 px-2 py-1.5 text-sm font-bold border-2 border-border bg-card"
                />
                <button onClick={() => remove(p.id)} className="brutal-btn p-1.5 text-muted-foreground" aria-label="删除商品">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div>
                  <label htmlFor={`product-price-${p.id}`} className="text-[11px] text-muted-foreground block mb-0.5">售价（元）</label>
                  <NumInput id={`product-price-${p.id}`} value={p.price} onChange={(v) => patch(p.id, { price: v })} />
                </div>
                <div>
                  <label htmlFor={`product-cost-${p.id}`} className="text-[11px] text-muted-foreground block mb-0.5">食材总成本（元）</label>
                  <NumInput id={`product-cost-${p.id}`} value={p.ingredientCost} onChange={(v) => patch(p.id, { ingredientCost: v })} />
                </div>
                <div>
                  <label htmlFor={`product-loss-${p.id}`} className="text-[11px] text-muted-foreground block mb-0.5">损耗率（%）</label>
                  <NumInput
                    id={`product-loss-${p.id}`}
                    value={p.lossRate * 100}
                    onChange={(v) => patch(p.id, { lossRate: v / 100 })}
                    step={0.1}
                  />
                </div>
                <div>
                  <label htmlFor={`product-packcost-${p.id}`} className="text-[11px] text-muted-foreground block mb-0.5">包装成本（元）</label>
                  <NumInput id={`product-packcost-${p.id}`} value={p.packagingCost} onChange={(v) => patch(p.id, { packagingCost: v })} />
                </div>
                <div>
                  <label htmlFor={`product-packfee-${p.id}`} className="text-[11px] text-muted-foreground block mb-0.5">顾客包装费（元）</label>
                  <NumInput id={`product-packfee-${p.id}`} value={p.packagingFee} onChange={(v) => patch(p.id, { packagingFee: v })} />
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
        <Plus className="w-3.5 h-3.5" /> 添加商品
      </button>
    </div>
  );
}
