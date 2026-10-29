import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { parkedStatusAfter, runNextStep } from "../../workflows/engine.js";
import { DATA_DIR } from "../../workflows/lib/state.js";
import { redactPhone, phoneTail, savePrivate, readPrivate, normalizePhone } from "../../workflows/templates/person-research/lib/privacy.js";
import { initResearch, updateResearch, allocSourceIds, allocClaimIds, writeReport, loadSources, saveSource } from "../../workflows/templates/person-research/lib/store.js";
import { buildDiscoveryQueries, buildBusinessQueries, buildExpansionQueries } from "../../workflows/templates/person-research/lib/queries.js";
import { canonicalUrl, sameSource, domainOf, domainClass } from "../../workflows/templates/person-research/lib/normalize.js";
import { CONFIG } from "../../workflows/templates/person-research/lib/config.js";
import { scoreSource, partitionSources, markLead } from "../../workflows/templates/person-research/lib/relevance.js";
import { buildClusterPrompt, validateClusterOutput, validateIntentOutput, validateReportCitations, validateBusinessOutput, buildReportPrompt, validateCorrectionOutput, validateBoundaryReviewOutput } from "../../workflows/templates/person-research/lib/prompts.js";
import { applyExtract, mergeBusinessRelations, recomputeBusinessStatus, applyCorrection, applyCandidateRejection, reIdCandidates } from "../../workflows/templates/person-research/lib/evidence.js";
import { applySelectInState, applyContinueInState, applyCandidateRejectInState, applyClaimRejectInState } from "../../workflows/templates/person-research/lib/handlers.js";
import { generateReport } from "../../workflows/templates/person-research/lib/report.js";

test("parkedStatusAfter: awaitInput 非末步停靠，末步/无标记为 null", () => {
  assert.equal(parkedStatusAfter({ awaitInput: true }, false), "awaiting_input");
  assert.equal(parkedStatusAfter({ awaitInput: true }, true), null);
  assert.equal(parkedStatusAfter({ id: "discovery" }, false), null);
  assert.equal(parkedStatusAfter(null, false), null);
});

test("runNextStep: awaiting_input 状态拒绝执行（可被 select/continue 重臂恢复）", async () => {
  const executionId = `test-park-${Date.now()}`;
  const execDir = path.join(DATA_DIR, executionId);
  mkdirSync(execDir, { recursive: true });
  writeFileSync(path.join(execDir, "state.json"), JSON.stringify({
    executionId,
    template: "comic-generation",
    status: "awaiting_input",
    steps: [
      { id: "script", status: "completed", output: null, error: null },
      { id: "generate-pages", status: "pending", output: null, error: null },
    ],
  }));

  try {
    const result = await runNextStep(executionId);
    assert.equal(result.ok, false);
    assert.equal(result.error, "等待用户输入中");
    // 拒绝路径不得污染状态
    const state = JSON.parse(fs.readFileSync(path.join(execDir, "state.json"), "utf-8"));
    assert.equal(state.status, "awaiting_input");
    assert.equal(state.steps[1].status, "pending");
  } finally {
    rmSync(execDir, { recursive: true, force: true });
  }
});

// ─── privacy ──────────────────────────────────────────────────────

test("redactPhone: 手机号脱敏为 1****尾4位，非手机号数字串与嵌入长数字串不动", () => {
  assert.equal(redactPhone("电话13812345678联系"), "电话1****5678联系");
  assert.equal(redactPhone("12345678901"), "12345678901");
  assert.equal(redactPhone("订单913812345678"), "订单913812345678");
  assert.equal(redactPhone(null), null);
  assert.equal(redactPhone("无号码文本"), "无号码文本");
});

test("phoneTail / savePrivate / readPrivate 回读", () => {
  assert.equal(phoneTail("13812345678"), "5678");
  assert.equal(phoneTail(""), "");
  const dir = mkdtempSync(path.join(tmpdir(), "pr-privacy-"));
  try {
    savePrivate(dir, { phone: "13812345678" });
    assert.equal(readPrivate(dir).phone, "13812345678");
    assert.deepEqual(readPrivate(path.join(dir, "不存在")), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalizePhone: 合法归一 11 位，占位符/垃圾归空串", () => {
  assert.equal(normalizePhone("+86 138-1234-5678"), "13812345678");
  assert.equal(normalizePhone("13812345678"), "13812345678");
  assert.equal(normalizePhone("{phone}"), "");
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone("12345"), "");
});

// ─── store ────────────────────────────────────────────────────────

function makeExecDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "pr-store-"));
  writeFileSync(path.join(dir, "state.json"), JSON.stringify({
    executionId: path.basename(dir),
    template: "person-research",
    status: "pending",
    steps: [],
  }));
  return dir;
}

