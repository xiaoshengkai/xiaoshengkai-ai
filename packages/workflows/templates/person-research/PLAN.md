# 人物公开信息研究工作流（person-research）计划

> 状态：**V1 + 商业版图 + 纠错闭环 + V1.1 漏斗 + V1.2 整人纠错已实现**（v0.11.51~54 见前；V1.2 整人否定/负向锚点/redirect 重新识别/报告级纠错入口 v0.11.58）；V2~V4 未实现
> 日期：2026-10-28（V1.1/V1.2 2026-10-29）
> 用途：个人自用，不上线、不盈利

## 1. 定位

输入姓名和可选身份线索，实时检索公开网页，产出候选人物 → 用户确认 → 多轮定向研究 → 带证据引用的研究报告。

- **不是通用搜索引擎**：不做全网爬取、不做长期索引，实时搜索 + 任务内证据沉淀。
- **不是人肉搜索器**：只聚合合法公开信息，不接泄露库、不反查敏感隐私。
- **核心价值**：每条结论可追溯（来源 URL + 原文摘录 + 发布时间 + 证据状态），而不是一次性 AI 总结。

## 2. 合法性与隐私红线（硬边界）

- 只检索公开网页；不绕过登录、验证码、付费墙、隐私设置。
- 手机号仅作为**公开页面匹配线索**（限用户本人通讯录、已授权的熟人），只查公开网页中明确出现该号码的页面；不接入泄露库 / 黑产库 / 付费反查库。
- 不推断住址、身份证、家庭成员、实时位置、财产等敏感信息。
- 普通人只输出「可能匹配」候选，不生成确定性人物档案。
- 手机号原文存 `private.json` 与报告隔离；导出报告不含完整号码（只显示后四位 + 是否公开匹配）。
- 用户补充的信息标记 `user_provided`，不伪装成公开来源事实。
- 用户标注（是/不是本人、来源可信与否）只影响当前任务，不写入全局知识库。

## 3. 总体架构

```
人物研究页面（/workflow/type/person-research）
    ↓
人物研究 API（本模板 actions.json，custom handler 挂在 http.js）
    ↓
person-research 编排（本模板 lib/）
    查询规划 / 候选聚类 / 证据抽取 / 报告生成 / 任务持久化
        ↓ 复用
通用 Search Service（packages/services/search）
    searchWeb / scrapeWebPage / parseDocument + 去重 / 抓取回退 / 限额
```

分层原则：

- **MCP search 工具保持通用原子能力**（searchWeb / scrapeWebPage / parseDocument），人物逻辑不进 MCP。
- **Search Service 负责搜索质量**（多源、去重、回退、来源分类），不知道「候选人物」是什么。
- **本模板负责研究逻辑**：研究谁、研究什么、如何组织结论与证据。
- 工作流引擎只做一处通用增强：`awaiting_user_input` 状态 + 从该状态恢复（见 §6）。

## 4. V1 范围：单人物研究闭环

只做**单个人物**研究；不做批量通讯录导入、长期人物索引、后台定时追踪。

### 4.1 输入

```
姓名            必填
手机号          可选，仅作公开页面匹配线索（限本人通讯录已授权熟人）
备注            可选（如「小学同学 北京」）
城市/地区       可选
学校            可选
公司/职业       可选
年龄段          可选
已知链接/账号   可选（强身份锚点）
研究重点        可选
```

允许只输入姓名开始，但结果必须标记「身份未确认」。

### 4.2 状态机

```
draft → discovering → awaiting_user_review → researching → awaiting_user_input
                                    ↑                          │
                                    └──────────────────────────┘
                                     （可反复回到等待输入）

终态：report_ready / completed / failed
```

`awaiting_user_input` 是核心状态，用户可随时：

- 补充身份线索（城市、学校、公司、英文名、「这条结果就是他」）
- 选择 / 排除 / 切换候选
- 对某条来源、某个实体（公司 / 学校 / 事件 / 论文 / 公开账号）定向继续搜索
- 标记来源可信 / 错误 / 忽略
- 指定报告章节深挖、要求刷新报告
- 回退查看上一版报告

