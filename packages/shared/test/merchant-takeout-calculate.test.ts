import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStore } from "../../ai-chat/src/lib/merchant-takeout/defaults";
import type { MerchantStore } from "../../ai-chat/src/lib/merchant-takeout/types";
import {
  calculateBasket,
  calculateMonth,
  calculateSimulation,
  getReportReadiness,
} from "../../ai-chat/src/lib/merchant-takeout/calculate";

function approx(actual: number, expected: number, eps = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `期望 ${expected}，实际 ${actual}（误差 ${Math.abs(actual - expected)}）`,
  );
}

// 默认店铺：与锚点一致的单商品、单购物篮，规则/活动/损失/税费均为零态
function makeStore(): MerchantStore {
  const store = createEmptyStore("测试店");
  store.products = [
    { id: "p1", name: "招牌饭", price: 30, ingredientCost: 8, lossRate: 0.1, packagingCost: 1, packagingFee: 1 },
  ];
  store.baskets = [
    { id: "b1", name: "单份套餐", items: [{ productId: "p1", quantity: 1 }], orderShare: 100 },
  ];
  store.platformRules = {
    platform: "taobao-flash",
    commissionRate: 0.1,
    fixedServiceFee: 0,
    merchantDeliveryFee: 0,
    customerDeliveryFee: 0,
    commissionBase: { includeProduct: true, includePackagingFee: false, includeDeliveryFee: false },
    discountBeforeCommission: false,
    confirmed: true,
    source: {},
  };
  store.activities = { list: [], stackOrder: [] };
  store.loss = { orderLossRate: 0, lossAmountPerOrder: 0, confirmed: false };
  store.tax = { rate: 0, base: "preTaxProfit", confirmed: false };
  store.sales = [1, 2, 3, 4].map((m) => ({ monthIndex: m, naturalOrders: 100, promotionBudget: 0, promotionOrders: 0 }));
  return store;
}

test("锚点：满减手算一致", () => {
  const store = makeStore();
  store.activities = {
    list: [{ id: "fr1", type: "fullReduction", threshold: 30, reduction: 8, merchantShare: 0.5 }],
    stackOrder: ["fr1"],
  };
  const r = calculateBasket(store.baskets[0], store.products, store.platformRules, store.activities);
  assert.equal(r.grossProduct, 30);
  assert.equal(r.totalDiscount, 8);
  assert.equal(r.merchantDiscountCost, 4);
  assert.equal(r.commission, 3);
  assert.equal(r.settlement, 24);
  assert.equal(r.foodCost, 8);
  approx(r.lossCost, 0.8);
  assert.equal(r.packagingCost, 1);
  approx(r.contribution, 14.2);
});

test("无活动基础订单手算一致", () => {
  const store = makeStore();
  store.products = [{ id: "p1", name: "饭", price: 20, ingredientCost: 5, lossRate: 0, packagingCost: 1, packagingFee: 2 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 2 }], orderShare: 100 }];
  store.platformRules = {
    platform: "taobao-flash",
    commissionRate: 0.05,
    fixedServiceFee: 1,
    merchantDeliveryFee: 2,
    customerDeliveryFee: 3,
    commissionBase: { includeProduct: true, includePackagingFee: false, includeDeliveryFee: false },
    discountBeforeCommission: false,
    confirmed: true,
    source: {},
  };
  const r = calculateBasket(store.baskets[0], store.products, store.platformRules, store.activities);
  assert.equal(r.grossProduct, 40);
  assert.equal(r.packagingIncome, 4);
  assert.equal(r.deliveryIncome, 3);
  assert.equal(r.totalDiscount, 0);
  assert.equal(r.commissionBase, 40);
  assert.equal(r.commission, 2);
  assert.equal(r.platformFee, 3);
  assert.equal(r.settlement, 42);
  assert.equal(r.foodCost, 10);
  assert.equal(r.lossCost, 0);
  assert.equal(r.packagingCost, 2);
  assert.equal(r.contribution, 30);
});

