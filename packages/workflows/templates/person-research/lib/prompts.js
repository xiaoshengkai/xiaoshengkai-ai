/**
 * LLM 契约层（纯函数）：prompt 构建 + 输出校验。
 * 校验策略：结构非法项软剔除（drop + 记日志，不废整轮）；JSON 解析失败由调用方按 storyboard 模式重试。
 * 所有文本字段过 redactPhone——手机号不进任何落盘内容。
 */
import { redactPhone } from "./privacy.js";
import { CONFIG } from "./config.js";

const CONFIDENCE_LEVELS = ["low", "medium", "high"];

const BUSINESS_RELATION_TYPES = [
  "shareholder", "history_shareholder", "legal_representative", "director",
  "supervisor", "executive", "investment", "actual_controller", "beneficiary", "history_position",
  "association",
];

export const BUSINESS_RELATION_LABELS = {
  shareholder: "股东", history_shareholder: "历史股东", legal_representative: "法定代表人",
  director: "董事", supervisor: "监事", executive: "高管", investment: "对外投资",
  actual_controller: "实际控制人", beneficiary: "最终受益人", history_position: "历史任职",
  association: "关联（未证实）",
};

function text(v) {
  return redactPhone(String(v ?? "").trim());
}

function sourceIdsOf(v, validIds) {
  const ids = [...new Set((Array.isArray(v) ? v : []).map(String))];
  return ids.length > 0 && ids.every(i => validIds.has(i)) ? ids : null;
}

function renderSources(sources) {
  return sources.map(s =>
    `[${s.id}] ${s.title || "(无标题)"} | ${s.domain} | ${s.url}\n正文：${s.content ? s.content.slice(0, CONFIG.CONTENT_TRUNCATE) : `（未抓取，摘要：${s.snippet || "无"}）`}`
  ).join("\n\n");
}

function renderProfile(profile) {
  const c = profile.clues || {};
  const lines = [`姓名：${profile.name}`];
  if (profile.phone) lines.push(`手机号（用于公开页面匹配，输出中必须脱敏）：${profile.phone}`);
  if (c.note) lines.push(`用户备注：${c.note}`);
  if (c.city) lines.push(`城市/地区：${c.city}`);
  if (c.school) lines.push(`学校：${c.school}`);
  if (c.company) lines.push(`公司/职业：${c.company}`);
  if (c.occupation) lines.push(`职业：${c.occupation}`);
  if (c.gender) lines.push(`性别：${c.gender}`);
  if (c.birthYear) lines.push(`出生年份：${c.birthYear}`);
  if (c.knownUrl) lines.push(`已知链接：${c.knownUrl}`);
  if (c.focus) lines.push(`研究重点：${c.focus}`);
  const neg = profile.negativeAnchors || [];
  if (neg.length > 0) lines.push(`已否定的身份锚点（认错了的人，勿与目标画像合并/查询避开）：${neg.join("、")}`);
  return lines.join("\n");
}

// ─── 候选聚类 + 首轮主张抽取 ─────────────────────────────────────

export function buildClusterPrompt(profile, sources) {
  const system = `你是严谨的人物公开信息研究员。根据目标人物画像与公开网页来源，把相关页面聚类为「候选人物」，并抽取可核查的事实主张。

铁律：
1. 只依据来源内容判断，绝不编造；来源里没有的信息不写
2. 同名不同人必须拆成不同候选；一个候选对应一个真实存在的独立身份
3. quote 必须逐字复制来源正文片段（≤${CONFIG.QUOTE_MAX}字），不得改写、不得拼接
4. confidence：high=多个独立来源一致的强身份信号；medium=姓名+一项线索吻合；low=仅姓名匹配
5. 不推断住址、身份证号、家庭成员、实时位置、财产
6. 输出中不得出现任何完整手机号（脱敏形式 1****XXXX 可以）
7. 与目标姓名完全无关的来源放入 irrelevantSourceIds
8. claims 不带 id 字段（由系统分配）

只输出 JSON，不要输出其他内容，格式：
{
  "candidates": [
    { "id": "a1", "displayName": "张三 · 一句话身份", "identitySummary": "该候选的公开身份描述",
      "signals": { "city": null, "school": null, "company": null, "occupation": null },
      "sourceIds": ["s-1"], "confidence": "low|medium|high", "reason": "为何判断这是独立候选" }
  ],
  "claims": [
    { "claim": "一句话事实主张", "candidateId": "a1", "quote": "来源正文逐字摘录",
      "sourceIds": ["s-1"], "publishedAt": "YYYY-MM-DD 或 null" }
  ],
  "irrelevantSourceIds": ["s-9"]
}`;

  const user = `## 目标人物画像
${renderProfile(profile)}

## 来源（${sources.length} 条）
${renderSources(sources)}

开始聚类与抽取：`;
  return { system, user };
}

