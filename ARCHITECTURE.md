# 代码实现说明

> **本文档是"代码现在怎么组织"的单一真相源**：目录结构、模块职责、各子系统实现机制。
> 设计决策 / 规范 / 约定 / 部署见 `DESIGN.md`；版本变更历史见 `CHANGELOG.md`。
>
> **同步规则**：目录结构 / 模块职责 / 包依赖发生变化时同步更新本文档；纯逻辑改动不涉及结构的不用动。

## 包拓扑

```
npm workspaces（根 package.json，packages/*）

@app/shared ──── 公共叶子：logger / network / utils / llm / capability（被所有包裸导入）
     ▲
     │ 依赖
     │
ai-chat（Next.js，组合根）──注册──▶ workflows / tasks / mcp / skills
     │                                （能力 100% 在包内，ai-chat 只留挂载点）
     ├─ stdio spawn ──▶ mcp（35 tools，自包含）
     ├─ stdio spawn ──▶ chromadb（Python standalone :8000）
     └─ catch-all 委托 ─▶ @app/workflows/http、@app/tasks/http

tasks/scheduler.js（常驻 cron 进程，独立于 ai-chat）
```

原则：**ai-chat 只做注册，不写能力逻辑**；能力包自包含（含自己的 HTTP 动作声明）；模板不 import engine（cli 是子进程组合层）。

## 目录结构

