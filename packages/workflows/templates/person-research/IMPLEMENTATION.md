# person-research V1 实现计划

> **For agentic workers:** 用 executing-plans 或 subagent-driven-development 逐任务执行。步骤用 `- [ ]` 勾选跟踪。
> 设计依据：同目录 `PLAN.md`（已与用户确认）。本文件是 V1 落地实现计划。

**Goal:** 在现有工作流引擎上实现单人物公开信息研究：候选发现 → 人工确认 → 多轮定向研究 → 带引用的研究报告。

**Architecture:** 三步模板（discovery[awaitInput 停靠] → research → report）+ 3 个模板级 custom action（select/continue/report）驱动多轮循环；搜索/抓取走现有 search-service HTTP；LLM 走 `@app/shared/llm` callLLM（storyboard 式重试校验）。引擎唯一通用增强：`awaitInput` 步骤停靠为 `awaiting_input` 状态。

**Tech Stack:** 纯 Node ESM（模板 lib，import.meta.url 定位）+ Next.js 页面（ReactMarkdown 渲染报告）+ node:test。

## Global Constraints

- 未经用户明确要求 **不 git commit**；每任务完成即停在已验证状态
- 提交门禁：`npm run typecheck && npm run test`（新测试文件放 `packages/shared/test/person-research.test.js`，被 test:shared glob 自动纳入）
- 模板 lib 不 import `engine.js`（仓库铁律）；custom handler 签名 `handle({ params, request })`（scene-groups.js 模式）
- 手机号永不进报告正文（`privacy.redactPhone` 落盘前全量过滤）；原始手机号只存 `private.json`
- 测试不 mock `@app/shared/llm`：LLM 编排层不做单测（仓库惯例——comic/floorplan 只测纯函数），prompt 构建器与校验器全部纯函数化并测试
- 步骤长任务全部经 `POST /execution/:id/auto`（detached）触发，前端轮询 state

## 数据结构（全部任务共用，字段名定稳）

state.json 增量字段（挂在引擎 state 上）：

```json
{
  "research": {
    "name": "张三",
    "clues": { "phone": "138...", "note": "", "city": "", "school": "", "company": "", "occupation": "", "ageRange": "", "knownUrl": "", "focus": "" },
    "candidates": [ { "id": "a1", "displayName": "", "identitySummary": "", "signals": { "city": null, "school": null, "company": null, "occupation": null }, "sourceIds": ["s-1"], "confidence": "low|medium|high", "status": "unconfirmed|selected|rejected|ambiguous", "reason": "" } ],
    "claimIds": ["c-1"],
    "rounds": [ { "id": "r-1", "n": 1, "kind": "discovery|research", "input": null, "queryCount": 8, "newSourceIds": ["s-1"], "newClaimIds": ["c-1"], "at": "ISO" } ],
    "nextSourceSeq": 12, "nextClaimSeq": 5,
    "reportVersion": 2,
    "pendingRound": null
  }
}
```

任务目录文件：

```
rounds/001-discovery.json   # { id, n, kind, input, queries[{query,category,reason}], sourceIds, claimIds, at }
sources/<s-id>.json         # { id, url, canonicalUrl, title, domain, domainClass:"A|B|C|D", publishedAt,
                            #   snippet, content: "<markdown 截断>", scraped: bool, scrapeError: null,
                            #   engines: [], foundInRound: 1, observedAt }
claims.json                 # [{ id, claim, candidateId, quote, sourceIds, publishedAt, observedAt,
                            #    status:"single_source|supported|conflicting|user_provided|unverified", conflicts:[] }]
report/current.md + v00N.md
private.json                # { phone: "138..." }
```

引用格式：报告内 `[S1]`（无横杠）→ sources id `s-1`；`[S1][S3]` 多引用。

---

### Task 1: 引擎 awaitInput 停靠

**Files:**
- Modify: `packages/workflows/engine.js`
- Test: `packages/shared/test/person-research.test.js`（新建）