export function validateClusterOutput(json, sources) {
  const out = { candidates: [], claims: [], irrelevantSourceIds: [] };
  if (!json || typeof json !== "object") return out;

  const validSourceIds = new Set(sources.map(s => s.id));
  const candidateIds = new Set();

  for (const c of Array.isArray(json.candidates) ? json.candidates : []) {
    const id = String(c?.id ?? "").trim();
    const displayName = text(c?.displayName);
    if (!id || !displayName || candidateIds.has(id)) continue;
    const sourceIds = sourceIdsOf(c?.sourceIds, validSourceIds);
    if (!sourceIds || !CONFIDENCE_LEVELS.includes(c?.confidence)) continue;
    candidateIds.add(id);
    out.candidates.push({
      id, displayName,
      identitySummary: text(c?.identitySummary),
      signals: {
        city: text(c?.signals?.city) || null,
        school: text(c?.signals?.school) || null,
        company: text(c?.signals?.company) || null,
        occupation: text(c?.signals?.occupation) || null,
      },
      sourceIds, confidence: c.confidence,
      reason: text(c?.reason),
    });
  }

  for (const cl of Array.isArray(json.claims) ? json.claims : []) {
    const claim = text(cl?.claim);
    const quote = text(cl?.quote);
    const sourceIds = sourceIdsOf(cl?.sourceIds, validSourceIds);
    const candidateId = String(cl?.candidateId ?? "").trim();
    if (!claim || !quote || quote.length > CONFIG.QUOTE_MAX || !sourceIds || !candidateIds.has(candidateId)) {
      continue;
    }
    out.claims.push({ claim, quote, sourceIds, candidateId, publishedAt: cl?.publishedAt || null, status: "single_source" });
  }

  for (const s of Array.isArray(json.irrelevantSourceIds) ? json.irrelevantSourceIds : []) {
    if (validSourceIds.has(String(s))) out.irrelevantSourceIds.push(String(s));
  }
  return out;
}

// ─── 研究轮：意图 → 定向查询 ────────────────────────────────────

export function buildIntentPrompt(profile, message, doneQueries) {
  const system = `你是搜索查询规划器。根据用户指令、目标人物画像与已执行过的查询，产出下一步定向搜索查询。

规则：
- 最多 ${CONFIG.RESEARCH_MAX_QUERIES} 条，每条是给搜索引擎的完整查询词（必须包含姓名或明确实体名）
- 围绕用户指定方向（教育经历/任职与公司/新闻事件/公开账号/社会关系等）
- 不重复已执行查询；优先高区分度组合（姓名+机构 / 姓名+事件 / 姓名+平台）
- 不产出与研究方向无关的泛查询
- 不要使用 OR/AND 等布尔运算符（聚合引擎解析差，召回率反降）；需要并列时拆成多条短查询

只输出 JSON：{ "intent": "一句话意图", "queries": ["查询词1", "查询词2"] }`;

  const user = `## 目标人物画像
${renderProfile(profile)}

## 已执行过的查询（不要重复）
${doneQueries.length > 0 ? doneQueries.join("\n") : "（暂无）"}

## 用户本轮指令
${message}

产出定向查询：`;
  return { system, user };
}

// ─── 商业关系抽取 ────────────────────────────────────────────────