```
ai-engineer-journey/
├── package.json                # npm workspaces 根配置
├── .env / .env.example         # 共享环境变量
├── DESIGN.md                   # 设计决策 / 规范 / 部署
├── ARCHITECTURE.md             # 本文档（代码实现说明）
├── CHANGELOG.md
├── config/
│   ├── network.json            # 端口 / host 单一真相源
│   └── README.md               # 字段 + 消费者清单
├── scripts/                    # 部署 / 运维脚本
│   ├── prod.sh / dev.sh / stop.sh / log.sh
│   ├── log-wrap.js             # 子服务日志包装（spawn 子进程 → stdout/stderr 逐行写按日日志）
│   ├── proxy.cjs               # 反向代理（serve site/ + 转发 /ai）
│   └── fix-transformers-mjs.mjs / compress-images.cjs
├── data/                       # 运行时数据（chroma / tasks / settings / static / workflows）
├── logs/                       # 日志（app/ + tasks/ + services/ + workflows/）
├── site/                       # 博客静态文件
└── packages/
    ├── shared/                 # 跨包共享模块（@app/shared workspace 包，裸导入）
    │   ├── package.json        # name: @app/shared（private, type: module）
    │   ├── capability.js       # 通用能力 dispatcher（actions.json 4 原语）
    │   ├── logger.js           # 统一日志
    │   ├── network.js          # loadNetworkConfig 共享读取器
    │   ├── utils.js            # sleep / shortId / downloadsDir
    │   ├── test/               # 共享测试（capability / llm-dispatch / tts-timeout / engine-status / ai-chat-multimodal / comic-workflow / conversations-store）
    │   └── llm/                # LLM 共享封装
    │       ├── index.js        # callLLM / generateTTS / generateBGM / generateMusic / generateImage / provider 读取
    │       ├── config.js       # providers.json / selection.json fresh-read（真源，env 兜底）
    │       ├── balance.js      # 模型概况余额/可用性查询（差异抹平：deepseek 余额 / 火山 GetAFPUsage / minimax·glm·qwen 探测）
    │       ├── parse-json.js   # 容错 JSON 解析
    │       └── providers/      # deepseek.js / glm.js / minimax.js / qwen.js / volcengine.js(Seedream 图片)
    ├── ai-chat/                # 业务服务（Next.js，组合根）
    │   ├── src/
    │   │   ├── instrumentation.ts      # 启动时 initSettings + spawn chroma
    │   │   ├── lib/
    │   │   │   ├── core/        # LLM 基础设施：embedding / workflow-model / fetch-interceptors
    │   │   │   ├── strategies/  # chat 路由：chat-strategy + 4 provider strategy（deepseek/glm/minimax/qwen，classifyTask 在 deepseek.ts）
    │   │   │   ├── multimodal/  # 附件处理：attachment / image / video(仅 stripVideos) / pipeline / preprocess(复用 vision 模块) / modality-detector / multimodal-config / mime
    │   │   │   ├── rag/         # retrieve.ts / vector-store.ts / chroma-server.ts
    │   │   │   ├── settings/    # store / init / dispatcher / types
    │   │   │   ├── services/    # manager.ts：packages/services/* 清单扫描 + 启停/健康检查（服务监控）
    │   │   │   ├── mcp-client.ts
    │   │   │   └── utils/       # utils(cn+BASE) / types / cost / env
    │   │   └── app/
    │   │       ├── (main)/      # page（对话）/ memory / schedule / workflow（三层：主页类型卡片 → type/[templateId] 类型列表 → execution/[id] 详情）
    │   │       ├── api/         # chat / memory / settings / services / conversations ... + workflows、tasks 仅 catch-all 挂载点
    │   │       ├── note/[taskId]/page.tsx
    │   │       ├── preview/[taskId]/route.ts
    │   │       ├── settings/page.tsx
    │   │       └── layout.tsx / globals.css
    │   ├── scripts/             # generate-embeddings / verify-migration
    │   └── package.json
    ├── mcp/                     # MCP 工具服务（35 tools，详见「MCP 系统」）
    ├── skills/                  # 技能模块（image-styles / blog / github-gem-seeker / xiaohongshu-note / task）
    ├── services/                # 独立常驻服务（非 npm workspace 内聚目录）
    │   └── search/              # 联网搜索服务（本地 SearXNG + Firecrawl Cloud 正文抓取）
    ├── tasks/                   # 定时任务（@app/tasks，详见「定时任务系统」）
    └── workflows/               # 工作流引擎（@app/workflows，详见「工作流系统」）
        ├── package.json
        ├── actions.json         # 引擎级 HTTP 动作声明（18 个：执行 10 + 资产库 8）
        ├── http.js              # 能力 HTTP 入口（合并引擎+模板 actions）
        ├── cli.js               # 命令行入口（子进程组合层）
        ├── engine.js            # 工作流执行引擎（纯步骤编排，无 video 概念）
        ├── lib/
        │   ├── executor.js      # 步骤执行 + 模板加载
        │   ├── state.js         # DATA_DIR / LOG_DIR / readState / writeState / saveVideoVersion（engine 与模板共用）
        │   ├── assets.js        # 资产库 handler（角色参考图 / 风格，工作流级通用）
        │   ├── skip-when.js     # skipWhen 条件求值（engine 与模板共用）
        │   ├── tweak-auto.js    # tweak 全流程编排（running→tweak→auto→done/failed）
        │   └── step-types/      # ai.js / script.js / tool.js
        └── templates/
            ├── tech-video/      # 科技风短视频（7 步：script/validate/tts-scenes/bgm/sfx-pick/render/concat）
            ├── video-generation/# 视频生成（4 步：script/tts/bgm/render）
            │   ├── actions.json # 模板级动作（generate-content/upload/tweak/switch-version）
            │   └── lib/         # prompt / generate-content / tweak / switch-version / script-version / tweak-builder / schema / render / tts / bgm / ...
            ├── comic-generation/# 漫画生成（2 步：script/generate-pages）
                ├── actions.json # 模板级动作（export / scene-group / generate-content）
                └── lib/         # storyboard / generate-pages / tweak / scene-groups / export / generate-content
            └── floorplan-remodel/# 户型改造（2 步：parse/generate；视觉识别结构→人工确认底图→纯二维矢量方案 红=砸墙蓝=砌墙）
                ├── actions.json # 模板级动作（floorplan-upload / confirm-structure）
                ├── rules.json   # 户型规则（尺寸下限+设计准则）
                └── lib/         # parse（视觉+sharp 墙像素 mask 吸附+quality.json）/ generate（承重硬校验+可拆白名单+按方案判定不回退）/ metrics（px→mm/面积/房间类型）/ confirm（confirm-structure：写回结构+confirmed 盖章）/ render（纯二维矢量+门窗符号+洁具图元）/ snap（墙像素 mask/吸附/外围 bbox）
```

## 能力注册机制（v0.11.0）

ai-chat 对 workflows/tasks 只保留 1 个 catch-all 挂载点（`app/api/{workflows,tasks}/[[...path]]/route.ts`，10 行纯委托），能力 100% 在包内。

```
请求 → catch-all → 包 http.js（合并 actions）→ @app/shared/capability.js dispatcher
     → 按 actions.json 匹配 method+path → 执行原语 → Response
```

**4 原语**（`capability.js`）：

