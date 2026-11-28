import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStore } from "../../ai-chat/src/lib/merchant-takeout/defaults";
import type { Competitor, MerchantStore } from "../../ai-chat/src/lib/merchant-takeout/types";
import {
  competitorMedian,
  averageTicket,
  baseOrderRange,
  clampPromotionBudget,
  applyBaselinePrediction,
  parsePredictionJson,
  sanitizePrediction,
} from "../../ai-chat/src/lib/merchant-takeout/predict-sales";

function comp(over: Partial<Competitor> = {}): Competitor {
  return {
    id: "c1",
    name: "竞店",
    distance: 1,
    category: "餐饮",
    monthlyOrders: 100,
    avgTicket: 20,
    rating: 4.5,
    activities: "",
    hours: "",
    note: "",
    ...over,
  };
}

function makeStore(overrides: Partial<MerchantStore> = {}): MerchantStore {
  const store = createEmptyStore("预测测试店");
  store.locations = [
    {
      id: "l1",
      name: "选址",
      address: "",
      lng: 0,
      lat: 0,
      deliveryRadius: 0,
      poi: [],
      competitors: "",
      competitorList: [],
      selected: true,
      costs: store.locations[0]?.costs ?? {
        annualRent: 0, deposit: 0, depositRefundable: false, transferFee: 0, propertyFee: 0,
        agencyFee: 0, renovation: 0, waterPrice: 0, waterUsage: 0, electricityPrice: 0,
        electricityUsage: 0, gasPrice: 0, gasUsage: 0, area: 0, floor: "", pickupConvenience: "",
        conditions: "",
      },
    },
  ];
  return { ...store, ...overrides };
}

test("competitorMedian: 空数组返回 0", () => {
  assert.equal(competitorMedian([]), 0);
});

test("competitorMedian: 奇数个取中位值", () => {
  const comps = [comp({ monthlyOrders: 100 }), comp({ monthlyOrders: 300 }), comp({ monthlyOrders: 200 })];
  assert.equal(competitorMedian(comps), 200);
});

test("competitorMedian: 偶数个取中间两数均值", () => {
  const comps = [
    comp({ monthlyOrders: 100 }),
    comp({ monthlyOrders: 200 }),
    comp({ monthlyOrders: 300 }),
    comp({ monthlyOrders: 400 }),
  ];
  assert.equal(competitorMedian(comps), 250);
});

test("competitorMedian: 忽略 monthlyOrders<=0 的项", () => {
  const comps = [comp({ monthlyOrders: 0 }), comp({ monthlyOrders: -5 }), comp({ monthlyOrders: 200 })];
  assert.equal(competitorMedian(comps), 200);
});

test("averageTicket: 空数组返回 0", () => {
  assert.equal(averageTicket([]), 0);
});

test("averageTicket: 计算均值", () => {
  const comps = [comp({ avgTicket: 10 }), comp({ avgTicket: 20 }), comp({ avgTicket: 30 })];
  assert.equal(averageTicket(comps), 20);
});

test("averageTicket: 忽略 0 值", () => {
  const comps = [comp({ avgTicket: 0 }), comp({ avgTicket: 20 }), comp({ avgTicket: 40 })];
  assert.equal(averageTicket(comps), 30);
});

test("baseOrderRange: 无竞店时三档非负且 conservative<=baseline<=optimistic", () => {
  const r = baseOrderRange(makeStore());
  assert.ok(r.conservative >= 0 && r.baseline >= 0 && r.optimistic >= 0);
  assert.ok(r.conservative <= r.baseline && r.baseline <= r.optimistic);
});

test("baseOrderRange: 竞店月售越高区间越高", () => {
  const low = baseOrderRange(makeStore());
  const high = baseOrderRange(
    makeStore({
      locations: [
        {
          ...makeStore().locations[0],
          competitorList: [comp({ monthlyOrders: 1000 }), comp({ monthlyOrders: 1200 })],
        },
      ],
    }),
  );
  assert.ok(high.baseline > low.baseline);
});