### 4.3 任务目录（沿用 data/workflows/tasks/&lt;executionId&gt;/）

```
<executionId>/
├── state.json              # 状态、输入、候选、进度
├── rounds/
│   ├── 001-discovery.json  # 每轮：用户输入、查询、结果、证据、结论
│   └── 002-research.json
├── sources/
│   └── <hash>.json         # URL、标题、域名、发布时间、正文摘要、抓取状态
├── report/
│   ├── current.md          # 当前报告
│   ├── v001.md ...          # 历史版本（不覆盖）
└── private.json             # 原始手机号等私密输入（与报告隔离，导出不带出）
```

每轮结构：

```json
{
  "round": 2,
  "userInput": "继续查他在杭州的教育经历",
  "scope": { "candidateId": "candidate-1", "entity": "education" },
  "queries": [],
  "sourceIds": [],
  "claimIds": [],
  "createdAt": "..."
}
```

### 4.4 数据模型（V1 就要定稳、后续版本不改名的字段）

`sourceId / candidateId / claimId / roundId / reportVersion / status / origin / confidence`

候选人物：

```json
{
  "candidateId": "candidate-1",
  "displayName": "张三 · 某公司 前端工程师",
  "matchedSignals": {
    "name": true, "phoneOnPublicPage": false,
    "city": "杭州", "school": null, "company": "某公司", "occupation": "工程师"
  },
  "sourceIds": ["s-1", "s-2"],
  "confidence": "medium",
  "status": "unconfirmed"
}
```

`confidence` 只表示公开证据间的匹配程度（low：仅姓名 / medium：姓名+一项线索 / high：多独立来源一致），high 仍用「可能为同一人」表述。候选 status：`unconfirmed / selected / rejected / ambiguous`。

证据（claim）：

```json
{
  "claimId": "c-1",
  "claim": "张三曾在某公司任职",
  "subject": "candidate-1",
  "sourceIds": ["s-1", "s-2"],
  "quote": "网页中支持该结论的原文摘录",
  "publishedAt": "2024-05-01",
  "observedAt": "2026-10-28",
  "status": "supported",
  "confidence": "medium",
  "conflicts": [],
  "origin": "public_web"
}
```

证据状态：

| status | 含义 |
|---|---|
| `supported` | 多个独立来源一致 |
| `single_source` | 仅单一来源 |
| `conflicting` | 来源之间冲突（并列保存，不自动裁决） |
| `user_provided` | 用户补充，未经公开来源验证 |
| `unverified` | 有线索但无法确认 |
| `rejected` | 用户标记错误 / 不属于目标人物 |

来源分级：

- **A**：政府、学校、企业官网、官方公告、本人公开主页
- **B**：正规新闻媒体、学术数据库、会议/项目资料
- **C**：企业信息平台、职业平台、百科、聚合站
- **D**：论坛、转载站、匿名内容（只能作待核实线索，不当事实）

多篇转载可能只有一个原始来源，「来源数量多」不等价于可靠，需识别转载链。

### 4.5 每轮数据流

```
用户输入 → 解析研究意图与约束
→ 生成定向查询集合（姓名/别名/线索组合，含 site:gov.cn / site:edu.cn / filetype:pdf 等变体）
→ 并发执行网页 / 新闻 / 定向站点搜索
→ URL 规范化 + 去重 + 转载聚类
→ 抓取高价值页面正文（失败回退，保留标题/摘要/URL）
→ LLM 抽取实体、时间、关系和证据片段
→ 更新候选 / 事实 / 冲突
→ 生成本轮结果 + 下一步建议
→ 等待用户继续
```

手机号只允许作为公开页面检索条件（`"号码"` / `"姓名" "号码"` / `"号码" 公司`），查询与结果见 §2 红线。