| 原语 | 行为 | 使用方 |
|---|---|---|
| `cli` | spawn `node cli.js <command> <json>`，解析 stdout JSON；支持 required 校验 / notFound→404 / timeout / detached fire&forget | workflows 通用动作 |
| `stream` | 文件流 + Range 206 + 穿越守卫 + MIME | file/* |
| `upload` | formData 收文件写盘（扩展名白名单） | BGM 上传 |
| `custom` | 包内 JS handler（http.js 静态注入函数） | generate-content / tasks 全套 |

**动作声明位置**：

- `workflows/actions.json`：引擎级 18 动作（执行 10：templates / execute / executions / get / delete / file / next / auto / retry / skip；资产库 8：characters 列表/生成/保存/删除/文件流 + styles 列表/创建/删除）
- `templates/<name>/actions.json`：模板特有动作；video-generation 声明 generate-content / upload / tweak / switch-version；comic-generation 声明 export / scene-group / generate-content；http.js 启动时扫描合并，method+path 重复即抛错
- `tasks/actions.json`：list / run / edit / dashboard（handler 在 `tasks/lib/handlers.js`）

**路径匹配**：`:name` 捕获段、尾部 `*` 捕获剩余段；`required` 对 undefined/null/"" 判缺（`version=0` 合法）。

**关键约定**：被 Next webpack 打包的代码（各包 http.js / handlers.js）用 `process.cwd()`（= packages/ai-chat）定位磁盘文件，不用 import.meta.url；纯 node 代码（cli / engine / 模板）用 import.meta.url。

## 知识库架构

### 多库多表

```
shared/  — 规则、偏好、个人信息
  └── base_knowledge

chat/    — 聊天产生的内容，按主题分 collection
  ├── chat_knowledge（默认）
  └── learn-<主题>（学习笔记，如 learn-finance）

code/    — 编码记忆，按项目名分 collection
  └── <项目名>（basename(process.cwd())）
```

### RAG 预检索

`retrieve.ts` 动态获取 shared + chat 所有 collection，不做硬编码。`listCollections(database)` 函数（60s 缓存），未来任何新 collection 自动纳入检索。

### 工具使用

- `addKnowledge`: 主题笔记 → `database="chat" collection="<命名>"`，一般对话 → `database="chat"`（不传 collection）
- `searchKnowledge`: 默认搜 shared + chat/chat_knowledge，传 database 和 collection 时搜 shared + 指定库表
- `searchKnowledge` 每个 collection 取 `topK * 3`，合并后截断，避免跨 collection 遗漏

## SKILL 系统

```
Skills = 知识（What）   ← 静态 SKILL.md 文件，描述"怎么做得好"
MCP    = 执行（How）    ← 工具函数，执行具体操作
```

```
用户提问
  → route.ts 启动时扫描 packages/skills/ 目录，构建 SKILL_LIST
  → SKILL_LIST 注入 system prompt（<available_skills> 段，读 SKILL.md 的 frontmatter）
  → AI 根据用户需求判断是否需要加载 skill
  → AI 调用 loadSkill({ name }) 获取完整 SKILL.md 内容
  → AI 按 SKILL 指引执行
```

目录：`packages/skills/` 下 image-styles（73 种图片风格）/ blog / github-gem-seeker / xiaohongshu-note / task，每个含 `SKILL.md`。

## 工作流系统

### 设计理念

模板驱动的工作流引擎：`template.json` 声明参数表单 + 步骤序列，引擎按步执行。与 AI Chat 解耦——独立 CLI 子进程 + stdout 纯 JSON 契约通信，前端只负责收集参数、驱动步骤、展示进度。

### 执行链路

```
/workflow（主页：类型卡片）
  → /workflow/type/[templateId]（类型页：该类型执行记录 + 直接创建 + comic 专属资产库）
  → POST /api/workflows/execute
  → catch-all 委托 @app/workflows/http → dispatcher 匹配 actions.json
  → spawn node cli.js start '{"template":..,"params":..}'
  → 返回 executionId
  → 逐步 spawn cli.js next（单步执行，每步返回 preview）
  → 执行状态持久化到 data/workflows/tasks/<executionId>/
  → 日志写到 logs/workflows/
```

### CLI 子命令

`start`（创建执行）/ `run`（一次跑完）/ `next`（单步）/ `get` / `list` / `delete` / `templates`（模板列表）/ `retry`（组合：重置+执行；`force=true` 表示主动重新生成，普通补跑继续复用已生成产物）/ `skip` / `auto`（detached 后台跑完）/ `tweak-auto`（微调全流程编排）/ `switch-version`（按模板分发）。

### 引擎与模板边界

- `engine.js`：纯模板无关的步骤编排（创建/逐步/重试/跳过/终态），**无 video 概念**
- 脚本版本 / 微调等 video 概念在 `templates/video-generation/lib/`：tweak.js / switch-version.js / script-version.js
- **模板不 import engine.js**；cli 是子进程组合层，按 `state.template` 动态分发模板能力模块（如 `templates/<t>/lib/tweak.js`）
- `lib/state.js` / `lib/skip-when.js` 是 engine 与模板共用的基础设施

### 步骤类型

| 类型 | 说明 |
|---|---|
| `ai` | AI 生成（LLM 调用） |
| `script` | 跑脚本 |
| `tool` | 调用模板内 `lib/` 的纯函数 |

### 模板

- `templates/tech-video/`：科技风短视频（script.json 驱动 + 逐场景 TTS + BGM + SFX + 硬字幕 + SRT）
- `templates/video-generation/`：视频生成（含微调/版本切换/内容生成等模板级动作）
- `templates/comic-generation/`：漫画生成（故事→AI 分镜→每个 `sceneId` 生成无文字/无气泡锚点→逐页生成漫画图；`sceneId/scenePrompt` + 独立锚点锁连续场景且不继承成品页气泡；角色参考图锁人物一致性 + 风格库锁画风；微调支持 AI 编辑或上传/粘贴图片直接替换指定页）
- `templates/floorplan-remodel/`：户型改造（户型图→`parse` 视觉识别 structure.json（像素坐标、墙/房间 bbox/门窗/承重+置信度）+ sharp 墙像素 mask 吸附（端点 snap+外围 bbox+on-mask 校验[门窗断口豁免]，校验失败墙垂直滑搜重拟合 snap.js `slideRefit`，仍未过验标 unverified）+ 共线墙合并 `mergeCollinearWalls` + CV 门窗检测 `detectOpenings`（mask 断口+中灰双线=窗/纯白=门，取代 vision openings；整墙窗断口删墙）+ 入户门=外围已验证墙的门 `pickEntryDoor` + 墙厚启发式定承重（`wallThickness`：贴外围或厚于中位数 1.35×，unverified 一律承重）+ 双采样共识→`generate` 按保守/均衡/激进/创意梯度出 N 套，承重硬校验+可拆白名单+build 端点吸附+newRooms 校验（面积/零长度/邻湿区/中心在户型内），按方案判定不回退（拆未验证墙=安全降级保留+图上注解，拆承重=丢弃），quality.json 记录全部原因→纯二维矢量渲染（newRooms 色块填充+标签、蓝线新墙、红=砸墙、改名徽章、门窗符号+洁具图元）；创建页 `type: "checkbox"` 多选 + `floorplan` 图片上传两通用控件 + 必填 `title` 标题输入框（execution 列表显示用户标题）；v4：识别后人工确认底图（入户门/门窗/房间/承重）→ generate 前 confirmed 硬门槛 → 真实尺寸硬校验；v5：确认预览 structure.svg 叠半透明原图+w/d/r ID 芯片（确认面板左 6 右 4 布局、左图 sticky 可点击放大、parse 质检提示横幅），确认后 confirm.js 重渲染 structure.svg 并作废 plans.json/plan-*.svg 强制重生成）

### 资产库（工作流级通用）

角色参考图 / 风格是**跨执行复用的持久资产**，独立于单次执行，存放于 `data/workflows/assets/`：

```
data/workflows/
  tasks/<executionId>/           # 执行记录（state.json + pages/ + comic 的 anchors/）
  assets/
    characters/<id>.png/.json    # 角色参考图（图片 + 名称/描述/时间）
    styles/<id>.json             # 风格（名称/描述/时间，纯文本）
```

- 资产 handler 在 `workflows/lib/assets.js`（custom 原语，被 webpack 打包，`process.cwd()` 定位）
- 角色参考图是「生成预览 → 人工判断 → 填名保存」两步式；风格手动创建
- 图片文件经 `GET /assets/characters/*`（stream 原语，`dir` 字段自定义指向 assets/characters）
- comic 模板用 `characterRef` / `styleId` 参数引用资产；`generate-pages` 读资产文件 + base64 作 `subject_reference`

## 定时任务系统

### 设计理念

定时任务与 AI Chat 解耦：scheduler 是独立常驻进程，任务代码是纯 Node.js 脚本，不依赖 Next.js。

### 架构

```
用户操作                        AI Chat 进程
  │                                │
  ├─ /schedule 页面               │
  │   ├─ 查看任务列表（GET /api/tasks）     │
  │   ├─ 立即执行（POST /api/tasks）       │
  │   └─ 仪表盘（GET /api/tasks/[name]/dashboard）│
  │                                │
  └─ 手动重启                       │
       │                           │
       ▼                           │
  scheduler 进程（常驻）            │
  ├─ 扫描 packages/tasks/tasks/*/task.json │
  ├─ node-cron 注册每个 cron 表达式        │
  └─ 触发时 → import task → run() → 写日志 │
                                    │
  logs/tasks/tasks-YYYY-MM-DD.log   │
  data/tasks/<name>/index.json      │
  data/tasks/<name>/.lock           │