test("baseOrderRange: 录入弱竞店后以真实中位数为准（可低于无竞店经验底值）", () => {
  const none = baseOrderRange(makeStore());
  assert.equal(none.baseline, 200);
  const weak = baseOrderRange(
    makeStore({ locations: [{ ...makeStore().locations[0], competitorList: [comp({ monthlyOrders: 100 })] }] }),
  );
  assert.equal(weak.baseline, 80); // 0.8 × 100，真实市场信号优先于经验底值
});

test("baseOrderRange: POI 数量越多 baseline 越高", () => {
  const few = baseOrderRange(makeStore());
  const many = baseOrderRange(
    makeStore({
      locations: [{ ...makeStore().locations[0], poi: ["学校", "写字楼", "医院"] }],
    }),
  );
  assert.ok(many.baseline > few.baseline);
});

test("clampPromotionBudget: cap<=0 视为无上限", () => {
  assert.equal(clampPromotionBudget(500, 0), 500);
  assert.equal(clampPromotionBudget(500, -1), 500);
});

test("clampPromotionBudget: cap 有值时裁剪", () => {
  assert.equal(clampPromotionBudget(500, 200), 200);
});

test("clampPromotionBudget: 负预算归 0", () => {
  assert.equal(clampPromotionBudget(-100, 200), 0);
  assert.equal(clampPromotionBudget(-100, 0), 0);
});

test("applyBaselinePrediction: 无 prediction 原样返回", () => {
  const store = makeStore();
  const out = applyBaselinePrediction(store);
  assert.equal(out, store);
});

test("applyBaselinePrediction: store.sales 为空时从 prediction 生成四阶段", () => {
  const store = makeStore();
  store.sales = [];
  store.salesPrediction = {
    id: "p1",
    createdAt: 1,
    confidence: "medium",
    basis: [],
    sources: [],
    assumptions: [],
    missing: [],
    phases: [1, 2, 3, 4].map((m) => ({
      monthIndex: m,
      conservative: m * 100,
      baseline: m * 100,
      optimistic: m * 150,
      promotionBudget: m * 50,
      promotionOrders: m * 10,
      notes: [],
    })),
  };

  const out = applyBaselinePrediction(store);
  assert.equal(out.sales.length, 4);
  assert.deepEqual(
    out.sales.map((s) => [s.monthIndex, s.naturalOrders, s.promotionBudget, s.promotionOrders]),
    [
      [1, 100, 50, 10],
      [2, 200, 100, 20],
      [3, 300, 150, 30],
      [4, 400, 200, 40],
    ],
  );
});

test("applyBaselinePrediction: 写入 baseline/promotionBudget/promotionOrders，保留 activities 与 naturalOrdersReference，不可变", () => {
  const store = makeStore();
  store.sales = [
    { monthIndex: 1, naturalOrders: 1, promotionBudget: 0, promotionOrders: 0, naturalOrdersReference: "ref1" },
    { monthIndex: 2, naturalOrders: 2, promotionBudget: 0, promotionOrders: 0 },
    { monthIndex: 3, naturalOrders: 3, promotionBudget: 0, promotionOrders: 0 },
    { monthIndex: 4, naturalOrders: 4, promotionBudget: 0, promotionOrders: 0 },
  ];
  store.activities = { list: [{ id: "a1", type: "discount", rate: 0.9, merchantShare: 1 }], stackOrder: ["a1"] };
  store.salesPrediction = {
    id: "p1",
    createdAt: 1,
    confidence: "medium",
    basis: [],
    sources: [],
    assumptions: [],
    missing: [],
    phases: [1, 2, 3, 4].map((m) => ({
      monthIndex: m,
      conservative: m * 100,
      baseline: m * 100,
      optimistic: m * 150,
      promotionBudget: m * 50,
      promotionOrders: m * 10,
      notes: [],
    })),
  };

  const originalSales = store.sales;
  const out = applyBaselinePrediction(store);

  assert.notEqual(out, store);
  assert.deepEqual(
    out.sales.map((s) => [s.naturalOrders, s.promotionBudget, s.promotionOrders]),
    [
      [100, 50, 10],
      [200, 100, 20],
      [300, 150, 30],
      [400, 200, 40],
    ],
  );
  assert.equal(out.sales[0].naturalOrdersReference, "ref1");
  assert.deepEqual(out.activities, store.activities);
  // 不可变：原 store.sales 未被改动
  assert.deepEqual(store.sales, originalSales);
  assert.equal(store.sales[0].naturalOrders, 1);
});

