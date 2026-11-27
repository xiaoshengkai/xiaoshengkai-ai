import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ponytail: MERCHANT_TAKEOUT_DIR 测试缝隙，隔离真实 data/merchant-takeout
process.env.MERCHANT_TAKEOUT_DIR = mkdtempSync(path.join(tmpdir(), "merchant-takeout-"));

const { createStore, readStore, writeStore, listStores, deleteStore } = await import(
  "../../ai-chat/src/lib/merchant-takeout/store"
);

test.after(() => {
  rmSync(process.env.MERCHANT_TAKEOUT_DIR!, { recursive: true, force: true });
});

test("create → read 往返一致，默认 status=simulation", () => {
  const s = createStore("我的小店");
  const read = readStore(s.id);
  assert.ok(read);
  assert.equal(read.id, s.id);
  assert.equal(read.profile.name, "我的小店");
  assert.equal(read.status, "simulation");
  assert.equal(read.createdAt, s.createdAt);
});

test("write 保留 createdAt、刷新 updatedAt", () => {
  const s = createStore("店A");
  const first = readStore(s.id)!;
  const firstCreated = first.createdAt;

  // 传脏 createdAt/updatedAt，验证 writeStore 保留已有 createdAt、忽略传入的旧 updatedAt
  writeStore({ ...first, createdAt: 1, updatedAt: 1, profile: { ...first.profile, name: "改名" } });

  const second = readStore(s.id)!;
  assert.equal(second.profile.name, "改名");
  assert.equal(second.createdAt, firstCreated);
  assert.ok(second.updatedAt > 1);
});

test("list 按 updatedAt 倒序", async () => {
  const a = createStore("A");
  await new Promise((r) => setTimeout(r, 10));
  const b = createStore("B");
  const list = listStores().filter((s) => s.id === a.id || s.id === b.id);
  assert.equal(list[0].id, b.id);
  assert.equal(list[1].id, a.id);
});

test("delete 删除后 read 返回 null", () => {
  const s = createStore("待删");
  assert.equal(readStore(s.id)?.id, s.id);
  assert.equal(deleteStore(s.id), true);
  assert.equal(readStore(s.id), null);
  assert.equal(deleteStore(s.id), false);
});

test("非法 id 被拒绝（非 UUID）", () => {
  const s = createStore("合法");
  assert.equal(readStore("not-a-uuid"), null);
  assert.throws(() => writeStore({ ...s, id: "not-a-uuid" }), /非法/);
  assert.equal(deleteStore("not-a-uuid"), false);
});

test("路径穿越被拒绝", () => {
  const s = createStore("合法");
  const traversal = "../../../etc/passwd";
  assert.equal(readStore(traversal), null);
  assert.throws(() => writeStore({ ...s, id: traversal }));
  assert.equal(deleteStore(traversal), false);
});