**Interfaces:**
- Produces: step 声明 `"awaitInput": true` 时，该步完成且非末步 → `state.status = "awaiting_input"`；`runNextStep` 在 `awaiting_input` 状态下拒绝执行。状态常量不进 TERMINAL_STATUSES（可恢复）。

- [ ] **Step 1.1** `runNextStep` 顶部（TERMINAL 检查后）加守卫：

```js
if (state.status === "awaiting_input") {
  return { ok: false, error: "等待用户输入中" };
}
```

- [ ] **Step 1.2** `runNextStep` 成功分支（末步终态判断处）：

```js
if (nextIdx === template.steps.length - 1) {
  freshState.status = deriveTerminalStatus(freshState.steps);
  freshState.completedAt = new Date().toISOString();
} else if (step.awaitInput) {
  freshState.status = "awaiting_input";
}
```

- [ ] **Step 1.3** `runSteps` 循环内成功写状态后加停靠（注意必须跳过循环后的 completed 收尾）：

```js
let parked = false;
// ...成功分支末尾：
if (step.awaitInput && i < template.steps.length - 1) {
  state.status = "awaiting_input";
  writeState(dir, state);
  logger.info(`[${i + 1}/${template.steps.length}] ${step.name} 完成，停靠等待用户输入`);
  parked = true;
  break;
}
// ...循环后：
if (!parked) {
  state.status = "completed";
  state.completedAt = new Date().toISOString();
  writeState(dir, state);
  logger.info(`工作流执行完成，总耗时: ${totalElapsed}s`);
}
```

- [ ] **Step 1.4** 测试（复制 comic-workflow.test.js 的手写 state 模式）：在 DATA_DIR 建临时执行目录，steps = [{id:"discovery",status:"completed"},{id:"research",status:"pending"}]，`state.status="awaiting_input"` → 断言 `runNextStep` 返回 `{ok:false, error:"等待用户输入中"}`；再测 state.status="running" 时 `awaitInput` 步完成后的落盘状态。runNextStep 会真执行 pending 步——测试里 pending 步指向不存在的 module 让它抛错，断言抛错路径前状态未被污染即可；停靠落盘断言用纯逻辑单独验证（把 1.2 的分支抽成导出函数 `parkIfNeeded(step, isLast)` 返回 `"awaiting_input" | "completed" | null`，runNextStep 调它，测试直接测这个纯函数）。
- [ ] **Step 1.5** `npm run test:shared` 全绿。

### Task 2: 模板骨架 + privacy + config

**Files:**
- Create: `packages/workflows/templates/person-research/template.json`、`actions.json`、`lib/config.js`、`lib/privacy.js`、`lib/store.js`

**Interfaces:**
- Produces: `config.js` 导出 `CONFIG = { DISCOVERY_MAX_QUERIES: 8, RESEARCH_MAX_QUERIES: 5, SCRAPE_PER_ROUND: 5, DOMAIN_SCRAPE_CAP: 2, CONTENT_TRUNCATE: 4000, SEARCH_TIMEOUT_MS: 30000, SCRAPE_TIMEOUT_MS: 60000, SEARCH_CONCURRENCY: 4, QUOTE_MAX: 120 }`
- Produces: `privacy.js` → `redactPhone(text)`（`/1[3-9]\d{9}/g` → `1****尾4位`）、`savePrivate(dir, {phone})`、`readPrivate(dir)`、`phoneTail(phone)`
- Produces: `store.js` → `readResearch(dir)/writeResearchField`（读写 state.research）、`saveSource/loadSources(dir)`、`saveRound/loadRounds(dir)`、`loadClaims/saveClaims(dir)`、`allocSourceId/allocClaimId(dir)`、`bumpReportVersion(dir)`（版本 0 起，v001 起）

- [ ] **Step 2.1** template.json：

