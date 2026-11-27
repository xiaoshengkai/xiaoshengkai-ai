import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MerchantStore, StoreSnapshot, StoreScenario } from "../../ai-chat/src/lib/merchant-takeout/types";

// ponytail: 快照与店铺走不同目录，测试缝隙隔离真实 data/merchant-takeout
process.env.MERCHANT_TAKEOUT_DIR = mkdtempSync(path.join(tmpdir(), "merchant-takeout-"));
process.env.MERCHANT_TAKEOUT_SNAPSHOTS_DIR = mkdtempSync(path.join(tmpdir(), "merchant-takeout-snap-"));

const { createStore, readStore, writeStore } = await import(
  "../../ai-chat/src/lib/merchant-takeout/store"
);
const { createSnapshot, readSnapshot, listSnapshots, deleteSnapshot, copySnapshotToDraft } =
  await import("../../ai-chat/src/lib/merchant-takeout/snapshots");

test.after(() => {
  rmSync(process.env.MERCHANT_TAKEOUT_DIR!, { recursive: true, force: true });
  rmSync(process.env.MERCHANT_TAKEOUT_SNAPSHOTS_DIR!, { recursive: true, force: true });
});

function scenarios(): StoreScenario[] {
  return [
    {
      id: "sc1",
      label: "第1月",
      monthIndex: 1,
      naturalOrders: 100,
      promotionOrders: 20,
      totalOrders: 120,
      avgContributionProfit: 8,
      monthlyNetProfit: 500,
      breakevenOrders: 150,
      tax: 20,
    },
  ];
}

function makeSnapshot(input: MerchantStore, label = "快照A"): StoreSnapshot {
  return {
    id: randomUUID(),
    storeId: input.id,
    createdAt: Date.now(),
    label,
    input,
    scenarios: scenarios(),
  };
}

test("createSnapshot + readSnapshot 往返一致（input/scenarios 保留）", () => {
  const store = createStore("快照店");
  const snapshot = makeSnapshot(store, "第一版方案");

  const written = createSnapshot(snapshot);
  const read = readSnapshot(snapshot.id);

  assert.ok(read);
  assert.equal(read.id, snapshot.id);
  assert.equal(read.createdAt, snapshot.createdAt);
  assert.equal(read.label, "第一版方案");
  assert.equal(read.storeId, store.id);
  assert.equal(read.input.id, store.id);
  assert.equal(read.input.profile.name, "快照店");
  assert.deepEqual(read.scenarios, scenarios());
  assert.equal(written.id, snapshot.id);
});

test("listSnapshots 按 storeId 过滤且按 createdAt 倒序", async () => {
  const storeA = createStore("店A");
  const storeB = createStore("店B");

  const s1 = createSnapshot(makeSnapshot(storeA, "A-早"));
  await new Promise((r) => setTimeout(r, 10));
  const s2 = createSnapshot(makeSnapshot(storeA, "A-晚"));
  const s3 = createSnapshot(makeSnapshot(storeB, "B"));

  const all = listSnapshots();
  assert.ok(all.some((s) => s.id === s1.id && s.id === s1.id));
  assert.ok(all.length >= 3);

  const forA = listSnapshots(storeA.id);
  assert.deepEqual(
    forA.map((s) => s.id),
    [s2.id, s1.id],
  );

  const forB = listSnapshots(storeB.id);
  assert.deepEqual(
    forB.map((s) => s.id),
    [s3.id],
  );

  assert.deepEqual(listSnapshots(randomUUID()), []);
});

test("deleteSnapshot 删除后 read 返回 null", () => {
  const store = createStore("待删快照");
  const snapshot = createSnapshot(makeSnapshot(store));
  assert.equal(readSnapshot(snapshot.id)?.id, snapshot.id);
  assert.equal(deleteSnapshot(snapshot.id), true);
  assert.equal(readSnapshot(snapshot.id), null);
  assert.equal(deleteSnapshot(snapshot.id), false);
});

test("修改草稿不改变旧快照", () => {
  const store = createStore("旧名");
  const snapshot = createSnapshot(makeSnapshot(store));

  writeStore({ ...store, profile: { ...store.profile, name: "改名后" } });

  const read = readSnapshot(snapshot.id)!;
  assert.equal(read.input.profile.name, "旧名");
  assert.notEqual(readStore(store.id)!.profile.name, "旧名");
});

test("copySnapshotToDraft 生成新草稿并落盘", () => {
  const store = createStore("来源店");
  store.profile = { ...store.profile, availableCapital: 12345 };
  writeStore(store);
  const snapshot = createSnapshot(makeSnapshot(store, "待复制"));

  const draft = copySnapshotToDraft(snapshot.id, "复制的新店");
  assert.ok(draft);
  assert.notEqual(draft.id, store.id);
  assert.equal(draft.status, "simulation");
  assert.equal(draft.profile.name, "复制的新店");
  assert.equal(draft.profile.availableCapital, 12345);
  assert.ok(draft.createdAt >= snapshot.createdAt);
  assert.ok(draft.updatedAt >= draft.createdAt);

  const persisted = readStore(draft.id);
  assert.ok(persisted);
  assert.equal(persisted.id, draft.id);
  assert.equal(persisted.profile.name, "复制的新店");

  assert.equal(copySnapshotToDraft(randomUUID(), "不存在"), null);
});

test("非法 id 被拒绝（非 UUID）", () => {
  const store = createStore("合法店");
  assert.equal(readSnapshot("not-a-uuid"), null);
  assert.equal(deleteSnapshot("not-a-uuid"), false);
  assert.throws(() => createSnapshot({ ...makeSnapshot(store), id: "not-a-uuid" }), /非法/);
});