```

### 目录结构

```
packages/tasks/
├── package.json                   # @app/tasks workspace 包
├── scheduler.js                   # 常驻调度进程（日志复用 @app/shared/logger.js）
├── run-task.js                    # 手动触发入口（npm run tasks:run，复用同一日志）
├── actions.json                   # HTTP 动作声明（list/run/edit/dashboard）
├── http.js                        # 能力 HTTP 入口（ai-chat catch-all 委托）
├── lib/handlers.js                # 动作 handler（列表/执行/编辑/仪表盘）
└── tasks/                         # 任务目录（每任务一个子目录）
    └── <task-name>/
        ├── task.json              # { name, description, cron, enabled, html? }
        └── index.js               # export async function run()
```

### 任务约定

- 每个任务一个目录，`task.json` 自描述元信息
- `index.js` 必须 `export async function run()`，scheduler 负责 try/catch + 日志
- 仪表盘必须用原生 HTML/CSS/JS（允许 CDN），禁止 React/Vue/构建工具
- 任务执行互斥：同一任务不允许重叠执行（`.lock` 文件）
- 状态追踪：`data/tasks/<name>/index.json` 记录 lastRun/lastStatus/lastError
- 日志隔离：cron 与手动触发（`run-task.js`）写 `logs/tasks/tasks-YYYY-MM-DD.log`；HTTP「立即执行」写 `logs/tasks/<name>.log`

### 日志结构

```
logs/
├── app/                           # 应用日志（ai-chat + MCP）
│   └── app-YYYY-MM-DD.log
├── workflows/                     # 工作流日志（按日，含执行 id 前缀）
│   └── workflows-YYYY-MM-DD.log
├── services/                      # 搜索子服务日志（search-service + searxng）
│   └── services-YYYY-MM-DD.log
└── tasks/                         # 任务日志
    ├── tasks-YYYY-MM-DD.log       # cron + 手动触发（按日）
    └── <task-name>.log            # HTTP「立即执行」（每任务一个）
