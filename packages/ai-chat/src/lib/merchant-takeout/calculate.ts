/**
 * 外卖开店模拟器 — 确定性财务计算引擎
 * 纯函数、无副作用、不读环境、不调 AI；同样输入永远同样输出。
 * 金额单位：元；比例（lossRate/taxRate/commissionRate/rate/merchantShare）均为 0~1 小数。
 */

import type {
  MerchantStore,
  StoreProduct,
  StoreBasket,
  PlatformRules,
  StoreActivities,
  StoreActivity,
  StaffingTier,
  TaxBaseKind,
  OneTimeCosts,
  MonthlyFixedCosts,
} from "./types";

export interface BasketResult {
  grossProduct: number;
  packagingIncome: number;
  deliveryIncome: number;
  totalDiscount: number;
  merchantDiscountCost: number;
  commissionBase: number;
  commission: number;
  platformFee: number;
  settlement: number;
  foodCost: number;
  lossCost: number;
  packagingCost: number;
  contribution: number;
}

export interface MonthInput {
  naturalOrders: number;
  promotionOrders: number;
  promotionBudget: number;
  activities: StoreActivities;
}

export interface MonthResult {
  totalOrders: number;
  avgContribution: number;
  monthContribution: number;
  orderLossCost: number;
  laborCost: number;
  preTaxProfit: number;
  tax: number;
  netProfit: number;
  breakevenOrders: number | null;
  promotionCostPerOrder: number;
  promotionMarginalProfit: number;
}

export interface SimulationPhase extends MonthInput {
  label: string;
  monthIndex: number;
}

export interface SimulationResult {
  months: { label: string; monthIndex: number; result: MonthResult }[];
  totalOneTimeCosts: number;
  startingCash: number;
  cumulativeCash: number[];
  minCash: number;
  paybackMonths: number | null;
}

export function calculateBasket(
  basket: StoreBasket,
  products: StoreProduct[],
  rules: PlatformRules,
  activities: StoreActivities,
): BasketResult {
  const map = new Map(products.map((p) => [p.id, p]));
  let grossProduct = 0;
  let packagingIncome = 0;
  let foodCost = 0;
  let lossCost = 0;
  let packagingCost = 0;

  for (const item of basket.items) {
    const p = map.get(item.productId);
    if (!p) throw new Error(`购物篮引用了不存在的商品: ${item.productId}`);
    const q = item.quantity;
    grossProduct += p.price * q;
    packagingIncome += p.packagingFee * q;
    foodCost += p.ingredientCost * q;
    lossCost += p.ingredientCost * p.lossRate * q;
    packagingCost += p.packagingCost * q;
  }

  const deliveryIncome = rules.customerDeliveryFee ?? 0;

  // 活动按 stackOrder 顺序叠加，subtotal 从 grossProduct 起算
  let subtotal = grossProduct;
  let totalDiscount = 0;
  let merchantDiscountCost = 0;
  const activityMap = new Map<string, StoreActivity>(activities.list.map((a) => [a.id, a]));
  for (const id of activities.stackOrder) {
    const act = activityMap.get(id);
    if (!act) continue;
    let d = 0;
    if (act.type === "discount") {
      d = subtotal * (1 - act.rate);
      subtotal *= act.rate;
    } else if (act.type === "fullReduction") {
      if (subtotal >= act.threshold) d = act.reduction;
      subtotal -= d;
    } else {
      d = act.amount;
      subtotal -= d;
    }
    totalDiscount += d;
    merchantDiscountCost += d * act.merchantShare;
  }

  const cb = rules.commissionBase;
  const commissionBase = Math.max(
    (cb.includeProduct ? grossProduct : 0) +
      (cb.includePackagingFee ? packagingIncome : 0) +
      (cb.includeDeliveryFee ? deliveryIncome : 0) -
      (rules.discountBeforeCommission ? totalDiscount : 0),
    0,
  );
  const commission = commissionBase * (rules.commissionRate ?? 0);
  const platformFee = commission + (rules.fixedServiceFee ?? 0);

  const settlement =
    grossProduct +
    packagingIncome +
    deliveryIncome -
    merchantDiscountCost -
    platformFee -
    (rules.merchantDeliveryFee ?? 0);

  const contribution = settlement - foodCost - lossCost - packagingCost;

  return {
    grossProduct,
    packagingIncome,
    deliveryIncome,
    totalDiscount,
    merchantDiscountCost,
    commissionBase,
    commission,
    platformFee,
    settlement,
    foodCost,
    lossCost,
    packagingCost,
    contribution,
  };
}

// ponytail: 人工走阶梯用工（staffing），月度固定成本里的 labor 字段不再计入，避免重复
function otherFixedCosts(costs: MonthlyFixedCosts): number {
  return costs.rent + costs.utilities + costs.property + costs.network + costs.garbage + costs.other;
}

function staffCostTotal(members: { count: number; monthlySalary: number }[]): number {
  return members.reduce((s, m) => s + m.count * m.monthlySalary, 0);
}

function laborCost(store: MerchantStore, totalOrders: number): number {
  const base = staffCostTotal(store.staffing.base);
  const sorted = [...store.staffing.tiers].sort((a, b) => a.minMonthlyOrders - b.minMonthlyOrders);
  let top: StaffingTier | null = null;
  for (const t of sorted) if (t.minMonthlyOrders <= totalOrders) top = t;
  return top ? base + staffCostTotal(top.members) : base;
}