```json
{
  "name": "person-research", "label": "人物研究", "available": true,
  "description": "输入姓名与线索 → 公开网页候选发现 → 人工确认 → 多轮定向研究 → 带来源引用的研究报告",
  "params": [
    { "name": "title", "label": "任务标题（可选）", "type": "text", "required": false },
    { "name": "name", "label": "姓名", "type": "text", "required": true, "placeholder": "要研究的人名" },
    { "name": "phone", "label": "手机号（可选，仅作公开网页匹配线索）", "type": "text", "required": false },
    { "name": "note", "label": "备注（如：小学同学 北京）", "type": "text", "required": false },
    { "name": "city", "label": "城市/地区", "type": "text", "required": false },
    { "name": "school", "label": "学校", "type": "text", "required": false },
    { "name": "company", "label": "公司/职业", "type": "text", "required": false },
    { "name": "knownUrl", "label": "已知链接/账号（可选）", "type": "text", "required": false },
    { "name": "focus", "label": "想重点了解的方向（可选）", "type": "text", "required": false }
  ],
  "steps": [
    { "id": "discovery", "name": "候选发现", "type": "tool", "awaitInput": true, "previewType": "json",
      "module": "./lib/discovery.js", "function": "runDiscovery",
      "args": ["{name}", "{phone}", "{note}", "{city}", "{school}", "{company}", "{knownUrl}", "{focus}", "{executionDir}"] },
    { "id": "research", "name": "定向研究", "type": "tool", "previewType": "json",
      "module": "./lib/research.js", "function": "runResearch", "args": ["{name}", "{executionDir}"] },
    { "id": "report", "name": "生成报告", "type": "tool", "previewType": "json",
      "module": "./lib/report.js", "function": "generateReport", "args": ["{name}", "{executionDir}"] }
  ]
}
```

- [ ] **Step 2.2** privacy redact 测试：`redactPhone("电话13812345678联系") === "电话1****5678联系"`；非手机号 11 位数字（如 `12345678901`）不动；`savePrivate` 后 `readPrivate` 回读、state.json 中不含 phone 原文。
- [ ] **Step 2.3** `npm run test:shared` 全绿。

### Task 3: 搜索客户端 + 查询规划 + 归一化（纯函数）

**Files:**
- Create: `packages/workflows/templates/person-research/lib/search-client.js`、`lib/queries.js`、`lib/normalize.js`

**Interfaces:**
- `search-client.js` → `searchWeb(query, {category, maxResults})`（GET search-service `/search`，`fetchContent=false`，返回 `results[]`，失败返回 `[]` + console.warn）；`scrape(url)`（GET `/scrape?url=`，失败返回 `null`）；`mapLimit(items, limit, fn)`（并发限制，用 `@app/shared/utils.js` 的 `withTimeout` 包裹）
- `queries.js` → `buildDiscoveryQueries({name, phone, city, school, company})` 返回 `[{query, category, reason}]`（姓名精确 / 姓名+新闻 / 姓名+采访 / 姓名+简历任职 / 线索组合 / 手机号公开匹配；上限 CONFIG.DISCOVERY_MAX_QUERIES，去重）；`buildFirstRoundQueriesFromFocus(name, focus)`（focus 有值时把研究方向转前几条查询，V1 静态拼接）
- `normalize.js` → `canonicalUrl(url)`（小写 host、去 hash、去 utm_*/spm 等追踪参、排序剩余参数）、`sameSource(a, b)`（canonicalUrl 相等）、`domainOf(url)`、`domainClass(domain)`（`gov.cn|edu.cn|\.org$`→A；主流新闻域名正则清单→B；`baike|zhihu|weibo|36kr|企查查类|aggregation`→C；其余→D）

- [ ] **Step 3.1** queries 测试：无线索时 ≥3 条且全含姓名；有 city/school 时出现组合查询；有 phone 时出现裸号码查询且带 reason `"phone-match"`；查询数不超上限、无重复。
- [ ] **Step 3.2** normalize 测试：`https://a.com/x?utm_source=g&r=2` 与 `https://A.com/x?r=2` 判同；`gov.cn` → A；`mp.weixin.qq.com` → C。
- [ ] **Step 3.3** `npm run test:shared` 全绿。

### Task 4: prompts.js（LLM 契约，纯函数）+ discovery.js

**Files:**
- Create: `lib/prompts.js`、`lib/discovery.js`