export function buildBusinessExtractPrompt(profile, candidate, sources) {
  const relationEnum = Object.entries(BUSINESS_RELATION_LABELS)
    .map(([k, v]) => `${k}(${v})`).join(" / ");

  const system = `你是商业信息抽取员。从公开网页来源中抽取目标人物的商业关系（股东/任职/投资等）。

铁律：
1. 只依据来源内容，绝不编造；来源未给出持股比例/职务/状态时对应字段填 null，禁止估算
2. quote 必须逐字摘录来源正文（≤${CONFIG.QUOTE_MAX}字）
3. 来源未抓取正文时，其搜索摘要同样是证据——quote 可摘录摘要原文（聚合站正文常被反爬，摘要是唯一可用层）
4. relation 枚举：${relationEnum}
5. 同一来源支持多条关系（一人多公司 / 一公司多角色）分别输出
6. 与目标人物无关的公司信息不抽取；同名不同人的公司信息按来源线索判断，无法判断则不抽取；股东名单摘要里没有目标人物姓名的，不得据公司匹配推断其股东身份——但该聚合站公司页若来自目标人物商业查询的全文匹配，放入 associations（关联未证实）
7. 输出中不得出现任何完整手机号

只输出 JSON，格式：
{ "relations": [ { "companyName": "公司全称", "relation": "shareholder", "shareholding": "30% 或 null", "position": "职务 或 null", "companyStatus": "存续/注销/吊销 或 null", "since": "YYYY-MM-DD 或 null", "until": "YYYY-MM-DD 或 null", "quote": "逐字摘录", "sourceIds": ["s-7"] } ],
  "associations": [ { "companyName": "公司全称", "note": "为何认为是关联（如：目标人物商业查询的全文匹配页，但摘要股东/高管名单未见其名）", "quote": "逐字摘录", "sourceIds": ["s-8"] } ] }`;

  const user = `## 目标人物画像
${renderProfile(profile)}

## 当前候选
${candidate ? `${candidate.id} ${candidate.displayName}｜${candidate.identitySummary || ""}` : "（未确认候选，按画像抽取）"}

## 来源（${sources.length} 条）
${renderSources(sources)}

开始抽取商业关系：`;
  return { system, user };
}

export function validateBusinessOutput(json, sources) {
  const out = [];
  if (!json || typeof json !== "object") return out;

  const validIds = new Set(sources.map(s => s.id));

  const buildRelation = (r, relation, status, extra = {}) => {
    const companyName = text(r?.companyName);
    const sourceIds = sourceIdsOf(r?.sourceIds, validIds);
    const quote = text(r?.quote);
    if (!companyName || !sourceIds) return null;
    if (!quote || quote.length > CONFIG.QUOTE_MAX) return null;
    return {
      companyName, relation, sourceIds, quote, status,
      shareholding: text(r?.shareholding) || null,
      position: text(r?.position) || null,
      companyStatus: text(r?.companyStatus) || null,
      since: text(r?.since) || null,
      until: text(r?.until) || null,
      ...extra,
    };
  };

  for (const r of Array.isArray(json.relations) ? json.relations : []) {
    const relation = String(r?.relation ?? "").trim();
    if (!BUSINESS_RELATION_TYPES.includes(relation) || relation === "association") continue;
    const rel = buildRelation(r, relation, "single_source");
    if (rel) out.push(rel);
  }

  // 聚合站全文匹配但角色未证实的公司 → association / unverified（呈现线索而非丢弃）
  for (const a of Array.isArray(json.associations) ? json.associations : []) {
    const rel = buildRelation(a, "association", "unverified", { note: text(a?.note) || null });
    if (rel) out.push(rel);
  }
  return out;
}

export function validateIntentOutput(json) {
  const queries = (Array.isArray(json?.queries) ? json.queries : [])
    .map(q => String(q ?? "").trim())
    .filter(Boolean)
    .slice(0, CONFIG.RESEARCH_MAX_QUERIES);
  const errors = queries.length === 0 ? ["queries 为空或全部无效"] : [];
  return { value: { intent: text(json?.intent) || "未命名意图", queries }, errors };
}

// ─── 研究轮：新来源证据抽取与既有主张核对 ───────────────────────