### 4.6 报告章节（按实际证据动态生成，不强行填空）

```
人物识别与匹配依据 / 公开基本资料 / 教育经历 / 职业与任职经历
公司机构关系 / 作品论文项目 / 新闻与事件时间线
公开采访与观点 / 公开账号和主页 / 来源冲突与待核实项
本轮研究结论 / 下一步建议
```

每个结论带来源编号，点击可查看：页面标题、URL、域名、发布时间、抓取时间、原文摘录、抓取失败原因。

三层结果保留：**原始结果（搜索到的页面）→ 证据摘录（支持结论的片段）→ 研究结论（模型判断）**，可快速检查模型是否理解错网页。

报告版本化：v1 仅姓名 → v2 补城市 → v3 确认公司 → v4 追加教育核实，不覆盖历史。

### 4.7 API（本模板 actions.json，挂 /api/workflows 下）

```
POST   /person-research                    创建任务，启动候选发现
GET    /person-research/:id                状态、候选、轮次、当前报告
POST   /person-research/:id/select         选择 / 排除 / 标记候选
POST   /person-research/:id/continue       补充线索或定向继续（自然语言，后端解析意图）
POST   /person-research/:id/refresh        重抓指定来源或重生成报告
GET    /person-research/:id/report         Markdown / 结构化报告
DELETE /person-research/:id                删除任务（含 private.json 与中间来源）
```

`continue` 请求示例：`{ "message": "继续查他的教育经历", "scope": { "candidateId": "...", "entity": "education" } }`。前端不预分类，后端统一解析。

### 4.8 页面交互

```
输入页 → 候选发现中 → 候选列表 → 用户选择/排除/补充 → 深度研究中 → 报告草稿 → 继续搜索 → 报告刷新
```

- 候选卡片：匹配线索、关联组织、公开地区、代表性来源、与其他候选的区别、置信度与不确定性。
- 每阶段显示：当前状态、已执行查询数、已发现来源数、正文抓取成功/失败数、候选数、最近一轮做了什么。
- 底部：`[补充线索或继续搜索……] [发送]` + 系统建议的下一步操作按钮（继续查教育经历 / 任职 / 某段新闻 / 核实候选 / 公开账号 / 与某公司关系）。

### 4.9 失败处理与研究预算

```
搜索源失败     → 切换其他源并标记 degraded，不废任务
正文抓取失败   → 保留标题/摘要/URL（contentFetched=false）
页面重复       → 合并来源，不重复计数
来源冲突       → 并列保存，不自动裁决
模型输出失败   → 保留原始证据，允许重新生成报告
任务中断       → 从最后一个持久化步骤恢复
```

预算为配置项（不写死页面逻辑）：

```
每轮最多 N 个查询 / N 个正文页面 / 单域名抓取上限 / 总超时
信息增量低于阈值时提示「继续搜索收益可能较低」，用户可手动深挖
```

## 5. 搜索服务通用增强 + 相关性漏斗（V1.1，已实现 v0.11.54）

根因（V1 实测）：406 条持久化来源仅 0.7% 含姓名、0.5% 被引用——无人物相关性门槛。

- Search Service：`cleanResults` 通用清洗（垃圾/undefined 页/错误页/反爬拦截 + URL 去重并引擎 + 标题去重）+ `strategy=auto|primary|expand` + `cleaning` 统计 + `SEARCH_SERVICE_PORT` env
- `lib/relevance.js`：规则评分（姓名标题5/摘要4/正文2 取最高；线索+3；手机号/已知URL+8；A+2/B+1）→ ≥6 direct / 3~5 边界 LLM 批量复核（≤10）/ <3 丢弃
- 三级模式：高精度首搜（primary）→ ≤2 有效来源自动扩搜一次（SearXNG+线索变体）→ 用户「深挖」放宽（低分降 `lead_only` ≤20，不进事实主张）
- 来源质量字段：`relevanceScore / relevanceDecision / matchedSignals / candidateHint / evidenceUse(evidence|lead_only)`；商业聚合站页走 lead_only（保二跳通道）
- 过滤审计：轮次 `filterStats` 全链路计数，不保存被拒页面
- 验收（雷军实测）：首搜 24→12（12/12 相关）；引用率 0.5%→46%；lead 被引用 0；自动阶段 ≤30 ✓