**Interfaces:**
- `prompts.js` 导出（全部纯：字符串进出）：
  - `buildClusterPrompt(profile, sources)` + `validateClusterOutput(json, sources)`：聚类候选+抽取主张。输出 schema：`{ candidates: [{id:"a1", displayName, identitySummary, signals:{city,school,company,occupation}, sourceIds, confidence, reason}], claims: [{id:"c1", claim, candidateId, quote, sourceIds, publishedAt|null, status:"single_source"}], irrelevantSourceIds: [] }`。校验：候选 sourceIds ⊆ sources、confidence 枚举、quote ≤ QUOTE_MAX 且非空（空 quote 剔除该 claim）、sourceIds 非空、手机号过 redactPhone。
  - `buildIntentPrompt(profile, message, doneQueries)` + `validateIntentOutput(json)`：`{ intent, queries: [≤RESEARCH_MAX_QUERIES 条非空字符串] }`
  - `buildExtractPrompt(profile, candidate, newSources, existingClaims)` + `validateExtractOutput(json, sources, claims)`：`{ newClaims: [{claim, quote, sourceIds, publishedAt}], updates: [{claimId, addSourceIds}], conflicts: [{claim, note, sourceIds}] }`
  - `buildReportPrompt(name, candidates, claims, sourcesMeta, rounds)`（规则内嵌：`[S#]` 引用、状态标注、可能为同一人措辞、禁止完整手机号、无证据章节省略）+ `validateReportCitations(md, sources)`（`[S(\d+)]` 引用的 id 必须存在，未知引用删除并 warn）
- `discovery.js` → `runDiscovery(name, phone, note, city, school, company, knownUrl, focus, executionDir)`：
  1. `savePrivate`（phone 入 private.json；state.research.clues 记 phoneTail + 原文仅存 private）
  2. `buildDiscoveryQueries` → `mapLimit` 并发搜索 → 结果 canonicalUrl 去重（跨查询合并 engines）→ 全部落 `sources/`（alloc id，foundInRound=1）
  3. 选 top `SCRAPE_PER_ROUND` 页（排序：domainClass A/B 优先、rank 靠前、每域名 ≤ DOMAIN_SCRAPE_CAP）→ `scrape` → content 截断回写
  4. `callLLM(buildClusterPrompt)` → `parseJSON` → `validateClusterOutput`（storyboard 式 ≤5 次重试，校验错误回灌 prompt）
  5. 写 `rounds/001-discovery.json` + state.research（candidates/claimIds/rounds/seq）
  6. 返回步骤 output：`{ summary, candidates: [{displayName, confidence}], sources: N, round: 1 }`
  - 搜索全挂不算失败：来源 0 时返回 `{ summary: "未发现可用公开来源", candidates: [], ... }` 并让流程继续停靠（awaitInput），用户可补线索继续

- [ ] **Step 4.1** validateClusterOutput 测试：quote 超长剔除、sourceIds 越界剔除、confidence 非法剔除、手机号被脱敏、空候选数组合法（noneFound 场景）。
- [ ] **Step 4.2** validateReportCitations 测试：`[S1]` 有效保留、`[S9]` 无效删除。
- [ ] **Step 4.3** buildClusterPrompt 快照断言：包含姓名、线索、每个来源的 id/url/domain/正文截断。
- [ ] **Step 4.4** `npm run test:shared` 全绿。

### Task 5: research.js（多轮）

**Files:**
- Create: `lib/research.js`（复用 Task 3/4 接口）

**Interfaces:**
- `runResearch(name, executionDir)`：
  1. 读 `state.research.pendingRound`（无则抛错——research 只能由 continue 触发）
  2. `callLLM(buildIntentPrompt(用户 message + 已选中候选 + doneQueries))` → 定向查询（≤5）
  3. 搜索 → 对已有 sources canonicalUrl 去重 → 新来源落盘 + scrape top 4
  4. `callLLM(buildExtractPrompt(新来源 + 既有 claims))` → validate → `evidence.apply(claims, output)`（纯函数，放 prompts.js 或独立 `lib/evidence.js`：updates 合并 sourceIds → 独立域名 ≥2 时 status 升 `supported`；conflicts 生成新 claim status=`conflicting` 并在原 claim.conflicts 挂引用）
  5. 写 rounds/00N + pendingRound=null + rounds 摘要
  6. 返回 `{ round: N, queries, newSources, newClaims, summary }`