export function buildExtractPrompt(profile, candidate, newSources, existingClaims) {
  const system = `你是证据抽取员。从新来源中抽取与目标候选相关的可核查主张，并核对既有主张。

铁律：
1. quote 必须逐字摘录来源正文（≤${CONFIG.QUOTE_MAX}字），不得改写
2. 每条主张必须给出支撑它的 sourceIds（只能引用本次新来源）
3. 既有主张获得新来源支持的，放入 updates（claimId + addSourceIds）
4. 与既有主张矛盾的新信息，放入 conflicts（两说并列，不由你裁决真伪）
5. 与目标候选无关的内容不抽取
6. 输出中不得出现任何完整手机号

只输出 JSON，格式：
{
  "newClaims": [ { "claim": "一句话主张", "quote": "逐字摘录", "sourceIds": ["s-7"], "publishedAt": null } ],
  "updates": [ { "claimId": "c-1", "addSourceIds": ["s-7"] } ],
  "conflicts": [ { "claim": "冲突主张", "note": "冲突说明（两说各自内容）", "sourceIds": ["s-8"], "claimIds": ["c-1"] } ]
}`;

  const user = `## 目标人物画像
${renderProfile(profile)}

## 当前候选
${candidate ? `${candidate.id} ${candidate.displayName}｜${candidate.identitySummary || ""}` : "（未确认候选，按画像抽取）"}

## 新来源（${newSources.length} 条）
${renderSources(newSources)}

## 既有主张（${existingClaims.length} 条）
${existingClaims.map(c => `${c.id}｜${c.claim}｜来源: ${c.sourceIds.join(",")}`).join("\n") || "（暂无）"}

开始抽取与核对：`;
  return { system, user };
}

export function validateExtractOutput(json, newSources, existingClaims) {
  const out = { newClaims: [], updates: [], conflicts: [] };
  if (!json || typeof json !== "object") return out;

  const validNewIds = new Set(newSources.map(s => s.id));
  const validClaimIds = new Set(existingClaims.map(c => c.id));

  for (const cl of Array.isArray(json.newClaims) ? json.newClaims : []) {
    const claim = text(cl?.claim);
    const quote = text(cl?.quote);
    const sourceIds = sourceIdsOf(cl?.sourceIds, validNewIds);
    if (!claim || !quote || quote.length > CONFIG.QUOTE_MAX || !sourceIds) continue;
    out.newClaims.push({ claim, quote, sourceIds, publishedAt: cl?.publishedAt || null });
  }

  for (const u of Array.isArray(json.updates) ? json.updates : []) {
    const claimId = String(u?.claimId ?? "").trim();
    const addSourceIds = sourceIdsOf(u?.addSourceIds, validNewIds);
    if (!validClaimIds.has(claimId) || !addSourceIds) continue;
    out.updates.push({ claimId, addSourceIds });
  }

  for (const cf of Array.isArray(json.conflicts) ? json.conflicts : []) {
    const claim = text(cf?.claim);
    const sourceIds = sourceIdsOf(cf?.sourceIds, validNewIds);
    if (!claim || !sourceIds) continue;
    const claimIds = [...new Set((Array.isArray(cf?.claimIds) ? cf.claimIds : []).map(String))]
      .filter(i => validClaimIds.has(i));
    out.conflicts.push({ claim, note: text(cf?.note), sourceIds, claimIds });
  }
  return out;
}

// ─── 用户断言解析（更正/补充） ────────────────────────────────────

const SIGNAL_KEYS = ["city", "school", "company", "occupation", "gender", "birthYear"];

export function buildUserAssertionPrompt(profile, candidate, message, existingClaims) {
  const system = `你是用户断言解析器。用户在研究过程中提交了一条消息，解析其中关于目标人物的「明确事实断言」——包括更正（否定既有主张/否定整个人）与补充（新增事实）。

规则：
1. 只提取用户明确陈述的身份事实（如"他不是某公司的"、"她是女性"、"1995 年出生"、"昵称是XX"）
2. 纯研究方向（如"继续查教育经历"）不含事实断言 → 所有字段输出空
3. rejectCandidate：用户明确否定「整个人」——认错了人/找错了/不是这个人/不是XX机构的这个人 → true；此时 candidateSummary 必须为 null（清空错误候选摘要，严禁把用户线索缝进被否定的候选）
4. negativeAnchors：被否定者的具体身份特征（机构全称/职业/关联身份），仅在整人否定或明确否定某身份时输出；宽泛词（"这个人"等）不提取，≤5 条
5. negate：用户否定的既有主张（claimId 必须来自既有主张列表，reason 写用户依据）；整人否定时通常不需要逐条 negate（系统会连坐）
6. facts：用户补充的新事实（quote 填用户原话片段）
7. signals：断言直接对应的信号更新（city/school/company/occupation/gender/birthYear）；性别（男/女）→ gender；出生年份（"95年出生"→1995）→ birthYear；被否定 → null，被补充 → 新值；被否定实体若也出现在其他信号字段，该字段必须同步更新（剔除该实体保留剩余部分，空了置 null）
8. candidateSummary：断言改变画像时输出更新后的一句话身份（≤80 字，以正面事实为主，不以被否定内容开头）；无变化或整人否定 → null
9. 不推断、不扩展用户没说的内容；模棱两可不提取

只输出 JSON：
{ "rejectCandidate": false,
  "negativeAnchors": [],
  "negate": [{ "claimId": "c-1", "reason": "用户指出并非就职于某公司" }],
  "facts": [{ "fact": "张三毕业于某大学", "quote": "毕业于某大学" }],
  "signals": { "company": null, "gender": "女", "birthYear": "1995" },
  "candidateSummary": "一句话身份或 null" }`;

  const user = `## 目标人物画像
${renderProfile(profile)}

## 当前候选
${candidate ? `${candidate.id} ${candidate.displayName}｜${candidate.identitySummary || ""}` : "（未确认候选）"}

## 既有主张（${existingClaims.length} 条）
${existingClaims.map(c => `${c.id}｜${c.claim}｜状态 ${c.status}`).join("\n") || "（暂无）"}

## 用户消息
${message}

解析用户断言：`;
  return { system, user };
}

