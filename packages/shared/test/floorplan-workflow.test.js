import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validatePlanWithRules, generatePlans } from "../../workflows/templates/floorplan-remodel/lib/generate.js";
import { renderStructure } from "../../workflows/templates/floorplan-remodel/lib/render.js";
import { roomTypeByLabel } from "../../workflows/templates/floorplan-remodel/lib/metrics.js";
import { buildMaskGrid, slideRefit, wallThickness, detectOpenings, mergeCollinearWalls, pickEntryDoor } from "../../workflows/templates/floorplan-remodel/lib/snap.js";

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

test("无比例尺时面积下限降级为告警", () => {
  const s = { ...structure, mmPerPx: undefined };
  const r = validatePlanWithRules({ title: "t", demolish: [], build: [], newRooms: [{ label: "独立马桶间", bbox: [0, 0, 10, 10] }] }, s, rules);
  assert.ok(r.warnings.some(w => w.includes("无比例尺")), JSON.stringify(r));
});

test("结构未确认时硬失败（retryable=false）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "floorplan-gate-"));
  fs.writeFileSync(path.join(dir, "structure.json"), JSON.stringify({ confirmed: false }));
  await assert.rejects(
    () => generatePlans("", "", 1, dir),
    (e) => {
      assert.strictEqual(e.retryable, false, `retryable 应为 false，实际 ${JSON.stringify(e)}`);
      return true;
    },
  );
});

test("新房间 bbox 中心在户型外告警", () => {
  const r = validatePlanWithRules({ title: "t", demolish: [], build: [], newRooms: [{ label: "书房", bbox: [400, 400, 500, 500] }] }, structure, rules);
  assert.ok(r.warnings.some(w => w.includes("户型外")), JSON.stringify(r));
});

test("滑搜救回平行错位的墙", () => {
  const pts = [];
  for (let x = 100; x <= 400; x += 2) for (let y = 296; y <= 304; y += 2) pts.push([x, y]);
  const w = { x1: 100, y1: 360, x2: 400, y2: 360 };
  assert.ok(slideRefit(w, pts, buildMaskGrid(pts), 80), "应救回");
  assert.ok(Math.abs(w.y1 - 300) <= 6 && Math.abs(w.y2 - 300) <= 6, JSON.stringify(w));
});

test("滑搜对无墙区域返回 false", () => {
  const w = { x1: 100, y1: 360, x2: 400, y2: 360 };
  assert.strictEqual(slideRefit(w, [], buildMaskGrid([]), 80), false);
});

test("墙厚区分厚外墙与薄内墙", () => {
  const thick = [], thin = [];
  for (let y = 100; y <= 300; y += 2) {
    for (let x = 44; x <= 56; x += 2) thick.push([x, y]);
    for (let x = 48; x <= 52; x += 2) thin.push([x, y]);
  }
  const wall = { x1: 50, y1: 100, x2: 50, y2: 300 };
  const tThick = wallThickness(wall, thick);
  const tThin = wallThickness(wall, thin);
  assert.ok(tThick >= 10 && tThin <= 6 && tThick > tThin, `thick=${tThick} thin=${tThin}`);
});

test("确认预览叠原图且带 w/d/r ID 芯片", () => {
  const s = {
    imgW: 1000, imgH: 700,
    walls: [{ id: "w1", x1: 0, y1: 0, x2: 500, y2: 0, bearing: true }],
    rooms: [{ id: "r1", label: "客厅", center: [250, 350], bbox: [0, 0, 500, 700] }],
    openings: [{ id: "d1", type: "door", wallId: "w1", pos: 0.5 }],
  };
  const plain = renderStructure(s);
  assert.ok(!plain.includes("<image href="), "无 img 时纯矢量");
  const overlaid = renderStructure(s, { base64: "iVBORw0KGgo=", mime: "image/png" });
  assert.ok(overlaid.includes("<image href=") && overlaid.includes('opacity="0.35"'), "叠半透明原图");
  assert.ok(!overlaid.includes(">客厅</text>"), "叠图时不重描房间名（原图自带）");
  assert.ok(overlaid.includes(">w1<") && overlaid.includes(">d1<") && overlaid.includes(">r1<"), "ID 芯片");
});

test("CV 门窗检测：蓝断口=窗、白断口=门、整墙窗断口删除", () => {
  const W = 240, H = 120, ch = 3;
  const data = Buffer.alloc(W * H * ch, 250);
  const px = (x, y, r, g, b) => { const k = (y * W + x) * ch; data[k] = r; data[k + 1] = g; data[k + 2] = b; };
  const pts = [];
  for (let x = 20; x <= 220; x += 2) {
    const inWin = x >= 80 && x <= 120;
    const inDoor = x >= 156 && x <= 192;
    if (inWin) { for (let y = 44; y <= 56; y++) for (let xx = x; xx < x + 2 && xx <= 120; xx++) px(xx, y, 120, 190, 220); continue; }
    if (inDoor) continue;
    for (let y = 46; y <= 54; y += 2) { px(x, y, 30, 30, 30); pts.push([x, y]); }
  }
  for (let t = 0; t <= 24; t += 2) px(160 + t, 62 + Math.round(Math.sqrt(Math.max(0, 900 - t * t)) / 3), 60, 60, 60);
  const img = { data, W, H, ch };
  const wall = { id: "w1", x1: 20, y1: 50, x2: 220, y2: 50 };
  const det = detectOpenings([wall], pts, img);
  const win = det.openings.find(o => o.type === "window");
  const door = det.openings.find(o => o.type === "door");
  assert.ok(win && win.pos > 0.25 && win.pos < 0.55, JSON.stringify(det.openings));
  assert.ok(door && door.pos > 0.65, JSON.stringify(det.openings));
  assert.strictEqual(det.drops.length, 0);
  const stub = { id: "w9", x1: 80, y1: 50, x2: 120, y2: 50 };
  assert.ok(detectOpenings([stub], pts, img).drops.includes("w9"), "整墙即窗断口应删除");
});