- [ ] **Step 5.1** evidence.apply 纯函数测试：两独立域名 → supported；同域名两来源 → 仍 single_source；conflicts 生成 conflicting claim 且双向引用。
- [ ] **Step 5.2** `npm run test:shared` 全绿。

### Task 6: report.js

**Files:**
- Create: `lib/report.js`

**Interfaces:**
- `generateReport(name, executionDir)`：
  1. 读 candidates + claims + sources 元数据 + rounds
  2. `callLLM(buildReportPrompt)`（≤3 次重试，`validateReportCitations` 错误回灌）
  3. `redactPhone` 全文过滤 → 写 `report/v{NNN}.md` + `current.md`（bumpReportVersion）
  4. 返回 `{ version, path: "report/current.md", sections: N, claims: M }`
  - claims 为空时直接写模板化「暂无可核查公开信息」报告（不调 LLM）

- [ ] **Step 6.1** 测试：空 claims 走模板分支不调 LLM（把 LLM 调用抽出 `generateReportWithLLM` 供覆盖断言，单测只测空分支 + 版本递增 + redactPhone 已落盘）。
- [ ] **Step 6.2** `npm run test:shared` 全绿。

### Task 7: actions + handlers + http 注册

**Files:**
- Create: `lib/handlers.js`
- Modify: `packages/workflows/http.js`、`templates/person-research/actions.json`

**Interfaces:**
- `handlers.js` 导出三个 handler（scene-groups 模式：`handle({ params, request })`）+ 纯函数 `applySelectInState(state, {candidateId, action})`、`applyContinueInState(state, message)`（可单测）：
  - `applySelectInState`：candidate.status = selected/rejected/ambiguous；若 selected → pendingRound = `{ kind: "research", input: "(选择了候选 ${displayName})" }`
  - `applyContinueInState`：clues 合并（V1：message 整段存 pendingRound.input，不解析进 clues 字段——提示词里已把 message 交给 intent LLM）；pendingRound = `{ kind: "research", input: message }`
  - 两个函数共同收尾：research/report 步骤重臂（status=pending、output=null、error=null、retryForce 删除）、`state.status = "running"`
  - `handleSelect`：读 state → 校验模板是 person-research 且 status 非 running → apply → writeState → `{ ok: true }`
  - `handleContinue`：同构，body `{ message }` 必填
  - `handleReport`（GET）：组装 `{ ok, reportMd, version, candidates, claims, rounds, sources: [{id,url,title,domain,domainClass,scraped}] }`（sources 只给元数据，防 state 膨胀）
- actions.json（模板级）：

```json
[
  { "type": "custom", "method": "POST", "path": "/execution/:id/research-select",   "handler": "person-research-select" },
  { "type": "custom", "method": "POST", "path": "/execution/:id/research-continue", "handler": "person-research-continue" },
  { "type": "custom", "method": "GET",  "path": "/execution/:id/research-report",   "handler": "person-research-report" }
]
```

- http.js：import 三个 handle 并加进 CUSTOM_HANDLERS（键名同上）。启动后 dispatcher 重复路径检测自动生效。

- [ ] **Step 7.1** applySelectInState/applyContinueInState 纯函数测试：选中置 pendingRound + 步骤重臂 + status running；rejected 不触发 pendingRound；非 person-research 状态 running 时 handle 返回错误。
- [ ] **Step 7.2** `npm run test:shared` + `node packages/workflows/cli.js templates` 仍 4+1 模板正常（person-research 现在有 template.json，应出现在列表）。
- [ ] **Step 7.3** 冒烟：`node packages/workflows/cli.js start '{"template":"person-research","params":{"name":"测试"}}'` 创建成功（不执行）。