## 6. 工作流引擎增强（通用、最小）

现有引擎是线性步骤，无人工等待。只增加：

- `awaiting_user_input` 步骤状态（对应 state 里的待输入态）
- 从该状态恢复执行的入口（选择候选 / continue 触发下一步，不重跑已完成步骤）
- 模板级 actions（select / continue）写回 state 后驱动恢复

不做通用 workflow DSL、不做任意暂停点，只服务「等用户输入→继续」这一个模式。

## 7. 版本路线

| 版本 | 主题 | 内容 |
|---|---|---|
| **V1** | 单人物闭环 | 本文档 §4 全部：候选发现、人工确认、多轮研究、证据链、版本化报告、导出（Markdown + JSON + 来源清单） |
| **V1.1** | 搜索质量 | §5；用 V1 真实案例评估搜索质量与误判率后定向优化 |
| **V2** | 研究工作台 | 点击任意来源/实体继续搜、锁定排除候选、标记来源、人物关系图、时间线交互、报告章节独立刷新、自动推荐下一步 |
| **V3** | 实体与证据系统 | 人物实体合并、别名/英文名关联、公司学校关系图、时间线冲突检测、事实版本管理、来源变更检测、跨任务复用**用户确认过的公开证据**（不默认建普通人长期档案库） |
| **V4** | 长期追踪（可选） | 新闻监测、页面变化检测、新事件提醒、周期性报告更新（引入定时任务/通知/保留策略，确认需要才做） |

V1 的数据结构按 V2 关系图、V3 实体合并不推翻来设计（§4.4 字段定稳）。

## 8. 明确不做（V1）

- 批量通讯录导入与逐个研究
- 全网自建爬虫 / 长期倒排索引 / 向量索引库
- 后台自动追踪人物
- 自动访问登录后内容、绕过验证码/付费墙
- 泄露库 / 黑产库 / 付费手机号反查
- 通过手机号推断住址、身份证、家人、实时位置
- 一次性承诺「完整人物档案」的确定性报告

## 9. 测试范围

- 输入校验：姓名必填；手机号格式标准化但不写入公开报告
- 查询生成：姓名、别名、城市、学校、公司与用户追加问题的组合
- URL 规范化与去重；新闻转载聚类
- 候选聚类与排除候选
- 证据状态流转：single_source → supported / conflicting / user_provided / rejected
- 手机号仅作公开页面匹配线索（红线行为测试）
- 工作流暂停（awaiting_user_input）、恢复、重复 continue
- 搜索源失败降级；正文抓取失败保留搜索结果
- 报告引用与原文摘录一一对应
- 删除任务同时删除 private.json 与中间来源
- 现有 searchWeb / 工作流 / 聊天能力不回归（npm run typecheck + test）

## 10. 实现落点（V1 开工时）

```
packages/workflows/templates/person-research/
├── template.json        # 参数表单 + 步骤
├── actions.json         # §4.7 七个动作（custom handler 注册进 http.js）
└── lib/
    ├── discovery.js     # 候选发现轮
    ├── queries.js       # 查询规划与意图解析
    ├── cluster-candidates.js
    ├── research.js      # 定向研究轮编排
    ├── evidence.js      # 证据抽取 / 状态 / 冲突
    ├── report.js        # 报告生成与版本
    └── privacy.js       # 手机号脱敏、private.json 隔离、导出净化

packages/services/search/            # §5 通用增强
packages/workflows/engine.js + cli.js # §6 awaiting_user_input 最小增强
packages/ai-chat/src/app/(main)/workflow/  # 研究页面
```
