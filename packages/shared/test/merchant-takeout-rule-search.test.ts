import test from "node:test";
import assert from "node:assert/strict";

import {
  isOfficial,
  rankSources,
  pickPrimary,
  mergeConflicts,
  applyReferencesToRules,
  type RuleReference,
} from "../../ai-chat/src/lib/merchant-takeout/rule-search";

import type { PlatformRules } from "../../ai-chat/src/lib/merchant-takeout/types";

function ref(partial: Partial<RuleReference> & { field: RuleReference["field"]; value: number | null }): RuleReference {
  return {
    sourceUrl: "https://example.com/rule",
    fetchedAt: 1000,
    conditions: [],
    confidence: "medium",
    official: false,
    ...partial,
  };
}

test("isOfficial: 淘宝/天猫/阿里系域名判真，其他判假", () => {
  assert.equal(isOfficial("https://www.taobao.com/rules"), true);
  assert.equal(isOfficial("https://rule.tmall.com/x"), true);
  assert.equal(isOfficial("https://www.alibaba.com/"), true);
  assert.equal(isOfficial("https://www.aliyun.com/"), true);
  assert.equal(isOfficial("https://example.com/taobao"), false);
});

test("isOfficial: 仿冒域名（evil-taobao.com / taobao.com.evil.com）判假，子域名判真", () => {
  assert.equal(isOfficial("https://evil-taobao.com/"), false);
  assert.equal(isOfficial("https://taobao.com.evil.com/"), false);
  assert.equal(isOfficial("https://www.taobao.com/"), true);
  assert.equal(isOfficial("https://tmall.com/"), true);
});

test("rankSources: 官方优先 → 地区越具体越前 → 发布时间越新越前", () => {
  const a = ref({ field: "commissionRate", value: 1, sourceUrl: "https://example.com/a", official: false, region: "", publishedAt: "2025-01-01" });
  const b = ref({ field: "commissionRate", value: 1, sourceUrl: "https://taobao.com/b", official: true, region: "", publishedAt: "2025-01-01" });
  const c = ref({ field: "commissionRate", value: 1, sourceUrl: "https://taobao.com/c", official: true, region: "杭州", publishedAt: "2025-01-01" });
  const d = ref({ field: "commissionRate", value: 1, sourceUrl: "https://taobao.com/d", official: true, region: "浙江杭州", publishedAt: "2025-01-01" });
  const e = ref({ field: "commissionRate", value: 1, sourceUrl: "https://taobao.com/e", official: true, region: "浙江杭州", publishedAt: "2025-02-01" });

  const ranked = rankSources([a, b, c, d, e]);
  assert.deepEqual(
    ranked.map((r) => r.sourceUrl),
    ["https://taobao.com/e", "https://taobao.com/d", "https://taobao.com/c", "https://taobao.com/b", "https://example.com/a"],
  );
});

test("pickPrimary: 排序后取首个 value != null，全 null 返回 null", () => {
  const withValue = ref({ field: "commissionRate", value: 5, official: true });
  const nullValue = ref({ field: "commissionRate", value: null, official: true });
  assert.equal(pickPrimary([nullValue, withValue], "commissionRate")?.value, 5);
  assert.equal(pickPrimary([nullValue], "commissionRate"), null);
  assert.equal(pickPrimary([withValue], "fixedServiceFee"), null);
});

test("mergeConflicts: 单一值返回空，多值返回含“冲突”摘要", () => {
  const one = [ref({ field: "commissionRate", value: 5, sourceUrl: "https://a.com" })];
  assert.equal(mergeConflicts(one, "commissionRate"), "");

  const two = [
    ref({ field: "commissionRate", value: 5, sourceUrl: "https://a.com", sourceTitle: "A", unit: "%" }),
    ref({ field: "commissionRate", value: 8, sourceUrl: "https://b.com", sourceTitle: "B", unit: "%" }),
    ref({ field: "commissionRate", value: 5, sourceUrl: "https://c.com", sourceTitle: "C", unit: "%" }),
  ];
  const note = mergeConflicts(two, "commissionRate");
  assert.ok(note.includes("冲突"));
  assert.ok(note.includes("5") && note.includes("8"));
});

test("applyReferencesToRules: 扣点 % 转小数、费用保数值、null 不改、confirmed 置 false、source 填充、基数字段保留", () => {
  const current: PlatformRules = {
    platform: "taobao-flash",
    commissionRate: 0.3,
    commissionBase: { includeProduct: true, includePackagingFee: true, includeDeliveryFee: true },
    discountBeforeCommission: true,
    confirmed: true,
    source: {},
  };

  const refs = [
    ref({
      field: "commissionRate",
      value: 5,
      unit: "%",
      sourceUrl: "https://taobao.com/rate",
      publishedAt: "2025-03-01",
      region: "杭州",
      confidence: "high",
      official: true,
    }),
    ref({
      field: "fixedServiceFee",
      value: 2.5,
      unit: "元/单",
      sourceUrl: "https://taobao.com/fee",
      official: true,
    }),
    ref({ field: "customerDeliveryFee", value: null, sourceUrl: "https://taobao.com/null" }),
  ];

  const out = applyReferencesToRules(refs, current);

  assert.equal(out.commissionRate, 0.05);
  assert.equal(out.fixedServiceFee, 2.5);
  assert.equal(out.confirmed, false);
  assert.equal(out.source.sourceUrl, "https://taobao.com/rate");
  assert.equal(out.source.confidence, "high");
  assert.deepEqual(out.commissionBase, current.commissionBase);
  assert.equal(out.discountBeforeCommission, true);
  assert.equal(out.platform, "taobao-flash");
  // 不可变：原对象未被改动
  assert.equal(current.commissionRate, 0.3);
  assert.equal(current.confirmed, true);
});

test("applyReferencesToRules: 全 null 引用时字段保持原值、source 不变", () => {
  const current: PlatformRules = {
    platform: "taobao-flash",
    commissionRate: 0.3,
    commissionBase: { includeProduct: true, includePackagingFee: false, includeDeliveryFee: false },
    discountBeforeCommission: false,
    confirmed: true,
    source: {},
  };
  const out = applyReferencesToRules([ref({ field: "commissionRate", value: null })], current);
  assert.equal(out.commissionRate, 0.3);
  assert.deepEqual(out.source, {});
});