### Task 8: 前端研究面板

**Files:**
- Create: `packages/ai-chat/src/components/workflow/person-research-panel.tsx`
- Modify: `packages/ai-chat/src/app/(main)/workflow/execution/[id]/page.tsx`

**Interfaces:**
- Panel props：`{ executionId: string; status: string; anyStepRunning: boolean; onRefresh: () => void }`
- Panel 行为：
  - `useEffect` 轮询 `GET /api/workflows/execution/${id}/research-report`（anyStepRunning 时 3s，否则停）；停靠 `awaiting_input` 或 completed 后渲染完整面板
  - 候选卡：displayName、identitySummary、signals 徽章、confidence、reason、来源链接列表（sources url）、「选定此人 / 排除」按钮 → `POST research-select` → `POST /execution/${id}/auto`（detached，复用现有端点）→ onRefresh
  - 报告区：ReactMarkdown 渲染 reportMd（引 message-item.tsx 的 markdown 样式类，不引聊天专属组件）+ 「下载 .md」链接 `/api/workflows/execution/${id}/file/report/current.md`（现有 stream 原语直出）
  - 研究轮次列表：rounds（n、input、queryCount、newSources）
  - 底部输入框 + 建议按钮（静态：继续查教育经历 / 任职与公司 / 新闻时间线 / 公开账号）→ `POST research-continue {message}` → `POST auto` → onRefresh
  - discovery/research running 时显示进度条（steps 状态已有通用 UI，Panel 顶部给一行「正在检索/研究中…」）
- execution page 改动（对齐 isComic/isFloorplan 模式）：
  - `const isPersonResearch = execution?.template === "person-research"`
  - 面板渲染：isPersonResearch 时在步骤条下方渲染 `<PersonResearchPanel .../>`，隐藏 comic/floorplan 专属块
  - 自动启动：isPersonResearch && execution.status === "pending" 且无 running 步 → useEffect 恰好触发一次 `POST /execution/${id}/auto`
  - 状态徽章把 `awaiting_input` 显示为「等待确认」

- [ ] **Step 8.1** `npm run typecheck` 全绿。
- [ ] **Step 8.2** `npm run build` 全绿（ai-chat 打包含新组件与 http.js 新 handler）。
- [ ] **Step 8.3** dev 起服务手工冒烟：创建任务 → 自动 discovery → 停靠 → 选候选 → research+report → completed → continue 再来一轮。

### Task 9: 收尾同步

**Files:**
- Modify: `ARCHITECTURE.md`（模板段落从「规划中」改为已实现描述 + 引擎 awaitInput 机制一行）、`templates/person-research/PLAN.md`（V1 标记已实现）、`CHANGELOG.md`（补一条 v0.11.51）

- [ ] **Step 9.1** `npm run typecheck && npm run test` 全绿。
- [ ] **Step 9.2** ARCHITECTURE/CHANGELOG 同步（遵守仓库：结构变化才动 ARCHITECTURE；版本变更写 CHANGELOG）。

## Self-Review 结论

- PLAN.md §4 覆盖检查：输入(§4.1→template.json params)✓ 状态机(§4.2→awaitInput+handlers)✓ 目录(§4.3→store.js)✓ 数据模型(§4.4→Global Constraints 结构)✓ 每轮数据流(§4.5→discovery/research)✓ 报告章节(§4.6→report prompt)✓ API(§4.7→3 action，路径随仓库 `/execution/:id/*` 惯例收敛)✓ 页面(§4.8→Panel)✓ 失败预算(§4.9→config.js + 搜索全挂不失败)✓ 隐私红线(§2→privacy.js)✓
- 类型一致：sourceId `s-N`、claimId `c-N`、round `r-N` 贯穿；`handle({params, request})` 签名与 scene-groups 一致
- 有意留白（V1 范围外，PLAN.md 版本路线已记录）：自然语言 clues 结构化解析（V1 整段进 prompt）、来源点击二次深挖按钮（V2）、报告章节独立刷新（V2）