export function validateCorrectionOutput(json, existingClaims) {
  const out = { rejectCandidate: false, negativeAnchors: [], negate: [], facts: [], signals: {}, candidateSummary: null };
  if (!json || typeof json !== "object") return out;

  const validIds = new Set(existingClaims.map(c => c.id));

  out.rejectCandidate = Boolean(json.rejectCandidate);

  for (const a of Array.isArray(json.negativeAnchors) ? json.negativeAnchors : []) {
    const t = text(a);
    if (t && t.length >= 2 && t.length <= 30 && !out.negativeAnchors.includes(t)) {
      out.negativeAnchors.push(t);
      if (out.negativeAnchors.length >= 5) break;
    }
  }

  for (const n of Array.isArray(json.negate) ? json.negate : []) {
    const claimId = String(n?.claimId ?? "").trim();
    if (!validIds.has(claimId) || out.negate.some(x => x.claimId === claimId)) continue;
    out.negate.push({ claimId, reason: text(n?.reason) || null });
  }

  for (const f of Array.isArray(json.facts) ? json.facts : []) {
    const fact = text(f?.fact);
    if (!fact) continue;
    out.facts.push({ fact, quote: text(f?.quote) || null });
  }

  if (json.signals && typeof json.signals === "object") {
    for (const k of SIGNAL_KEYS) {
      if (k in json.signals) {
        out.signals[k] = json.signals[k] === null ? null : (text(json.signals[k]) || null);
      }
    }
  }

  out.candidateSummary = text(json.candidateSummary) || null;
  if (out.rejectCandidate) out.candidateSummary = null;
  return out;
}

// ─── 边界复核（V1.1 相关性漏斗） ──────────────────────────────────

export function buildBoundaryReviewPrompt(ctx, sources) {
  const system = `你是人物相关性复核员。判断每条搜索结果是否属于目标人物（区分同名他人与无关页面）。

判定（三选一）：
- relevant：页面明确关于目标人物（姓名匹配 + 身份线索/经历吻合）
- other_person：同名但是另一个人（学校/公司/年代/领域明显不同，或命中已否定的身份锚点）
- irrelevant：页面与目标人物无关（泛列表页、公司主页无此人、词典页、无关主题）

规则：
1. 只依据标题/摘要/正文摘录判断，不猜测
2. 无法确定时输出 irrelevant（宁缺毋滥）
3. relevant 时给出 candidateKey：用「学校-公司-城市」等身份特征拼接，便于同身份归组

只输出 JSON：
{ "reviews": [ { "sourceId": "b-1", "decision": "relevant", "candidateKey": "某大学-某公司-某城市", "matchedSignals": ["name", "school"], "reason": "一句话依据" } ] }`;

  const neg = (ctx.negativeAnchors || []).length > 0
    ? `\n\n## 已否定的身份锚点（认错了的人；命中这些特征的页面一律判 other_person）\n${ctx.negativeAnchors.join("、")}`
    : "";

  const user = `## 目标人物画像
${renderProfile({ name: ctx.name, phone: ctx.phone, clues: ctx.clues || {} })}${neg}

## 待复核（${sources.length} 条）
${renderSources(sources)}

逐条复核：`;
  return { system, user };
}