test("共线墙合并：跨门洞合一、远离不并", () => {
  const ws = [
    { id: "w1", x1: 50, y1: 20, x2: 50, y2: 200, bearing: true },
    { id: "w2", x1: 52, y1: 260, x2: 52, y2: 400, bearing: false },
    { id: "w3", x1: 50, y1: 600, x2: 50, y2: 700, bearing: false },
  ];
  const m = mergeCollinearWalls(ws, 6, 80);
  assert.strictEqual(m.length, 2, JSON.stringify(m));
  assert.strictEqual(m[0].y1, 20);
  assert.strictEqual(m[0].y2, 400);
  assert.strictEqual(m[0].bearing, true);
});

test("入户门=外围墙上的门，无外围门返回 null", () => {
  const walls = [{ id: "w1", x1: 50, y1: 0, x2: 50, y2: 500 }, { id: "w2", x1: 200, y1: 250, x2: 300, y2: 250 }];
  const ops = [{ id: "d1", type: "door", wallId: "w2", len: 40 }, { id: "d2", type: "door", wallId: "w1", len: 50 }];
  const extent = { left: 50, right: 450, top: 0, bottom: 500 };
  assert.strictEqual(pickEntryDoor(ops, walls, extent, 20), "d2");
  assert.strictEqual(pickEntryDoor([ops[0]], walls, extent, 20), null);
});

test("判型列连续度：门弧只在一端=门，通长中灰线=窗", () => {
  const W = 240, H = 120, ch = 3;
  const data = Buffer.alloc(W * H * ch, 250);
  const px = (x, y, g) => { const k = (y * W + x) * ch; data[k] = g; data[k + 1] = g; data[k + 2] = g; };
  const pts = [];
  for (let x = 20; x <= 220; x += 2) {
    const inDoor = x >= 80 && x <= 116;
    const inWin = x >= 156 && x <= 192;
    if (inDoor || inWin) {
      if (inWin) for (let y = 44; y <= 56; y++) px(x, y, 170);
      if (inDoor && x <= 92) for (let y = 44; y <= 56; y++) px(x, y, 150);
      continue;
    }
    for (let y = 46; y <= 54; y += 2) { px(x, y, 30); pts.push([x, y]); }
  }
  const det = detectOpenings([{ id: "w1", x1: 20, y1: 50, x2: 220, y2: 50 }], pts, { data, W, H, ch });
  const door = det.openings.find(o => o.pos < 0.5);
  const win = det.openings.find(o => o.pos > 0.5);
  assert.strictEqual(door?.type, "door", JSON.stringify(det.openings));
  assert.strictEqual(win?.type, "window", JSON.stringify(det.openings));
});

test("衣帽间/阳台不吃 bedroom 面积下限，电竞舱归 study", () => {
  assert.strictEqual(roomTypeByLabel("主卧衣帽间"), null);
  assert.strictEqual(roomTypeByLabel("主卧休闲阳台区"), null);
  assert.strictEqual(roomTypeByLabel("电竞舱（半卧半办公）"), "study");
  assert.strictEqual(roomTypeByLabel("儿童房（紧凑）"), "bedroom");
});

test("build 端点贴原图墙像素（mask）不算悬空", () => {
  const s = { imgW: 1000, rooms: [] };
  const plan = { title: "t", summary: "s", demolish: [], build: [{ x1: 100, y1: 100, x2: 300, y2: 100 }], newRooms: [] };
  const bare = validatePlanWithRules(plan, s, {});
  assert.ok(bare.errors.some(e => e.includes("悬空")), JSON.stringify(bare));
  const mask = [[100, 100], [200, 100], [300, 100]];
  const withMask = validatePlanWithRules(plan, s, {}, mask);
  assert.strictEqual(withMask.errors.length, 0, JSON.stringify(withMask));
});

test("面积近miss（≥60% 下限）降级告警不丢方案，远低于仍硬错误", () => {
  const near = validatePlanWithRules({ title: "t", summary: "s", demolish: [], build: [], newRooms: [{ label: "书房", bbox: [0, 0, 212, 212] }] }, structure, rules);
  assert.strictEqual(near.errors.length, 0, JSON.stringify(near));
  assert.ok(near.warnings.some(w => w.includes("仅示意")), JSON.stringify(near));
  const far = validatePlanWithRules({ title: "t", summary: "s", demolish: [], build: [], newRooms: [{ label: "书房", bbox: [0, 0, 100, 100] }] }, structure, rules);
  assert.ok(far.errors.some(e => e.includes("远低于")), JSON.stringify(far));
});