```

## MCP 系统

统一 MCP 服务器（`packages/mcp/`，stdio 协议），由 ai-chat 的 `lib/mcp-client.ts` spawn `node ../mcp/index.js` 拉起，进程内 `shared/llm` 每次调用 fresh-read 配置（改配置无需重建客户端）。

```
packages/mcp/
├── index.js                 # 统一入口（注册全部工具模块）
├── lib/
│   ├── env.js               # 环境变量
│   ├── chroma.js            # Chroma 客户端（network.json + providers.json 配置）
│   └── task-state.js        # 异步任务状态（图片/图表等长任务）
└── tools/
    ├── skill/               # 1 tool：loadSkill（扫描 packages/skills）
    ├── exec/                # 1 tool：Shell 命令执行（项目根 + skills/ 目录）
    ├── search/              # 5 tools：searchWeb / scrapeWebPage / mapWebsite / crawlWebsite / parseDocument
    ├── file/                # 10 tools：文件读写（相对路径基于项目根）
    ├── chroma/              # 5 tools：知识库增删查
    ├── media/               # 5 tools：generateImage / generateImageFromImage / checkImageProgress / generateMusic / checkMusicProgress
    ├── diagram/             # 2 tools：generateDiagram / checkDiagramProgress（Mermaid/D2）
    ├── xiaohongshu/         # 4 tools：小红书笔记生成/修稿/导出/进度；finance 两阶段策划→正文，note-utils 负责候选评分/状态摘要/导出转换
    ├── document/            # 2 tools：convertDocument / convertDocumentBatch（Pandoc→PDF/Word）
    └── todo/                # 6 tools（暂未注册）