export function validateBoundaryReviewOutput(json, sources) {
  const out = [];
  if (!json || typeof json !== "object") return out;

  const validIds = new Set(sources.map(s => s.id));
  const seen = new Set();

  for (const r of Array.isArray(json.reviews) ? json.reviews : []) {
    const sourceId = String(r?.sourceId ?? "").trim();
    const decision = String(r?.decision ?? "").trim();
    if (!validIds.has(sourceId) || seen.has(sourceId)) continue;
    if (!["relevant", "other_person", "irrelevant"].includes(decision)) continue;
    seen.add(sourceId);
    out.push({
      sourceId,
      decision,
      candidateKey: text(r?.candidateKey) || null,
      matchedSignals: (Array.isArray(r?.matchedSignals) ? r.matchedSignals : []).map(String).slice(0, 5),
      reason: text(r?.reason) || null,
    });
  }
  return out;
}

// ─── 报告生成 ────────────────────────────────────────────────────

export function buildReportPrompt(name, candidates, claims, business, sources, rounds, rejectedClaims = []) {
  const system = `你是研究报告撰写人。基于候选、主张、商业关系与来源生成 Markdown 研究报告。

规则：
1. 每条结论后必须附引用标记（如 [S1]），对应来源编号；没有引用支撑的内容不得写成事实
2. 状态标注：单一来源→「单一来源」；多来源一致→「多来源一致」；冲突→「信息冲突」并列两说；用户补充→「用户补充」
3. 措辞：始终用「可能为同一人」「公开页面显示」「未证实」等表述，禁止确定性断言身份
4. 不输出任何完整手机号（脱敏形式 1****XXXX 可以）
5. 章节按实际证据组织，无证据的章节省略：人物识别与匹配依据 / 教育经历 / 职业与任职经历 / 商业版图 / 新闻与事件时间线 / 公开作品与账号 / 来源冲突与待核实项 / 下一步建议
6. 商业版图：按公司列出关系（公司名、角色、持股比例——仅当来源明确给出，禁止估算、来源没写就不写、公司状态）；无商业关系证据时整个章节省略，不要写推测
7. 「已否定主张」列表中的内容已被用户明确更正，不得写成事实；如需提及只能写「用户已更正」
8. 报告以 \`# 研究报告：${name}\` 开头

输出 Markdown 纯文本（不要用代码块包裹）。`;

  const bizLines = (business || []).map(b =>
    `${b.companyName}｜${BUSINESS_RELATION_LABELS[b.relation] || b.relation}｜持股 ${b.shareholding || "未给出"}｜职务 ${b.position || "无"}｜状态 ${b.companyStatus || "未知"}｜证据 ${b.status}｜来源 ${b.sourceIds.join(",")}`
  ).join("\n");

  const user = `## 候选人物（${candidates.length}）
${candidates.map(c => `${c.displayName}｜置信 ${c.confidence}｜状态 ${c.status}｜${c.identitySummary || ""}`).join("\n") || "（无候选）"}

## 主张（${claims.length} 条）
${claims.map(c => `${c.id} ${c.claim}｜状态 ${c.status}｜${c.sourceIds.length > 0 ? `来源 ${c.sourceIds.join(",")}` : "用户补充（无公开来源）"}｜摘录「${c.quote.slice(0, 60)}」`).join("\n") || "（无主张）"}

## 已被用户否定的主张（${rejectedClaims.length} 条，不要采纳、不得写成事实）
${rejectedClaims.map(c => `${c.id} ${c.claim}｜否定理由：${c.rejectedReason || "用户指出有误"}`).join("\n") || "（无）"}

## 商业关系（${(business || []).length} 条）
${bizLines || "（无）"}

## 来源（${sources.length} 条）
${sources.map(s => `[${s.id}] ${s.title || "(无标题)"}｜${s.domain}｜${s.domainClass}级｜${s.url}`).join("\n")}

## 研究轮次（${rounds.length}）
${rounds.map(r => `第 ${r.n} 轮（${r.business ? "商业调查" : r.kind === "discovery" ? "候选发现" : "定向研究"}）${r.input ? `：${r.input}` : ""}`).join("\n")}

生成报告：`;
  return { system, user };
}

export function validateReportCitations(md, sources) {
  const validIds = new Set(sources.map(s => s.id));
  let invalidCount = 0;
  const cleaned = String(md || "").replace(/\[S(\d+)\]/g, (m, n) => {
    if (validIds.has(`s-${n}`)) return m;
    invalidCount += 1;
    return "";
  });
  return { md: cleaned, invalidCount };
}