test("store: init/alloc/版本递增/来源落盘", () => {
  const dir = makeExecDir();
  try {
    initResearch(dir, { name: "张三", clues: { city: "杭州" } });
    assert.deepEqual(allocSourceIds(dir, 3), ["s-1", "s-2", "s-3"]);
    assert.deepEqual(allocClaimIds(dir, 2), ["c-1", "c-2"]);
    assert.deepEqual(allocSourceIds(dir, 1), ["s-4"]);

    assert.equal(writeReport(dir, "# v1"), 1);
    assert.equal(writeReport(dir, "# v2"), 2);
    assert.ok(fs.existsSync(path.join(dir, "report", "v001.md")));
    assert.equal(fs.readFileSync(path.join(dir, "report", "current.md"), "utf-8"), "# v2");

    saveSource(dir, { id: "s-1", url: "https://a.com", title: "t" });
    assert.equal(loadSources(dir).length, 1);
    assert.equal(loadSources(path.join(dir, "sources")).length, 0);

    updateResearch(dir, { pendingRound: { input: "继续" } });
    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf-8"));
    assert.equal(state.research.pendingRound.input, "继续");
    assert.equal(state.research.reportVersion, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── queries ──────────────────────────────────────────────────────

test("buildDiscoveryQueries: 无线索仍有姓名基线查询；高区分度线索优先；无重复", () => {
  const basic = buildDiscoveryQueries({ name: "张三" });
  assert.ok(basic.length >= 3);
  assert.ok(basic.every(q => q.query.includes("张三")));
  assert.ok(basic.length <= CONFIG.DISCOVERY_MAX_QUERIES);

  const qs = new Set(basic.map(q => q.query));
  assert.equal(qs.size, basic.length);

  const rich = buildDiscoveryQueries({ name: "张三", phone: "13812345678", city: "杭州", school: "北大", company: "某公司" });
  assert.ok(rich.some(q => q.reason === "phone-match" && q.query.includes("13812345678")));
  assert.ok(rich.some(q => q.reason === "clue-school" && q.query.includes("北大")));
  assert.ok(rich.some(q => q.reason === "clue-company"));
  // 高区分度查询排在泛查询（新闻/采访）之前
  assert.ok(rich.findIndex(q => q.reason === "phone-match") < rich.findIndex(q => q.reason === "news"));
});

// ─── normalize ────────────────────────────────────────────────────

test("canonicalUrl: 追踪参/hash/大小写/尾斜杠归一", () => {
  assert.equal(
    canonicalUrl("https://A.com/x/?utm_source=g&r=2#top"),
    canonicalUrl("https://a.com/x?r=2"),
  );
  assert.equal(sameSource("https://a.com/x", "https://a.com/x/"), true);
  assert.equal(sameSource("https://a.com/x", "https://a.com/y"), false);
  assert.equal(domainOf("https://News.Example.COM/a"), "news.example.com");
});

test("domainClass: A 政府/学校，B 媒体，C 平台聚合，D 论坛", () => {
  assert.equal(domainClass("www.gov.cn"), "A");
  assert.equal(domainClass("pku.edu.cn"), "A");
  assert.equal(domainClass("mp.weixin.qq.com"), "C");
  assert.equal(domainClass("www.thepaper.cn"), "B");
  assert.equal(domainClass("tieba.baidu.com"), "D");
  assert.equal(domainClass("unknown-random.site"), "C");
  assert.equal(domainClass(""), "D");
});

// ─── prompts 校验器 ───────────────────────────────────────────────

const PROMPT_SOURCES = [
  { id: "s-1", title: "页面一", domain: "a.com", url: "https://a.com/1", content: "张三曾任某公司 CTO，电话 13812345678。" },
  { id: "s-2", title: "页面二", domain: "b.com", url: "https://b.com/2", content: "另一段。" },
  { id: "s-3", title: "页面三", domain: "c.com", url: "https://c.com/3", content: "第三段。" },
];

test("validateClusterOutput: 软剔除非法项，手机号脱敏，合法项保留", () => {
  const out = validateClusterOutput({
    candidates: [
      { id: "a1", displayName: "张三·某公司CTO", identitySummary: "简介", sourceIds: ["s-1"], confidence: "medium", reason: "姓名公司一致" },
      { id: "a1", displayName: "重复 id 候选", sourceIds: ["s-1"], confidence: "low" },
      { id: "a2", displayName: "引用越界", sourceIds: ["s-99"], confidence: "low" },
      { id: "a3", displayName: "confidence 非法", sourceIds: ["s-2"], confidence: "extreme" },
    ],
    claims: [
      { claim: "张三任 CTO", candidateId: "a1", quote: "张三曾任某公司 CTO，电话 13812345678。", sourceIds: ["s-1"] },
      { claim: "quote 超长", candidateId: "a1", quote: "超".repeat(CONFIG.QUOTE_MAX + 1), sourceIds: ["s-1"] },
      { claim: "来源越界", candidateId: "a1", quote: "引用不存在的来源", sourceIds: ["s-99"] },
      { claim: "候选越界", candidateId: "aX", quote: "候选不存在", sourceIds: ["s-2"] },
    ],
    irrelevantSourceIds: ["s-3", "s-99"],
  }, PROMPT_SOURCES);

  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].id, "a1");
  assert.equal(out.claims.length, 1);
  assert.ok(out.claims[0].quote.includes("1****5678"));
  assert.ok(!out.claims[0].quote.includes("13812345678"));
  assert.deepEqual(out.irrelevantSourceIds, ["s-3"]);
});

test("validateClusterOutput: 非 JSON 对象返回空结构不抛错", () => {
  const out = validateClusterOutput(null, PROMPT_SOURCES);
  assert.deepEqual(out, { candidates: [], claims: [], irrelevantSourceIds: [] });
});

test("validateIntentOutput: 空查询报错，超限截断，去空白", () => {
  const bad = validateIntentOutput({ intent: "x", queries: [] });
  assert.ok(bad.errors.length === 1);

  const ok = validateIntentOutput({ intent: "查教育", queries: [" 张三 北大 ", "", ...Array.from({ length: 8 }, (_, i) => `q${i}`)] });
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.value.queries.length, CONFIG.RESEARCH_MAX_QUERIES);
  assert.equal(ok.value.queries[0], "张三 北大");
});

test("validateReportCitations: 有效 [S#] 保留，无效删除并计数", () => {
  const { md, invalidCount } = validateReportCitations(
    "结论一 [S1] 结论二 [S2] 结论三 [S9]",
    PROMPT_SOURCES,
  );
  assert.equal(md, "结论一 [S1] 结论二 [S2] 结论三 ");
  assert.equal(invalidCount, 1);
});

test("buildClusterPrompt: 含姓名/手机号/来源 id 与正文截断", () => {
  const { system, user } = buildClusterPrompt(
    { name: "张三", phone: "13812345678", clues: { city: "杭州" } },
    PROMPT_SOURCES,
  );
  assert.ok(user.includes("张三"));
  assert.ok(user.includes("13812345678"));
  assert.ok(user.includes("杭州"));
  assert.ok(user.includes("[s-1]"));
  assert.ok(user.includes("张三曾任某公司 CTO"));
  assert.ok(system.includes(String(CONFIG.QUOTE_MAX)));
});

// ─── evidence.applyExtract ────────────────────────────────────────

const SOURCE_MAP = new Map([
  ["s-1", { id: "s-1", domain: "a.com" }],
  ["s-2", { id: "s-2", domain: "b.com" }],
  ["s-3", { id: "s-3", domain: "a.com" }],
  ["s-7", { id: "s-7", domain: "d.com" }],
  ["s-8", { id: "s-8", domain: "e.com" }],
]);

const BASE_CLAIMS = [
  { id: "c-1", claim: "张三任 CTO", quote: "q", sourceIds: ["s-1"], candidateId: "a1", publishedAt: null, observedAt: null, status: "single_source", conflicts: [] },
];

test("applyExtract: 两独立域名升级 supported，同域名仍 single_source", () => {
  const { claims } = applyExtract(BASE_CLAIMS, {
    newClaims: [], conflicts: [],
    updates: [{ claimId: "c-1", addSourceIds: ["s-2"] }],
  }, SOURCE_MAP, { newClaimIds: [], conflictClaimIds: [], candidateId: "a1", observedAt: "t" });
  assert.equal(claims[0].status, "supported");
  assert.deepEqual(claims[0].sourceIds, ["s-1", "s-2"]);

  const sameDomain = applyExtract(BASE_CLAIMS, {
    newClaims: [], conflicts: [],
    updates: [{ claimId: "c-1", addSourceIds: ["s-3"] }],
  }, SOURCE_MAP, { newClaimIds: [], conflictClaimIds: [], candidateId: "a1", observedAt: "t" });
  assert.equal(sameDomain.claims[0].status, "single_source");
});

test("applyExtract: conflicts 生成 conflicting 主张并双向引用", () => {
  const { claims, newClaimIds } = applyExtract(BASE_CLAIMS, {
    newClaims: [{ claim: "新主张", quote: "摘录", sourceIds: ["s-7"], publishedAt: null }],
    updates: [],
    conflicts: [{ claim: "相反说法", note: "与 c-1 冲突：页面称其为 CEO", sourceIds: ["s-8"], claimIds: ["c-1"] }],
  }, SOURCE_MAP, { newClaimIds: ["c-2"], conflictClaimIds: ["c-3"], candidateId: "a1", observedAt: "t" });

  assert.equal(claims.length, 3);
  const orig = claims.find(c => c.id === "c-1");
  const conflict = claims.find(c => c.id === "c-3");
  const added = claims.find(c => c.id === "c-2");
  assert.equal(conflict.status, "conflicting");
  assert.deepEqual(orig.conflicts, ["c-3"]);
  assert.deepEqual(conflict.conflicts, ["c-1"]);
  assert.equal(conflict.quote, "与 c-1 冲突：页面称其为 CEO");
  assert.equal(added.status, "single_source");
  assert.deepEqual(newClaimIds, ["c-2", "c-3"]);
});

// ─── report ───────────────────────────────────────────────────────

test("generateReport: 无主张走模板分支（不调 LLM）并版本化落盘", async () => {
  const dir = makeExecDir();
  try {
    initResearch(dir, { name: "张三", clues: {} });
    updateResearch(dir, { candidates: [], rounds: [{ id: "r-1", n: 1, kind: "discovery", input: null, queryCount: 3, newSourceIds: [], newClaimIds: [], at: "t" }] });

    const result = await generateReport("张三", dir);
    assert.equal(result.version, 1);
    assert.equal(result.claims, 0);
    const md = fs.readFileSync(path.join(dir, "report", "current.md"), "utf-8");
    assert.ok(md.startsWith("# 研究报告：张三"));
    assert.ok(md.includes("暂无可核查的公开信息主张"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── handlers.applyXxxInState ─────────────────────────────────────

function makeResearchState() {
  return {
    template: "person-research",
    status: "awaiting_input",
    steps: [
      { id: "discovery", status: "completed", output: {}, error: null },
      { id: "research", status: "pending", output: null, error: null, startedAt: "x", elapsed: "1" },
      { id: "report", status: "pending", output: null, error: null },
    ],
    research: {
      name: "张三",
      clues: {},
      candidates: [
        { id: "a1", displayName: "张三·某公司", status: "unconfirmed", confidence: "medium" },
        { id: "a2", displayName: "张三·其他", status: "selected", confidence: "low" },
      ],
      pendingRound: null,
    },
  };
}

test("applySelectInState: 选定置 pendingRound 并重臂步骤，排他不触发", () => {
  const state = makeResearchState();
  const result = applySelectInState(state, { candidateId: "a1", action: "selected" });
  assert.equal(result.ok, true);
  assert.equal(result.status, "running");
  assert.equal(state.research.candidates.find(c => c.id === "a1").status, "selected");
  assert.equal(state.research.candidates.find(c => c.id === "a2").status, "unconfirmed");
  assert.ok(state.research.pendingRound.input.includes("张三·某公司"));
  assert.equal(state.status, "running");
  assert.equal(state.steps[1].startedAt, null);

  const state2 = makeResearchState();
  const rejected = applySelectInState(state2, { candidateId: "a1", action: "rejected" });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.status, "awaiting_input");
  assert.equal(state2.status, "awaiting_input");
  assert.equal(state2.research.pendingRound, null);
});

test("applySelectInState: 候选不存在 / action 非法 / research 未初始化", () => {
  const state = makeResearchState();
  assert.equal(applySelectInState(state, { candidateId: "aX", action: "selected" }).ok, false);
  assert.equal(applySelectInState(state, { candidateId: "a1", action: "confirmed" }).ok, false);
  const bare = { template: "person-research", steps: [] };
  assert.equal(applySelectInState(bare, { candidateId: "a1", action: "selected" }).ok, false);
});

test("applyContinueInState: 输入落 pendingRound，空输入拒绝", () => {
  const state = makeResearchState();
  const result = applyContinueInState(state, "继续查他在杭州的教育经历");
  assert.equal(result.ok, true);
  assert.equal(state.research.pendingRound.input, "继续查他在杭州的教育经历");
  assert.equal(state.status, "running");
  assert.equal(state.steps[2].status, "pending");

  assert.equal(applyContinueInState(makeResearchState(), "  ").ok, false);
});

test("applySelectInState: 选定触发商业调查轮；continue 商业意图检测", () => {
  const state = makeResearchState();
  applySelectInState(state, { candidateId: "a1", action: "selected" });
  assert.equal(state.research.pendingRound.business, true);
  assert.equal(state.research.pendingRound.source, "selection");

  const biz = makeResearchState();
  applyContinueInState(biz, "查他名下公司股东关系");
  assert.equal(biz.research.pendingRound.business, true);
  assert.equal(biz.research.pendingRound.source, "continue");

  const career = makeResearchState();
  applyContinueInState(career, "继续查任职与公司关系");
  assert.equal(career.research.pendingRound.business, false);
});

test("applyContinueInState: 深挖意图检测", () => {
  const deep = makeResearchState();
  applyContinueInState(deep, "深挖更多相关线索");
  assert.equal(deep.research.pendingRound.deep, true);
  assert.equal(deep.research.pendingRound.business, false);

  const normal = makeResearchState();
  applyContinueInState(normal, "继续查教育经历");
  assert.equal(normal.research.pendingRound.deep, false);
});

// ─── V1.1 相关性漏斗 ──────────────────────────────────────────────

const RCTX = { name: "张三", phone: null, knownUrl: null, clues: { school: "某大学", company: "某公司", city: null } };

test("scoreSource: 姓名/线索/锚点/来源等级计分，姓名取最高档不叠加", () => {
  // 姓名在标题 +5，某大学 A 级 +2 → 7 直接保留
  const a = scoreSource({ title: "张三的主页", url: "https://x.edu.cn/p", snippet: "教师简介" }, RCTX);
  assert.equal(a.score, 7);
  assert.ok(a.matchedSignals.includes("name-title"));

  // 姓名标题(+5) 与摘要(+4) 同时出现 → 只取标题档
  const b = scoreSource({ title: "张三的主页", url: "https://a.com/p", snippet: "张三的简介" }, RCTX);
  assert.equal(b.score, 5);

  // 无姓名，仅线索（公司）→ +3 边界
  const c = scoreSource({ title: "某公司团队", url: "https://a.com/t", snippet: "某公司介绍" }, RCTX);
  assert.equal(c.score, 3);
  assert.ok(c.matchedSignals.includes("clue"));

  // 无姓名无线索 → 0 丢弃
  const d = scoreSource({ title: "泛财经列表", url: "https://a.com/l", snippet: "股东持股明细" }, RCTX);
  assert.equal(d.score, 0);

  // 手机号锚点 +8（叠加姓名标题 +5 = 13）
  const e = scoreSource({ title: "张三的联系页", url: "https://a.com/c", snippet: "电话 13812345678" }, { ...RCTX, phone: "13812345678" });
  assert.equal(e.score, 13);
  assert.ok(e.matchedSignals.includes("phone"));

  // 已知 URL 前缀命中 +8
  const f = scoreSource({ title: "随便什么", url: "https://fb.com/xiaoshengkai/photos", snippet: "无姓名" }, { name: "张三", phone: null, knownUrl: "https://fb.com/xiaoshengkai", clues: {} });
  assert.ok(f.matchedSignals.includes("known-url"));
});

test("partitionSources: ≥6 direct / 3~5 boundary / <3 dropped，携带 relevanceScore", () => {
  const { direct, boundary, dropped } = partitionSources([
    { title: "张三的主页", url: "https://x.edu.cn/p", snippet: "教师简介" },          // 7
    { title: "张三的页面", url: "https://a.com/p", snippet: "张三简介" },             // 5
    { title: "某公司团队", url: "https://a.com/t", snippet: "某公司介绍" },           // 3
    { title: "泛财经列表", url: "https://a.com/l", snippet: "股东持股明细" },         // 0
  ], RCTX);
  assert.equal(direct.length, 1);
  assert.equal(boundary.length, 2);
  assert.equal(dropped.length, 1);
  assert.equal(direct[0].relevanceScore, 7);
  assert.ok(Array.isArray(direct[0].matchedSignals));
});

test("markLead: 聚合站线索标注 evidenceUse=lead_only", () => {
  const lead = markLead({ title: "某投资企业 - 企查查", url: "https://m.qcc.com/firm/x", snippet: "股东信息" });
  assert.equal(lead.evidenceUse, "lead_only");
  assert.equal(lead.relevanceDecision, "lead");
  assert.ok(lead.matchedSignals.includes("aggregator"));
});

test("buildExpansionQueries: 精确名换引擎 + 线索变体，无泛查询，≤上限", () => {
  const qs = buildExpansionQueries({ name: "张三", school: "某大学", company: "某公司", city: null, focus: null });
  const list = qs.map(q => q.query);
  assert.equal(list[0], '"张三"');
  assert.ok(list.some(q => q.includes("某大学")));
  assert.ok(list.some(q => q.includes("某公司")));
  assert.ok(qs.every(q => q.reason === "expansion"));
  assert.ok(qs.length <= CONFIG.EXPANSION_MAX_QUERIES);

  // 无任何线索：只剩精确名一条（仍有价值——换引擎重查）
  const bare = buildExpansionQueries({ name: "张三" });
  assert.deepEqual(bare.map(q => q.query), ['"张三"']);
});

test("validateBoundaryReviewOutput: 三态判定软校验，越界/重复/非法剔除", () => {
  const sources = [
    { id: "b-1", title: "张三 某大学", url: "https://a.com/1", snippet: "s" },
    { id: "b-2", title: "张三的其他页面", url: "https://a.com/2", snippet: "s" },
    { id: "b-3", title: "无关页", url: "https://a.com/3", snippet: "s" },
  ];
  const out = validateBoundaryReviewOutput({
    reviews: [
      { sourceId: "b-1", decision: "relevant", candidateKey: "某大学-某公司", matchedSignals: ["name", "school"], reason: "姓名学校吻合" },
      { sourceId: "b-2", decision: "other_person", reason: "同名不同人" },
      { sourceId: "b-3", decision: "irrelevant", reason: "泛列表" },
      { sourceId: "b-99", decision: "relevant", reason: "越界剔除" },
      { sourceId: "b-1", decision: "irrelevant", reason: "重复剔除" },
      { sourceId: "b-2", decision: "unknown_state", reason: "非法枚举剔除" },
    ],
  }, sources);
  assert.equal(out.length, 3);
  assert.equal(out[0].decision, "relevant");
  assert.equal(out[0].candidateKey, "某大学-某公司");
  assert.equal(out[1].decision, "other_person");
  assert.equal(out[2].decision, "irrelevant");
  assert.deepEqual(validateBoundaryReviewOutput(null, sources), []);
});

// ─── 商业关系 ─────────────────────────────────────────────────────

test("buildBusinessQueries: 固定查询集覆盖股东/任职/投资语义与工商聚合站", () => {
  const queries = buildBusinessQueries("张三");
  assert.equal(queries.length, 10);
  assert.ok(queries.every(q => q.query.includes("张三") && q.reason === "business"));
  const qs = queries.map(q => q.query);
  assert.ok(qs.some(q => q.includes("股东")));
  assert.ok(qs.some(q => q.includes("法定代表人")));
  assert.ok(qs.some(q => q.includes("site:aiqicha.baidu.com")));
  assert.ok(qs.some(q => q.includes("site:gsxt.gov.cn")));
  assert.ok(!qs.some(q => / OR | AND /.test(q)));
});

test("validateBusinessOutput: 枚举外 relation / 缺 quote / 越界来源剔除，字段脱敏", () => {
  const out = validateBusinessOutput({
    relations: [
      { companyName: "某科技有限公司", relation: "shareholder", shareholding: "30%", position: null, companyStatus: "存续",
        quote: "张三 持股 30%，电话 13812345678", sourceIds: ["s-1"] },
      { companyName: "某公司", relation: "ceo", quote: "q", sourceIds: ["s-1"] },
      { companyName: "某公司B", relation: "director", quote: "", sourceIds: ["s-1"] },
      { companyName: "某公司C", relation: "director", quote: "有效摘录", sourceIds: ["s-99"] },
    ],
  }, PROMPT_SOURCES);
  assert.equal(out.length, 1);
  assert.equal(out[0].companyName, "某科技有限公司");
  assert.ok(out[0].quote.includes("1****5678"));
  assert.equal(out[0].status, "single_source");

  assert.deepEqual(validateBusinessOutput(null, PROMPT_SOURCES), []);
});

test("validateBusinessOutput: associations → association/unverified（线索保留不丢弃）", () => {
  const out = validateBusinessOutput({
    relations: [],
    associations: [
      { companyName: "某投资企业", note: "目标人物商业查询全文匹配页，摘要股东名单未见其名", quote: "某投资企业（有限合伙）- 企查查", sourceIds: ["s-2"] },
      { companyName: "", note: "无公司名", quote: "q", sourceIds: ["s-2"] },
    ],
  }, PROMPT_SOURCES);
  assert.equal(out.length, 1);
  assert.equal(out[0].relation, "association");
  assert.equal(out[0].status, "unverified");
  assert.ok(out[0].note.includes("全文匹配"));
});

test("mergeBusinessRelations: 同公司同角色合并来源并补齐字段，不同角色分开", () => {
  const existing = [{ companyName: "甲公司", relation: "shareholder", shareholding: null, position: null, sourceIds: ["s-1"], status: "single_source" }];
  const merged = mergeBusinessRelations(existing, [
    { companyName: "甲公司", relation: "shareholder", shareholding: "30%", sourceIds: ["s-2"], status: "single_source" },
    { companyName: "甲公司", relation: "legal_representative", sourceIds: ["s-2"], status: "single_source" },
  ]);
  assert.equal(merged.length, 2);
  const sh = merged.find(r => r.relation === "shareholder");
  assert.deepEqual(sh.sourceIds, ["s-1", "s-2"]);
  assert.equal(sh.shareholding, "30%");
});

test("recomputeBusinessStatus: 独立域名≥2 升 supported，同域名不升", () => {
  const relations = [
    { sourceIds: ["s-1", "s-2"], status: "single_source" },
    { sourceIds: ["s-1", "s-3"], status: "single_source" },
  ];
  const out = recomputeBusinessStatus(relations, SOURCE_MAP);
  assert.equal(out[0].status, "supported");
  assert.equal(out[1].status, "single_source");
});

test("buildReportPrompt: 商业关系进 prompt，轮次含商业调查标签", () => {
  const { system, user } = buildReportPrompt(
    "张三",
    [{ displayName: "张三 · 测试", confidence: "high", status: "selected" }],
    [],
    [{ companyName: "甲公司", relation: "shareholder", shareholding: "30%", position: null, companyStatus: "存续", sourceIds: ["s-7"], status: "single_source" }],
    PROMPT_SOURCES,
    [{ id: "r-2", n: 2, kind: "research", business: true, input: "商业调查" }],
  );
  assert.ok(system.includes("商业版图"));
  assert.ok(user.includes("甲公司"));
  assert.ok(user.includes("股东"));
  assert.ok(user.includes("30%"));
  assert.ok(user.includes("商业调查"));
});

// ─── 用户断言（更正/补充） ────────────────────────────────────────

const EXISTING_CLAIMS = [
  { id: "c-1", claim: "张三目前就职于某公司。", quote: "q", sourceIds: ["s-1"], candidateId: "a1", publishedAt: null, observedAt: null, status: "single_source", conflicts: [] },
  { id: "c-2", claim: "张三曾在某大学学习计算机科学与技术。", quote: "q", sourceIds: ["s-1"], candidateId: "a1", publishedAt: null, observedAt: null, status: "single_source", conflicts: [] },
];

test("validateCorrectionOutput: 否定/补充/信号/摘要，越界 claimId 剔除", () => {
  const out = validateCorrectionOutput({
    negate: [
      { claimId: "c-1", reason: "用户指出并非就职于某公司" },
      { claimId: "c-99", reason: "不存在的主张" },
      { claimId: "c-1", reason: "重复否定" },
    ],
    facts: [
      { fact: "张三是北京人", quote: "北京人" },
      { fact: "", quote: "空事实剔除" },
    ],
    signals: { company: null, school: "某大学", hack: "未知信号键剔除" },
    candidateSummary: "某大学计算机专业毕业生，北京人",
  }, EXISTING_CLAIMS);

  assert.deepEqual(out.negate, [{ claimId: "c-1", reason: "用户指出并非就职于某公司" }]);
  assert.equal(out.facts.length, 1);
  assert.equal(out.facts[0].fact, "张三是北京人");
  assert.deepEqual(out.signals, { company: null, school: "某大学" });
  assert.equal(out.candidateSummary, "某大学计算机专业毕业生，北京人");
  assert.ok(!("hack" in out.signals));
});

test("validateCorrectionOutput: 非对象/空输入返回空结构", () => {
  const empty = { rejectCandidate: false, negativeAnchors: [], negate: [], facts: [], signals: {}, candidateSummary: null };
  assert.deepEqual(validateCorrectionOutput(null, EXISTING_CLAIMS), empty);
  assert.deepEqual(validateCorrectionOutput({ negate: [], facts: [], signals: {}, candidateSummary: null }, EXISTING_CLAIMS), empty);
});

test("applyCorrection: 命中主张标 rejected 带理由，补充主张为 user_provided 无来源", () => {
  const { claims, newClaimIds } = applyCorrection(EXISTING_CLAIMS, {
    negate: [{ claimId: "c-1", reason: "用户指出并非就职于某公司" }],
    facts: [{ fact: "张三是北京人", quote: "北京人" }],
    signals: { company: null },
    candidateSummary: "某大学计算机专业毕业生，北京人",
  }, { newClaimIds: ["c-9"], candidateId: "a1", observedAt: "t" });

  assert.equal(claims.length, 3);
  const rejected = claims.find(c => c.id === "c-1");
  const untouched = claims.find(c => c.id === "c-2");
  const added = claims.find(c => c.id === "c-9");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.rejectedReason, "用户指出并非就职于某公司");
  assert.equal(untouched.status, "single_source");
  assert.equal(added.status, "user_provided");
  assert.deepEqual(added.sourceIds, []);
  assert.equal(added.quote, "北京人");
  assert.deepEqual(newClaimIds, ["c-9"]);
});

test("buildReportPrompt: rejected 不进主张列表、进已否定区并带理由", () => {
  const rejected = [{ ...EXISTING_CLAIMS[0], status: "rejected", rejectedReason: "用户指出并非就职于某公司" }];
  const { system, user } = buildReportPrompt(
    "张三",
    [{ displayName: "张三 · 测试", confidence: "high", status: "selected" }],
    [EXISTING_CLAIMS[1]],
    [],
    PROMPT_SOURCES,
    [],
    rejected,
  );
  assert.ok(system.includes("已否定主张"));
  const claimSection = user.split("## 已被用户否定的主张")[0];
  assert.ok(!claimSection.includes("就职于某公司"));
  assert.ok(claimSection.includes("某大学"));
  assert.ok(user.includes("已被用户否定的主张（1 条"));
  assert.ok(user.includes("用户指出并非就职于某公司"));
});

// ─── V1.2 整人纠错 + 身份锚点 ─────────────────────────────────────

test("validateCorrectionOutput: 整人否定 + 负向锚点 + gender/birthYear + 摘要强制 null", () => {
  const out = validateCorrectionOutput({
    rejectCandidate: true,
    negativeAnchors: ["某大学研究生院", "译者", "", "太长的锚点".repeat(10), "某大学研究生院"],
    negate: [],
    facts: [{ fact: "她是女性", quote: "女性" }],
    signals: { gender: "女", birthYear: "1995", city: "绍兴" },
    candidateSummary: "不应出现的摘要",
  }, EXISTING_CLAIMS);
  assert.equal(out.rejectCandidate, true);
  assert.equal(out.candidateSummary, null); // 整人否定时强制清空
  assert.deepEqual(out.negativeAnchors, ["某大学研究生院", "译者"]); // 去重 + 剔除空/超长
  assert.equal(out.facts.length, 1);
  assert.deepEqual(out.signals, { gender: "女", birthYear: "1995", city: "绍兴" });
});

test("reIdCandidates: 重新识别新候选避开既有编号，idMap 供主张重挂", () => {
  const existing = [
    { id: "a1", displayName: "张三 · 旧一", status: "rejected" },
    { id: "a2", displayName: "张三 · 旧二", status: "unconfirmed" },
  ];
  const incoming = [
    { id: "a1", displayName: "张三 · 新一", confidence: "high" },
    { id: "a2", displayName: "张三 · 新二", confidence: "low" },
  ];
  const { candidates, idMap } = reIdCandidates(existing, incoming);
  assert.deepEqual(candidates.map(c => c.id), ["a3", "a4"]);
  assert.ok(candidates.every(c => c.status === "unconfirmed"));
  assert.equal(idMap.get("a1"), "a3");
  assert.equal(idMap.get("a2"), "a4");
  // 空候选池：base=0 → a1 起
  assert.deepEqual(reIdCandidates([], incoming).candidates.map(c => c.id), ["a1", "a2"]);
});

test("applyCandidateRejection: 目标连坐、user_provided 与其他存活候选保留、摘要清空", () => {  const claims = [
    { id: "c-1", claim: "目标候选的主张", candidateId: "a1", status: "single_source" },
    { id: "c-2", claim: "未归属主张", candidateId: null, status: "single_source" },
    { id: "c-3", claim: "用户补充", candidateId: "a1", status: "user_provided" },
    { id: "c-4", claim: "另一候选的主张", candidateId: "a2", status: "single_source" },
    { id: "c-5", claim: "已排除不动", candidateId: "a1", status: "rejected", rejectedReason: "旧" },
  ];
  const candidates = [
    { id: "a1", displayName: "张三 · 错的人", status: "selected", identitySummary: "错误摘要", signals: { occupation: "译者" } },
    { id: "a2", displayName: "张三 · 另一人", status: "unconfirmed", identitySummary: "x" },
  ];
  const applied = applyCandidateRejection(claims, candidates, { candidateId: "a1", reason: "用户指出认错了人" });
  assert.equal(applied.ok, true);
  const a1 = applied.candidates.find(c => c.id === "a1");
  assert.equal(a1.status, "rejected");
  assert.equal(a1.identitySummary, null);
  const st = id => applied.claims.find(c => c.id === id).status;
  assert.equal(st("c-1"), "rejected");           // 目标候选名下连坐
  assert.equal(st("c-2"), "rejected");           // 未归属也清（干净重来）
  assert.equal(st("c-3"), "user_provided");      // 用户补充保留
  assert.equal(st("c-4"), "single_source");      // 其他存活候选保留
  assert.equal(st("c-5"), "rejected");           // 已排除不动
  assert.ok(applied.claims.find(c => c.id === "c-1").rejectedReason.includes("候选整体排除"));
});

test("scoreSource: 负向锚点命中 -6（认错的人的页面基本必丢弃）", () => {
  const ctx = { ...RCTX, negativeAnchors: ["某大学研究生院", "译者"] };
  // 姓名标题 +5 命中"译者" -6 → -1 丢弃
  const a = scoreSource({ title: "张三的译者主页", url: "https://a.com/p", snippet: "张三简介" }, ctx);
  assert.equal(a.score, -1);
  assert.ok(a.matchedSignals.includes("negative-anchor"));
  // 不命中负向锚点不受影响
  const b = scoreSource({ title: "张三的主页", url: "https://a.com/p", snippet: "张三简介" }, ctx);
  assert.equal(b.score, 5);
});

test("applyCandidateRejectInState: 锚点提取 + redirect 轮置位 + 负向锚点累积", () => {
  const state = makeResearchState();
  state.research.candidates[0] = {
    id: "a1", displayName: "张三 · 某大学研究生、译者", status: "selected",
    identitySummary: "错误的人", signals: { occupation: "译者", school: "某大学" }, confidence: "high",
  };
  const claims = [
    { id: "c-1", claim: "主张一", candidateId: "a1", status: "single_source" },
    { id: "c-2", claim: "用户补充", candidateId: null, status: "user_provided" },
  ];
  const result = applyCandidateRejectInState(state, claims, { candidateId: "a1" });
  assert.equal(result.ok, true);
  assert.ok(result.negativeAnchors.includes("某大学研究生"));
  assert.ok(result.negativeAnchors.includes("译者"));
  assert.equal(state.research.candidates.find(c => c.id === "a1").status, "rejected");
  assert.equal(state.research.pendingRound.source, "redirect");
  assert.equal(state.research.pendingRound.business, false);
  assert.ok(state.research.negativeAnchors.includes("译者"));
  assert.equal(result.claims.find(c => c.id === "c-1").status, "rejected");
  assert.equal(result.claims.find(c => c.id === "c-2").status, "user_provided");
  assert.equal(result.rejectedClaims, 1);
  assert.equal(state.status, "running");
});

test("applyClaimRejectInState: 单条 rejected + 只重臂 report 步骤", () => {
  const state = makeResearchState();
  state.steps = [
    { id: "discovery", status: "completed", output: {} },
    { id: "research", status: "completed", output: {} },
    { id: "report", status: "completed", output: {} },
  ];
  const claims = [{ id: "c-1", claim: "有误的主张", candidateId: "a1", status: "single_source" }];
  const result = applyClaimRejectInState(state, claims, { claimId: "c-1" });
  assert.equal(result.ok, true);
  assert.equal(claims[0].status, "rejected");
  assert.equal(claims[0].rejectedReason, "用户标记有误");
  assert.equal(state.steps[1].status, "completed"); // research 不重跑
  assert.equal(state.steps[2].status, "pending");   // report 重臂
  assert.equal(applyClaimRejectInState(state, claims, { claimId: "c-99" }).ok, false);
});

test("applySelectInState: 已排除候选不可直接选定", () => {
  const state = makeResearchState();
  state.research.candidates[0].status = "rejected";
  const result = applySelectInState(state, { candidateId: "a1", action: "selected" });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("排除"));
});