test("parsePredictionJson: 合法 JSON 各字段正确且预算被 clamp", () => {
  const store = makeStore();
  store.profile = { ...store.profile, promotionBudgetCap: 50 };
  const text = JSON.stringify({
    confidence: "high",
    basis: ["b1"],
    sources: ["https://example.com/a"],
    assumptions: ["a1"],
    missing: [],
    phases: [1, 2, 3, 4].map((m) => ({
      monthIndex: m,
      conservative: m * 10,
      baseline: m * 20,
      optimistic: m * 30,
      promotionBudget: m * 100,
      promotionOrders: m * 5,
      notes: [`阶段${m}`],
    })),
  });

  const out = parsePredictionJson(text, store);
  assert.ok(out);
  assert.equal(out.confidence, "high");
  assert.deepEqual(out.basis, ["b1"]);
  assert.equal(out.phases.length, 4);
  assert.equal(out.phases[0].monthIndex, 1);
  assert.equal(out.phases[0].baseline, 20);
  assert.equal(out.phases[0].promotionBudget, 50); // 100 被 cap 50 裁
  assert.equal(out.phases[0].promotionOrders, 5);
  assert.deepEqual(out.phases[0].notes, ["阶段1"]);
});

test("parsePredictionJson: 非法 JSON 返回 null", () => {
  assert.equal(parsePredictionJson("不是 JSON", makeStore()), null);
  assert.equal(parsePredictionJson("", makeStore()), null);
});

test("parsePredictionJson: 缺少某阶段时用 baseOrderRange 兜底", () => {
  const store = makeStore();
  const base = baseOrderRange(store);
  const text = JSON.stringify({
    confidence: "medium",
    basis: [],
    sources: [],
    assumptions: [],
    missing: [],
    phases: [1, 2, 3].map((m) => ({
      monthIndex: m,
      conservative: m * 10,
      baseline: m * 20,
      optimistic: m * 30,
      promotionBudget: 0,
      promotionOrders: 0,
      notes: [],
    })),
  });

  const out = parsePredictionJson(text, store);
  assert.ok(out);
  assert.equal(out.phases.length, 4);
  const fourth = out.phases.find((p) => p.monthIndex === 4);
  assert.ok(fourth);
  assert.equal(fourth.baseline, base.baseline);
  assert.equal(fourth.conservative, base.conservative);
  assert.equal(fourth.optimistic, base.optimistic);
});

test("parsePredictionJson: 阶段数字乱序时用 baseOrderRange 兜底", () => {
  const store = makeStore();
  const base = baseOrderRange(store);
  const text = JSON.stringify({
    confidence: "medium",
    basis: [],
    sources: [],
    assumptions: [],
    missing: [],
    phases: [
      { monthIndex: 1, conservative: 100, baseline: 20, optimistic: 30, promotionBudget: 0, promotionOrders: 0, notes: [] },
      { monthIndex: 2, conservative: 10, baseline: 20, optimistic: 30, promotionBudget: 0, promotionOrders: 0, notes: [] },
      { monthIndex: 3, conservative: 10, baseline: 20, optimistic: 30, promotionBudget: 0, promotionOrders: 0, notes: [] },
      { monthIndex: 4, conservative: 10, baseline: 20, optimistic: 30, promotionBudget: 0, promotionOrders: 0, notes: [] },
    ],
  });

  const out = parsePredictionJson(text, store);
  assert.ok(out);
  const first = out.phases.find((p) => p.monthIndex === 1);
  assert.ok(first);
  assert.equal(first.conservative, base.conservative); // 100>20 乱序被兜底
  const second = out.phases.find((p) => p.monthIndex === 2);
  assert.ok(second);
  assert.equal(second.baseline, 20); // 正常阶段保留
});