```

共 35 个已注册工具。skill / exec 与 `packages/skills/` 联动：AI 在 system prompt 看到 `<available_skills>` 列表，按需 `loadSkill` 加载，用 `exec` 运行 skill 内脚本。

## 搜索服务系统

`packages/services/search/` 是独立常驻 Node 服务（非 npm workspace 包），提供联网搜索与网页抓取能力，MCP 的 search 模块薄适配调用。

```
packages/services/search/
├── service.json          # 服务监控清单（search-service + searxng）
├── server.js             # Node HTTP 服务（/search /scrape /map /crawl /parse /health /ready）
├── lib/
│   ├── searxng.js        # 调本地 SearXNG JSON API（类别→引擎映射）
│   ├── firecrawl.js      # 调 Firecrawl Cloud（scrape/map/crawl/parse，crawl 内部轮询）
│   └── search.js         # 编排：去重、限额（≤10 结果、≤3 正文、≤20 页）、引擎状态
├── searxng/              # 本地 SearXNG Python 子服务（start.sh: clone→venv→install→run）
│   ├── settings.yml      # 启用 baidu/sogou/bing 系列引擎 + json 输出；无用默认引擎 inactive 掉
│   ├── limiter.toml      # 空 limiter 配置（消除 missing config 警告，用内置 schema 默认值）
│   └── start.sh          # host/port 从 config/network.json 读取（SEARXNG_PORT/BIND_ADDRESS 覆盖）
└── test/                 # normalize 单元测试 + live 真实集成测试
```

### searchWeb 类别映射

| category | 引擎 | 抓正文 |
|---|---|---|
| general | baidu / sogou / bing | ✅ 前 3 条 |
| images | baidu images / sogou images / bing images | ❌ |
| videos | sogou videos / bing videos | ❌ |
| news | bing news | ✅ 前 3 条 |
| wechat | sogou wechat | ❌ |

### Firecrawl 工具

- `scrapeWebPage`：POST /v2/scrape → Markdown
- `mapWebsite`：POST /v2/map → 站点 URL 列表
- `crawlWebsite`：POST /v2/crawl + GET status（内部轮询，≤20 页）
- `parseDocument`：POST /v2/scrape + parsers:["pdf"]（仅 PDF）

- 端口：`config/network.json` 的 `hosts.local`(127.0.0.1) + `ports.searxng`(8080) / `ports.searchService`(8090)
- Firecrawl key：根 `.env` 的 `FIRECRAWL_API_KEY`
- 搜索失败语义：类别内引擎全失败才报错；部分失败返回 `degraded=true` + 引擎状态
- 正文抓取失败不丢弃搜索结果（`contentFetched=false` + `contentError`）

## 服务监控系统

设置页独立服务监控：以 `packages/services/*/service.json` 为唯一真相源，`ai-chat` 的 `lib/services/manager.ts` 扫描清单、执行启停命令、探测 HTTP 健康检查，设置页轮询展示并下发启动/重启/关闭。

```
packages/services/*/service.json      # 清单（services 数组，一目录可多进程）
  ├── id / name / description / cwd
  ├── start / stop                    # 命令数组，直接 spawn（不走 shell）
  └── health: { type: "http", url }   # 健康检查 URL

ai-chat/src/lib/services/manager.ts   # 清单扫描 + 启停 + 健康检查（状态机）
ai-chat/src/app/api/services/route.ts             # GET /api/services
ai-chat/src/app/api/services/[id]/[action]/route.ts  # POST start/restart/stop
ai-chat/src/app/settings/page.tsx     # 服务监控面板（5s 轮询）
```

- **状态模型**：`running`（健康检查通过）/ `starting`（启动中，60s 超时回退 `stopped`）/ `stopped` / `unknown`（无健康检查）。不做 PID/进程树探测。
- **重启语义**：重启 = 停止 + 启动组合（清单只声明 `start`/`stop`）；停止对 pkill 无匹配进程（exit 1）容忍。
- **进程生命周期**：启动 detached + `spawn` 事件 resolve（避免吞掉 ENOENT）；停止同步等待 exit code。
- **安全边界**：`action` 白名单（start/restart/stop），`id` 仅用于查找仓库内清单，命令参数来自 `service.json` 而非请求输入。
- **日志**：动作触发/完成/失败/清单解析失败经 `console.log/error` 写 `logs/app/app-YYYY-MM-DD.log`（instrumentation 的 `createLogger` 包装）。健康检查与 5s 轮询不打日志。