test("食材损耗与包装计入贡献", () => {
  const store = makeStore();
  store.products = [{ id: "p1", name: "x", price: 15, ingredientCost: 6, lossRate: 0.25, packagingCost: 2, packagingFee: 2 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 4 }], orderShare: 100 }];
  store.platformRules = {
    ...store.platformRules,
    commissionRate: 0,
    commissionBase: { includeProduct: false, includePackagingFee: false, includeDeliveryFee: false },
  };
  const r = calculateBasket(store.baskets[0], store.products, store.platformRules, store.activities);
  assert.equal(r.grossProduct, 60);
  assert.equal(r.packagingIncome, 8);
  assert.equal(r.foodCost, 24);
  approx(r.lossCost, 6);
  assert.equal(r.packagingCost, 8);
  assert.equal(r.settlement, 68);
  approx(r.contribution, 30);
});

test("两购物篮 60/40 加权平均贡献", () => {
  const store = makeStore();
  store.products = [
    { id: "p1", name: "a", price: 10, ingredientCost: 4, lossRate: 0, packagingCost: 1, packagingFee: 1 },
    { id: "p2", name: "b", price: 20, ingredientCost: 8, lossRate: 0, packagingCost: 1, packagingFee: 1 },
  ];
  store.baskets = [
    { id: "b1", name: "A", items: [{ productId: "p1", quantity: 1 }], orderShare: 60 },
    { id: "b2", name: "B", items: [{ productId: "p2", quantity: 1 }], orderShare: 40 },
  ];
  store.platformRules = {
    ...store.platformRules,
    commissionRate: 0,
    commissionBase: { includeProduct: false, includePackagingFee: false, includeDeliveryFee: false },
  };
  const m = calculateMonth(store, { naturalOrders: 100, promotionOrders: 0, promotionBudget: 0, activities: store.activities });
  approx(m.avgContribution, 8.4);
  assert.equal(m.monthContribution, 840);
  assert.equal(m.netProfit, 840);
});

test("扣点基数按勾选项计入", () => {
  const store = makeStore();
  store.products = [{ id: "p1", name: "x", price: 100, ingredientCost: 0, lossRate: 0, packagingCost: 0, packagingFee: 5 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 1 }], orderShare: 100 }];
  const base = {
    ...store.platformRules,
    customerDeliveryFee: 4,
    commissionBase: { includeProduct: false, includePackagingFee: false, includeDeliveryFee: false },
  };

  const onlyProduct = calculateBasket(
    store.baskets[0],
    store.products,
    { ...base, commissionBase: { includeProduct: true, includePackagingFee: false, includeDeliveryFee: false } },
    store.activities,
  );
  approx(onlyProduct.commissionBase, 100);
  approx(onlyProduct.commission, 10);

  const allOn = calculateBasket(
    store.baskets[0],
    store.products,
    { ...base, commissionBase: { includeProduct: true, includePackagingFee: true, includeDeliveryFee: true } },
    store.activities,
  );
  approx(allOn.commissionBase, 109);
  approx(allOn.commission, 10.9);

  const onlyPackaging = calculateBasket(
    store.baskets[0],
    store.products,
    { ...base, commissionBase: { includeProduct: false, includePackagingFee: true, includeDeliveryFee: false } },
    store.activities,
  );
  approx(onlyPackaging.commissionBase, 5);
  approx(onlyPackaging.commission, 0.5);
});

test("满减与红包按定义顺序叠加", () => {
  const store = makeStore();
  store.products = [{ id: "p1", name: "x", price: 30, ingredientCost: 0, lossRate: 0, packagingCost: 0, packagingFee: 0 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 1 }], orderShare: 100 }];
  store.platformRules = {
    ...store.platformRules,
    commissionRate: 0,
    commissionBase: { includeProduct: false, includePackagingFee: false, includeDeliveryFee: false },
  };
  store.activities = {
    list: [
      { id: "fr", type: "fullReduction", threshold: 30, reduction: 8, merchantShare: 0.5 },
      { id: "rp", type: "redPacket", amount: 4, merchantShare: 1 },
    ],
    stackOrder: ["fr", "rp"],
  };
  const r = calculateBasket(store.baskets[0], store.products, store.platformRules, store.activities);
  assert.equal(r.totalDiscount, 12);
  assert.equal(r.merchantDiscountCost, 8);
  assert.equal(r.settlement, 22);
  assert.equal(r.contribution, 22);
});

