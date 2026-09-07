import { test } from "node:test";
import assert from "node:assert";
import { validatePlanWithRules } from "../../workflows/templates/floorplan-remodel/lib/generate.js";

const rules = { minAreaM2: { bedroom: 9, study: 5, toilet: 2 } };
const structure = {
  imgW: 1000, mmPerPx: 10,
  walls: [
    { id: "w1", x1: 0, y1: 0, x2: 0, y2: 500, bearing: true },
    { id: "w2", x1: 0, y1: 0, x2: 500, y2: 0, bearing: false },
  ],
  rooms: [{ id: "r1", label: "卫生间", bbox: [0, 0, 100, 100] }],
  wetRooms: ["r1"],
};

test("零长度新墙被拦截", () => {
  const r = validatePlanWithRules({ title: "t", demolish: [], build: [{ x1: 100, y1: 100, x2: 100, y2: 100 }], newRooms: [] }, structure, rules);
  assert.ok(r.errors.some(e => e.includes("过短")), JSON.stringify(r));
});

test("拆承重墙被拦截", () => {
  const r = validatePlanWithRules({ title: "t", demolish: ["w1"], build: [], newRooms: [] }, structure, rules);
  assert.ok(r.errors.some(e => e.includes("承重")), JSON.stringify(r));
});

test("马桶间面积不足被拦截", () => {
  const r = validatePlanWithRules({ title: "t", demolish: [], build: [], newRooms: [{ label: "独立马桶间", bbox: [0, 0, 10, 10] }] }, structure, rules);
  assert.ok(r.errors.some(e => e.includes("面积")), JSON.stringify(r));
});

test("马桶间不邻湿区告警", () => {
  const r = validatePlanWithRules({ title: "t", demolish: [], build: [], newRooms: [{ label: "独立马桶间", bbox: [400, 400, 500, 500] }] }, structure, rules);
  assert.ok(r.warnings.some(w => w.includes("湿区")), JSON.stringify(r));
});

test("null 条目不抛异常并返回 errors/warnings 数组", () => {
  const r = validatePlanWithRules({ title: "t", demolish: [], build: [null], newRooms: [null] }, structure, rules);
  assert.ok(Array.isArray(r.errors), JSON.stringify(r));
  assert.ok(Array.isArray(r.warnings), JSON.stringify(r));
});