function validPredictionInput(over: Record<string, unknown> = {}) {
  return {
    id: "p-123",
    createdAt: 123456,
    confidence: "high",
    basis: ["b1"],
    sources: ["https://example.com/a"],
    assumptions: ["a1"],
    missing: [],
    phases: [1, 2, 3, 4].map((m) => ({
      monthIndex: m,
      conservative: m * 10,
      baseline: m * 20,
      optimistic: m * 30,
      promotionBudget: m * 10,
      promotionOrders: m * 5,
      notes: [],
    })),
    ...over,
  };
}

test("sanitizePrediction: 合法完整预测保留 id/createdAt/confidence", () => {
  const out = sanitizePrediction(validPredictionInput(), makeStore());
  assert.ok(out);
  assert.equal(out.id, "p-123");
  assert.equal(out.createdAt, 123456);
  assert.equal(out.confidence, "high");
  assert.equal(out.phases.length, 4);
  assert.equal(out.phases[0].baseline, 20);
});

test("sanitizePrediction: 畸形输入返回 null", () => {
  const store = makeStore();
  const valid = validPredictionInput();
  const { phases: _phases, ...noPhases } = valid;
  assert.equal(sanitizePrediction(noPhases, store), null);
  assert.equal(sanitizePrediction({ ...valid, phases: "x" }, store), null);
  assert.equal(
    sanitizePrediction(
      { ...valid, phases: [{ ...valid.phases[0], monthIndex: 5 }] },
      store,
    ),
    null,
  );
});

test("sanitizePrediction: conservative > baseline 阶段回退 baseOrderRange", () => {
  const store = makeStore();
  const base = baseOrderRange(store);
  const phases = validPredictionInput().phases.map((p) =>
    p.monthIndex === 1 ? { ...p, conservative: 200, baseline: 20 } : p,
  );
  const out = sanitizePrediction(validPredictionInput({ phases }), store);
  assert.ok(out);
  const first = out.phases.find((p) => p.monthIndex === 1);
  assert.ok(first);
  assert.equal(first.conservative, base.conservative);
  assert.equal(first.baseline, base.baseline);
  assert.equal(first.optimistic, base.optimistic);
});

test("sanitizePrediction: promotionBudget 超出 cap 被裁剪", () => {
  const store = makeStore();
  store.profile = { ...store.profile, promotionBudgetCap: 50 };
  const phases = validPredictionInput().phases.map((p) =>
    p.monthIndex === 1 ? { ...p, promotionBudget: 500 } : p,
  );
  const out = sanitizePrediction(validPredictionInput({ phases }), store);
  assert.ok(out);
  assert.equal(out.phases[0].promotionBudget, 50);
});

test("parsePredictionJson: 非法 confidence 归 low", () => {
  const store = makeStore();
  const text = JSON.stringify({
    confidence: "certain",
    basis: [],
    sources: [],
    assumptions: [],
    missing: [],
    phases: [1, 2, 3, 4].map((m) => ({
      monthIndex: m,
      conservative: m,
      baseline: m * 2,
      optimistic: m * 3,
      promotionBudget: 0,
      promotionOrders: 0,
      notes: [],
    })),
  });
  const out = parsePredictionJson(text, store);
  assert.ok(out);
  assert.equal(out.confidence, "low");
});