test("折扣与满减叠加顺序影响结果", () => {
  const store = makeStore();
  store.products = [{ id: "p1", name: "x", price: 30, ingredientCost: 0, lossRate: 0, packagingCost: 0, packagingFee: 0 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 1 }], orderShare: 100 }];
  store.platformRules = {
    ...store.platformRules,
    commissionRate: 0,
    commissionBase: { includeProduct: false, includePackagingFee: false, includeDeliveryFee: false },
  };
  const discountFirst = calculateBasket(store.baskets[0], store.products, store.platformRules, {
    list: [
      { id: "dc", type: "discount", rate: 0.5, merchantShare: 1 },
      { id: "fr", type: "fullReduction", threshold: 20, reduction: 5, merchantShare: 1 },
    ],
    stackOrder: ["dc", "fr"],
  });
  const frFirst = calculateBasket(store.baskets[0], store.products, store.platformRules, {
    list: [
      { id: "dc", type: "discount", rate: 0.5, merchantShare: 1 },
      { id: "fr", type: "fullReduction", threshold: 20, reduction: 5, merchantShare: 1 },
    ],
    stackOrder: ["fr", "dc"],
  });
  assert.equal(discountFirst.totalDiscount, 15); // 30→15（折扣），15<20 满减不触发
  assert.equal(frFirst.totalDiscount, 17.5); // 30→25（满减）→ 折扣 12.5，合计 17.5
});

test("月售跨 1000/2000 单阶梯人工切换", () => {
  const store = makeStore();
  store.staffing = {
    base: [{ role: "老板", count: 1, monthlySalary: 8000 }],
    tiers: [
      { minMonthlyOrders: 1000, members: [{ role: "打包", count: 1, monthlySalary: 5000 }] },
      {
        minMonthlyOrders: 2000,
        members: [
          { role: "打包", count: 1, monthlySalary: 5000 },
          { role: "厨工", count: 1, monthlySalary: 6000 },
        ],
      },
    ],
  };
  store.products = [{ id: "p1", name: "x", price: 10, ingredientCost: 0, lossRate: 0, packagingCost: 0, packagingFee: 0 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 1 }], orderShare: 100 }];
  store.platformRules = {
    ...store.platformRules,
    commissionRate: 0,
    commissionBase: { includeProduct: false, includePackagingFee: false, includeDeliveryFee: false },
  };

  const at999 = calculateMonth(store, { naturalOrders: 999, promotionOrders: 0, promotionBudget: 0, activities: store.activities });
  assert.equal(at999.laborCost, 8000);

  const at1000 = calculateMonth(store, { naturalOrders: 1000, promotionOrders: 0, promotionBudget: 0, activities: store.activities });
  assert.equal(at1000.laborCost, 13000);

  const at2000 = calculateMonth(store, { naturalOrders: 2000, promotionOrders: 0, promotionBudget: 0, activities: store.activities });
  assert.equal(at2000.laborCost, 19000);
});

test("推广新增订单边际利润", () => {
  const store = makeStore();
  store.products = [{ id: "p1", name: "x", price: 10, ingredientCost: 0, lossRate: 0, packagingCost: 0, packagingFee: 0 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 1 }], orderShare: 100 }];
  store.platformRules = {
    ...store.platformRules,
    commissionRate: 0,
    commissionBase: { includeProduct: false, includePackagingFee: false, includeDeliveryFee: false },
  };
  const m = calculateMonth(store, { naturalOrders: 100, promotionOrders: 50, promotionBudget: 200, activities: store.activities });
  assert.equal(m.totalOrders, 150);
  assert.equal(m.monthContribution, 1300); // 150×10 - 200
  assert.equal(m.promotionMarginalProfit, 300); // 50×10 - 200
  assert.equal(m.promotionCostPerOrder, 4); // 200/50
});

test("订单损失与税费各扣一次", () => {
  const store = makeStore();
  store.products = [{ id: "p1", name: "x", price: 100, ingredientCost: 10, lossRate: 0, packagingCost: 1, packagingFee: 1 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 1 }], orderShare: 100 }];
  store.loss = { orderLossRate: 0.05, lossAmountPerOrder: 10, confirmed: false };
  store.tax = { rate: 0.2, base: "preTaxProfit", confirmed: false };
  store.staffing = { base: [{ role: "老板", count: 1, monthlySalary: 5000 }], tiers: [] };
  store.costs.monthlyFixed = { ...store.costs.monthlyFixed, rent: 1000 };
  const m = calculateMonth(store, { naturalOrders: 100, promotionOrders: 0, promotionBudget: 0, activities: store.activities });
  assert.equal(m.orderLossCost, 50);
  assert.equal(m.laborCost, 5000);
  assert.equal(m.monthContribution, 8000);
  assert.equal(m.preTaxProfit, 1950);
  approx(m.tax, 390);
  assert.equal(m.netProfit, 1560);
});