// ponytail: 押金可回收，不计入一次性投入
function totalOneTimeCosts(costs: OneTimeCosts): number {
  return (
    costs.renovation +
    costs.equipment +
    costs.franchiseFee +
    costs.transferFee +
    costs.agencyFee +
    costs.license +
    costs.initialInventory +
    costs.openingPromotion
  );
}

function taxBaseValue(
  kind: TaxBaseKind,
  totalOrders: number,
  avgGrossProduct: number,
  avgSettlement: number,
  preTaxProfit: number,
  customBase: number,
): number {
  switch (kind) {
    case "productRevenue":
      return totalOrders * avgGrossProduct;
    case "platformSettlement":
      return totalOrders * avgSettlement;
    case "preTaxProfit":
      return preTaxProfit;
    default:
      return customBase;
  }
}

export function calculateMonth(store: MerchantStore, input: MonthInput): MonthResult {
  const totalOrders = input.naturalOrders + input.promotionOrders;

  const results = store.baskets.map((b) =>
    calculateBasket(b, store.products, store.platformRules, input.activities),
  );
  const totalShare = store.baskets.reduce((s, b) => s + (b.orderShare || 0), 0);

  let avgContribution = 0;
  let avgGrossProduct = 0;
  let avgSettlement = 0;
  results.forEach((r, i) => {
    const w = totalShare > 0 ? (store.baskets[i].orderShare || 0) / totalShare : 0;
    avgContribution += r.contribution * w;
    avgGrossProduct += r.grossProduct * w;
    avgSettlement += r.settlement * w;
  });

  const monthContribution = totalOrders * avgContribution - input.promotionBudget;

  const orderLossCost =
    totalOrders * (store.loss.orderLossRate || 0) * (store.loss.lossAmountPerOrder || 0);

  const labor = laborCost(store, totalOrders);
  const fixed = otherFixedCosts(store.costs.monthlyFixed);

  const preTaxProfit = monthContribution - labor - fixed - orderLossCost;

  const baseValue = taxBaseValue(
    store.tax.base,
    totalOrders,
    avgGrossProduct,
    avgSettlement,
    preTaxProfit,
    store.tax.customBase ?? 0,
  );
  const tax = baseValue * (store.tax.rate || 0);

  const netProfit = preTaxProfit - tax;

  const breakevenOrders = avgContribution > 0 ? (labor + fixed) / avgContribution : null;

  const promotionCostPerOrder =
    input.promotionOrders > 0 ? input.promotionBudget / input.promotionOrders : 0;
  const promotionMarginalProfit = input.promotionOrders * avgContribution - input.promotionBudget;

  return {
    totalOrders,
    avgContribution,
    monthContribution,
    orderLossCost,
    laborCost: labor,
    preTaxProfit,
    tax,
    netProfit,
    breakevenOrders,
    promotionCostPerOrder,
    promotionMarginalProfit,
  };
}

export function calculateSimulation(
  store: MerchantStore,
  phases: SimulationPhase[],
): SimulationResult {
  const oneTime = totalOneTimeCosts(store.costs.oneTime);
  const startingCash = store.profile.availableCapital - oneTime;

  let cash = startingCash;
  let minCash = startingCash;
  let cumProfit = 0;
  let paybackMonths: number | null = oneTime <= 0 ? 0 : null;
  const cumulativeCash: number[] = [];
  const months = phases.map((p, idx) => {
    const result = calculateMonth(store, {
      naturalOrders: p.naturalOrders,
      promotionOrders: p.promotionOrders,
      promotionBudget: p.promotionBudget,
      activities: p.activities,
    });
    cumProfit += result.netProfit;
    cash += result.netProfit;
    cumulativeCash.push(cash);
    if (cash < minCash) minCash = cash;
    if (paybackMonths === null && cumProfit >= oneTime) paybackMonths = idx + 1;
    return { label: p.label, monthIndex: p.monthIndex, result };
  });

  return {
    months,
    totalOneTimeCosts: oneTime,
    startingCash,
    cumulativeCash,
    minCash,
    paybackMonths,
  };
}

export function getReportReadiness(store: MerchantStore): string[] {
  const missing: string[] = [];
  const EPS = 1e-9;

  if (!store.locations.some((l) => l.selected)) missing.push("未选定经营地址");
  if (store.products.length === 0) missing.push("未录入商品/套餐");
  if (store.baskets.length === 0) missing.push("未录入典型购物篮");
  const shareSum = store.baskets.reduce((s, b) => s + (b.orderShare || 0), 0);
  if (store.baskets.length > 0 && Math.abs(shareSum - 100) > EPS) {
    missing.push("购物篮订单占比合计不是 100%");
  }
  if (!store.platformRules.confirmed) missing.push("平台规则未确认");
  if (store.staffing.base.length === 0) missing.push("未填写基础人员与老板工资");

  const phases = store.sales;
  if (phases.length < 4 || phases.some((p) => !(p.naturalOrders > 0))) {
    missing.push("未确认四个阶段自然订单量");
  }
  if (phases.length < 4 || phases.some((p) => p.promotionBudget < 0 || p.promotionOrders < 0)) {
    missing.push("未填写推广预算及预期新增订单");
  }

  const loss = store.loss;
  if (!loss || (loss.orderLossRate <= 0 && loss.lossAmountPerOrder <= 0)) {
    missing.push("未填写订单损失率与单笔损失金额");
  }
  const tax = store.tax;
  if (!tax || tax.rate <= 0) {
    missing.push("未确认税费参数");
  }

  return missing;
}
