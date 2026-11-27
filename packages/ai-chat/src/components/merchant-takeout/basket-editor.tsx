"use client";

import { Plus, Trash2 } from "lucide-react";
import type { BasketItem, StoreBasket, StoreProduct } from "@/lib/merchant-takeout/types";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const fmt = (n: number) =>
  `¥ ${(Number.isFinite(n) ? n : 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;

const emptyBasket = (): StoreBasket => ({ id: uid(), name: "", items: [], orderShare: 0 });

interface BasketEditorProps {
  baskets: StoreBasket[];
  products: StoreProduct[];
  onChange: (baskets: StoreBasket[]) => void;
}

export default function BasketEditor({ baskets, products, onChange }: BasketEditorProps) {
  const patch = (id: string, b: Partial<StoreBasket>) =>
    onChange(baskets.map((x) => (x.id === id ? { ...x, ...b } : x)));
  const add = () => onChange([...baskets, emptyBasket()]);
  const remove = (id: string) => onChange(baskets.filter((x) => x.id !== id));

  const addItem = (basketId: string) => {
    const firstProduct = products[0]?.id ?? "";
    onChange(
      baskets.map((b) =>
        b.id === basketId
          ? { ...b, items: [...b.items, { productId: firstProduct, quantity: 1 } as BasketItem] }
          : b,
      ),
    );
  };

  const summary = (b: StoreBasket) => {
    let gross = 0;
    let packagingIncome = 0;
    let foodCost = 0;
    for (const item of b.items) {
      const p = products.find((x) => x.id === item.productId);
      if (!p) continue;
      const q = item.quantity;
      gross += p.price * q;
      packagingIncome += p.packagingFee * q;
      foodCost += p.ingredientCost * q + p.ingredientCost * p.lossRate * q + p.packagingCost * q;
    }
    const grossProfit = packagingIncome + gross - foodCost;
    return { gross, packagingIncome, foodCost, grossProfit };
  };

  const shareSum = baskets.reduce((s, b) => s + (b.orderShare || 0), 0);
  const shareDiff = shareSum - 100;

  return (
    <div className="space-y-3">
      {products.length === 0 && (
        <div className="brutal bg-muted/40 p-3 text-xs text-muted-foreground">
          请先在「商品与套餐」模块录入商品，再配置购物篮。
        </div>
      )}

      {baskets.length === 0 ? (
        <div className="brutal bg-card p-3 text-xs text-muted-foreground">
          还没有购物篮。点击「添加购物篮」配置典型下单组合。
        </div>
      ) : (
        <ul className="space-y-2">
          {baskets.map((b) => {
            const s = summary(b);
            return (
              <li key={b.id} className="brutal bg-card p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={b.name}
                    onChange={(e) => patch(b.id, { name: e.target.value })}
                    placeholder="购物篮名称（如：一人食 / 家庭聚餐）"
                    className="flex-1 px-2 py-1.5 text-sm font-bold border-2 border-border bg-card"
                  />
                  <label className="text-[11px] text-muted-foreground shrink-0">占比</label>
                  <input
                    type="number"
                    min={0}
                    value={b.orderShare}
                    onChange={(e) => patch(b.id, { orderShare: e.target.value === "" ? 0 : Number(e.target.value) })}
                    className="w-20 px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">%</span>
                  <button onClick={() => remove(b.id)} className="brutal-btn p-1.5 text-muted-foreground">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  {b.items.map((item, ii) => (
                    <div key={ii} className="grid grid-cols-[1fr_64px_28px] gap-2 items-center">
                      <select
                        value={item.productId}
                        onChange={(e) =>
                          patch(b.id, {
                            items: b.items.map((x, i) =>
                              i === ii ? { ...x, productId: e.target.value } : x,
                            ),
                          })
                        }
                        className="w-full px-2 py-1.5 text-sm border-2 border-border bg-card"
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name || "未命名商品"}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        value={item.quantity}
                        onChange={(e) =>
                          patch(b.id, {
                            items: b.items.map((x, i) =>
                              i === ii ? { ...x, quantity: e.target.value === "" ? 0 : Number(e.target.value) } : x,
                            ),
                          })
                        }
                        className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
                      />
                      <button
                        onClick={() =>
                          patch(b.id, { items: b.items.filter((_, i) => i !== ii) })
                        }
                        className="brutal-btn p-1.5 text-muted-foreground"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addItem(b.id)}
                    className="brutal-btn inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-bold bg-muted/40 text-foreground"
                  >
                    <Plus className="w-3 h-3" /> 添加商品
                  </button>
                </div>

                <div className="text-xs font-mono space-y-0.5 border-t-2 border-border pt-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">商品金额</span>
                    <span>{fmt(s.gross)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">包装收入</span>
                    <span>{fmt(s.packagingIncome)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">商品成本</span>
                    <span>{fmt(s.foodCost)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>活动前毛利</span>
                    <span>{fmt(s.grossProfit)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={add}
        className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue text-white"
      >
        <Plus className="w-3.5 h-3.5" /> 添加购物篮
      </button>

      {baskets.length > 0 && (
        <div className="brutal bg-muted/40 p-3 text-xs font-mono flex items-center justify-between">
          <span className="text-muted-foreground">订单占比合计</span>
          <span className={Math.abs(shareDiff) > 1e-9 ? "text-orange font-bold" : "text-lime font-bold"}>
            {shareSum.toFixed(1)}%{Math.abs(shareDiff) > 1e-9 ? `（差额 ${shareDiff > 0 ? "+" : ""}${shareDiff.toFixed(1)}%）` : " ✓"}
          </span>
        </div>
      )}
    </div>
  );
}