test("一次性投入只进现金流与回本，不进月利润", () => {
  const store = makeStore();
  store.products = [{ id: "p1", name: "x", price: 10, ingredientCost: 0, lossRate: 0, packagingCost: 0, packagingFee: 0 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 1 }], orderShare: 100 }];
  store.platformRules = {
    ...store.platformRules,
    commissionRate: 0,
    commissionBase: { includeProduct: false, includePackagingFee: false, includeDeliveryFee: false },
  };
  store.profile = { ...store.profile, availableCapital: 50000 };
  store.costs.oneTime = {
    renovation: 10000,
    equipment: 5000,
    franchiseFee: 0,
    transferFee: 0,
    agencyFee: 0,
    license: 0,
    initialInventory: 0,
    openingPromotion: 0,
    refundableDeposit: 0,
  };
  store.costs.monthlyFixed = { ...store.costs.monthlyFixed, rent: 1000 };
  store.staffing = { base: [{ role: "老板", count: 1, monthlySalary: 4000 }], tiers: [] };

  const phases = [1, 2, 3, 4].map((i) => ({
    label: i === 4 ? "稳定期" : `第${i}月`,
    monthIndex: i,
    naturalOrders: 1000,
    promotionOrders: 0,
    promotionBudget: 0,
    activities: store.activities,
  }));

  const sim = calculateSimulation(store, phases);
  assert.equal(sim.totalOneTimeCosts, 15000);
  assert.equal(sim.startingCash, 35000);
  assert.equal(sim.minCash, 35000);
  assert.deepEqual(sim.months.map((m) => m.result.netProfit), [5000, 5000, 5000, 5000]);
  assert.equal(sim.paybackMonths, 3);
  assert.deepEqual(sim.cumulativeCash, [40000, 45000, 50000, 55000]);
});

test("一次性投入超四个月回本则 payback 为 null", () => {
  const store = makeStore();
  store.products = [{ id: "p1", name: "x", price: 10, ingredientCost: 0, lossRate: 0, packagingCost: 0, packagingFee: 0 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 1 }], orderShare: 100 }];
  store.platformRules = {
    ...store.platformRules,
    commissionRate: 0,
    commissionBase: { includeProduct: false, includePackagingFee: false, includeDeliveryFee: false },
  };
  store.profile = { ...store.profile, availableCapital: 200000 };
  store.costs.oneTime = {
    renovation: 100000,
    equipment: 0,
    franchiseFee: 0,
    transferFee: 0,
    agencyFee: 0,
    license: 0,
    initialInventory: 0,
    openingPromotion: 0,
    refundableDeposit: 0,
  };
  const phases = [1, 2, 3, 4].map((i) => ({
    label: `第${i}月`,
    monthIndex: i,
    naturalOrders: 1000,
    promotionOrders: 0,
    promotionBudget: 0,
    activities: store.activities,
  }));
  const sim = calculateSimulation(store, phases);
  assert.equal(sim.totalOneTimeCosts, 100000);
  assert.equal(sim.paybackMonths, null);
});

test("保本单量计入订单损失的手算锚点", () => {
  const store = makeStore();
  store.products = [{ id: "p1", name: "x", price: 10, ingredientCost: 0, lossRate: 0, packagingCost: 0, packagingFee: 0 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 1 }], orderShare: 100 }];
  store.platformRules = {
    ...store.platformRules,
    commissionRate: 0,
    commissionBase: { includeProduct: false, includePackagingFee: false, includeDeliveryFee: false },
  };
  store.staffing = { base: [{ role: "老板", count: 1, monthlySalary: 1000 }], tiers: [] };
  store.costs.monthlyFixed = { ...store.costs.monthlyFixed, rent: 1000 };

  store.loss = { orderLossRate: 0.1, lossAmountPerOrder: 20, confirmed: false };
  const withLoss = calculateMonth(store, { naturalOrders: 0, promotionOrders: 0, promotionBudget: 0, activities: store.activities });
  approx(withLoss.avgContribution, 10);
  assert.equal(withLoss.breakevenOrders, 250); // 2000 / (10 - 0.1×20)

  store.loss = { orderLossRate: 0, lossAmountPerOrder: 0, confirmed: false };
  const noLoss = calculateMonth(store, { naturalOrders: 0, promotionOrders: 0, promotionBudget: 0, activities: store.activities });
  assert.equal(noLoss.breakevenOrders, 200); // 2000 / 10
});

