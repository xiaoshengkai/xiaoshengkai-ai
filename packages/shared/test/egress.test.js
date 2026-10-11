import { test } from "node:test";
import assert from "node:assert/strict";
import { isCorpHost, readEgressConfig } from "../egress.js";

test("isCorpHost: 精确匹配", () => {
  assert.equal(isCorpHost("yapi.cai-inc.com", ["yapi.cai-inc.com"]), true);
  assert.equal(isCorpHost("other.cai-inc.com", ["yapi.cai-inc.com"]), false);
});

test("isCorpHost: .后缀匹配（含裸域）", () => {
  assert.equal(isCorpHost("yapi.cai-inc.com", [".cai-inc.com"]), true);
  assert.equal(isCorpHost("a.b.cai-inc.com", [".cai-inc.com"]), true);
  assert.equal(isCorpHost("cai-inc.com", [".cai-inc.com"]), true);
  assert.equal(isCorpHost("cai-inc.com.evil.com", [".cai-inc.com"]), false);
});

test("isCorpHost: CIDR 匹配", () => {
  assert.equal(isCorpHost("172.16.101.1", ["172.16.0.0/12"]), true);
  assert.equal(isCorpHost("172.32.0.1", ["172.16.0.0/12"]), false);
  assert.equal(isCorpHost("yapi.cai-inc.com", ["172.16.0.0/12"]), false);
});

test("isCorpHost: 大小写/尾点/空项/注释归一", () => {
  assert.equal(isCorpHost("YAPI.CAI-INC.COM.", [".cai-inc.com"]), true);
  assert.equal(isCorpHost("x.com", ["", "  ", "#note", "x.com"]), true);
  assert.equal(isCorpHost("", ["x.com"]), false);
});

test("readEgressConfig: 缺文件返回默认（关）", () => {
  const cfg = readEgressConfig();
  assert.equal(typeof cfg.enabled, "boolean");
  assert.ok(Array.isArray(cfg.whitelist));
  assert.equal(typeof cfg.proxy, "string");
});