test("单均贡献 ≤ 0 时保本单量为 null", () => {
  const store = makeStore();
  store.products = [{ id: "p1", name: "x", price: 10, ingredientCost: 10, lossRate: 0, packagingCost: 0, packagingFee: 0 }];
  store.baskets = [{ id: "b1", name: "b", items: [{ productId: "p1", quantity: 1 }], orderShare: 100 }];
  store.platformRules = {
    ...store.platformRules,
    commissionRate: 0,
    commissionBase: { includeProduct: false, includePackagingFee: false, includeDeliveryFee: false },
  };
  store.costs.monthlyFixed = { ...store.costs.monthlyFixed, rent: 3000 };
  const m = calculateMonth(store, { naturalOrders: 100, promotionOrders: 0, promotionBudget: 0, activities: store.activities });
  approx(m.avgContribution, 0);
  assert.equal(m.breakevenOrders, null);

  store.products[0] = { ...store.products[0], price: 5 };
  const m2 = calculateMonth(store, { naturalOrders: 100, promotionOrders: 0, promotionBudget: 0, activities: store.activities });
  assert.ok(m2.avgContribution < 0);
  assert.equal(m2.breakevenOrders, null);
});

test("购物篮占比不是 100% 时报告未就绪", () => {
  const store = makeStore();
  store.locations = [{ id: "l1", name: "x", address: "", lng: 0, lat: 0, deliveryRadius: 0, poi: [], competitors: "", selected: true }];
  store.baskets = [
    { id: "b1", name: "A", items: [{ productId: "p1", quantity: 1 }], orderShare: 60 },
    { id: "b2", name: "B", items: [{ productId: "p1", quantity: 1 }], orderShare: 30 },
  ];
  const missing = getReportReadiness(store);
  assert.ok(missing.includes("购物篮订单占比合计不是 100%"));
});

test("配置完整时 readiness 为空", () => {
  const store = makeStore();
  store.locations = [{ id: "l1", name: "x", address: "", lng: 0, lat: 0, deliveryRadius: 0, poi: [], competitors: "", selected: true }];
  store.profile = { ...store.profile, availableCapital: 100000 };
  store.loss = { orderLossRate: 0.05, lossAmountPerOrder: 10, confirmed: true };
  store.tax = { rate: 0.2, base: "preTaxProfit", confirmed: true };
  store.staffing = { base: [{ role: "老板", count: 1, monthlySalary: 5000 }], tiers: [] };
  store.sales = [1, 2, 3, 4].map((i) => ({ monthIndex: i, naturalOrders: 100, promotionBudget: 100, promotionOrders: 10 }));
  assert.deepEqual(getReportReadiness(store), []);
});

test("月度指标：营业额/结算收入/各项成本/活动订单增量", () => {
  const store = makeStore();
  const noActivity = calculateMonth(store, { naturalOrders: 100, promotionOrders: 0, promotionBudget: 0, activities: { list: [], stackOrder: [] } });
  assert.equal(noActivity.avgGrossProduct, 30);
  assert.equal(noActivity.grossRevenue, 3000);
  approx(noActivity.avgSettlement, 28);
  approx(noActivity.settlementRevenue, 2800);
  assert.equal(noActivity.foodCost, 800);
  approx(noActivity.lossCost, 80);
  assert.equal(noActivity.packagingCost, 100);
  approx(noActivity.commissionCost, 300);
  assert.equal(noActivity.merchantDiscountCost, 0);
  assert.equal(noActivity.activityIncrementalOrders, null);

  store.activities = {
    list: [{ id: "fr1", type: "fullReduction", threshold: 30, reduction: 8, merchantShare: 0.5 }],
    stackOrder: ["fr1"],
  };
  const withActivity = calculateMonth(store, { naturalOrders: 100, promotionOrders: 0, promotionBudget: 0, activities: store.activities });
  assert.equal(withActivity.merchantDiscountCost, 400);
  assert.ok(withActivity.activityIncrementalOrders !== null && withActivity.activityIncrementalOrders > 0);
});
