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
     ├─ stdio spawn ──▶ mcp（36 tools，自包含）
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
│   ├── prod.sh / dev.sh / stop.sh / log.sh   # prod.sh：体检→门禁→stop→start→暴露自适应→自检（见「生产部署」）
│   ├── deploy.sh             # Mac 侧发版编排（npm run deploy）：永远 master，pull origin 90s 超时→bundle 兜底→prod.sh→状态轮询→公网冒烟五连；`deploy:smoke` 前置短路=仅冒烟
│   ├── deploy-common.sh      # deploy/sync/prod 共享解析：DEPLOY_TARGET/DEPLOY_PATH（env>.env）+ public_url 单源
│   ├── sync.sh               # 部署同步：env / site(server→Mac 镜像) / site-push / migrate-data / backup(30min) / conv-pull(server→Mac 对话) / install-cron / uninstall-cron / harden
│   ├── log-wrap.js             # 子服务日志包装（spawn 子进程 → stdout/stderr 逐行写按日日志）
│   ├── proxy.cjs               # 反向代理（serve site/ + 转发 /ai；默认回环、PROXY_BIND 可放开；静态服务带路径穿越防护）
│   └── fix-transformers-mjs.mjs / compress-images.cjs
├── data/                       # 运行时数据（chroma / tasks / settings / static / workflows / xhs-tasks / exports）
├── logs/                       # 日志（app/ + tasks/ + services/ + workflows/）
├── site/                       # 博客静态文件
└── packages/
    ├── shared/                 # 跨包共享模块（@app/shared workspace 包，裸导入）
    │   ├── package.json        # name: @app/shared（private, type: module）
    │   ├── capability.js       # 通用能力 dispatcher（actions.json 4 原语）
    │   ├── image-preview.js    # 图片预览压缩：sharp 长边1600+JPEG q85、伴生 .preview.jpg 缓存（预览用，导出用原图）
    │   ├── auth.js             # 登录鉴权：密码校验（data/auth.json 优先，.env 兜底）/ HMAC token 签发校验（含密码指纹）/ 防爆破计数
    │   ├── egress.js           # 内网出口层：白名单域名走反向隧道（SOCKS），其余直连；installEgress 补丁 globalThis.fetch
    │   ├── logger.js           # 统一日志
    │   ├── network.js          # loadNetworkConfig 共享读取器
    │   ├── utils.js            # sleep / shortId / downloadsDir / withTimeout（网络调用硬超时兜底）
    │   ├── test/               # 共享测试（auth / capability / llm-dispatch / tts-timeout / engine-status / ai-chat-multimodal / comic-workflow / conversations-store / image-preview）
    │   └── llm/                # LLM 共享封装
    │       ├── index.js        # callLLM / generateTTS / generateBGM / generateMusic / generateImage / provider 读取
    │       ├── config.js       # providers.json / selection.json fresh-read（真源，env 兜底）
    │       ├── balance.js      # 模型概况余额/可用性查询（差异抹平：deepseek 余额 / 火山 GetAFPUsage / minimax·glm·qwen 探测）
    │       ├── parse-json.js   # 容错 JSON 解析
    │       └── providers/      # deepseek.js / glm.js / minimax.js / qwen.js / volcengine.js(Seedream 图片)
    ├── ai-chat/                # 业务服务（Next.js，组合根）
    │   ├── src/
    │   │   ├── instrumentation.ts      # 启动时 initSettings + spawn chroma
    │   │   ├── proxy.ts                # 全局鉴权卡口（Next 16 proxy，见「登录鉴权」）
    │   │   ├── lib/
    │   │   │   ├── core/        # LLM 基础设施：embedding / workflow-model / fetch-interceptors
    │   │   │   ├── strategies/  # chat 路由：chat-strategy + 4 provider strategy（deepseek/glm/minimax/qwen，classifyTask 在 deepseek.ts）
    │   │   │   ├── multimodal/  # 附件处理：attachment / image / video(仅 stripVideos) / pipeline / preprocess(vision 逐图描述→内联替换消息占位符) / modality-detector / multimodal-config / mime
    │   │   │   ├── rag/         # retrieve.ts / vector-store.ts / chroma-server.ts
    │   │   │   ├── settings/    # store / init / dispatcher / types
    │   │   │   ├── services/    # manager.ts：packages/services/* 清单扫描 + 启停/健康检查（服务监控）
    │   │   │   ├── mcp-client.ts
    │   │   │   ├── modes.ts           # chat/plan/build 模式：MODE_INFO（状态+行为指令）+ WRITE_TOOLS/filterToolsByMode（工具权限）+ buildToolsSection（按模式拼工具清单）
    │   │   │   └── utils/       # utils(cn+BASE) / types / cost / env
    │   │   └── app/
    │   │       ├── (main)/      # page（对话）/ memory / schedule / workflow（三层：主页类型卡片 → type/[templateId] 类型列表 → execution/[id] 详情）/ logs（日志页）
    │   │       ├── login/       # 登录页（(main) 组外，Neo-Brutalism 居中卡片）
    │   │       ├── api/         # chat / memory / settings / services / conversations / logs / note / exports / auth(login·logout·change-password) ... + workflows、tasks 仅 catch-all 挂载点
    │   │       ├── note/[taskId]/page.tsx
    │   │       ├── logs/page.tsx        # 日志页：分组（app/tasks/services/workflows/backup）+ 文件选择 + tail 自动刷新 + 下载
    │   │       ├── preview/[taskId]/route.ts
    │   │       ├── settings/page.tsx
    │   │       └── layout.tsx / globals.css
    │   ├── scripts/             # generate-embeddings / verify-migration
    │   └── package.json
    ├── mcp/                     # MCP 工具服务（36 tools，详见「MCP 系统」）
    ├── skills/                  # 技能模块（image-styles / blog / github-gem-seeker / xiaohongshu-note / task）
    ├── services/                # 独立常驻服务（非 npm workspace 内聚目录）
    │   ├── search/              # 联网搜索服务（本地 SearXNG + Firecrawl Cloud 正文抓取）
    │   └── corp-egress/         # 内网出口隧道（Mac 侧常驻：本机 SOCKS5 + ssh -R 反投给服务器，见「内网出口」）
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
            ├── floorplan-remodel/# 户型改造（2 步：parse/generate；CV 像素几何+vision 语义→人工确认底图→符号锚点方案→四视图交付：原始建筑图/平面布置图/效果图/俯视平面图）
                ├── actions.json # 模板级动作（floorplan-upload / confirm-structure）
                ├── rules.json   # 户型规则（尺寸下限+设计准则）
                └── lib/         # parse（视觉+sharp 墙像素 mask 吸附+quality.json）/ generate（承重硬校验+可拆白名单+按方案判定不回退+四视图编排）/ metrics（px→mm/面积/房间类型）/ confirm（confirm-structure：写回结构+confirmed 盖章）/ render（纯二维矢量+门窗符号+洁具图元）/ render-arch（原始建筑图尺寸标注+平面布置图家具俯视图元库）/ generate-render（效果图人视点+俯视鸟瞰图生图+STYLE_PROMPTS）/ snap（墙像素 mask/吸附/外围 bbox）/ anchors（符号锚点+resolveFurniture 家具解析）
            └── person-research/# 人物公开信息研究（姓名+线索→搜索去重抓取→LLM 聚类候选→awaitInput 停靠人工选定→多轮定向研究+商业版图→证据归并→版本化报告）
                ├── actions.json # 模板级动作（research-select / research-continue / research-report）
                ├── PLAN.md      # 设计文档（V1~V4 路线）+ IMPLEMENTATION.md（实现计划）
                └── lib/         # discovery（高精度首搜+受控扩搜）/ research（商业轮+二跳+纠错+漏斗）/ relevance（V1.1 相关性评分+边界复核管线）/ report / prompts（LLM 契约+校验）/ evidence（归并+商业关联+纠错应用）/ queries（固定商业/扩搜查询集）/ normalize / search-client（strategy 透传）/ privacy / store / handlers
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
| `stream` | 文件流 + Range 206 + 穿越守卫 + MIME；`?preview=1` 图片走 `image-preview` 压缩小图（漫画页/角色图/anchors） | file/*、assets/characters/* |
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

`start`（创建执行）/ `run`（一次跑完）/ `next`（单步）/ `get` / `list` / `delete` / `templates`（模板列表）/ `retry`（组合：重置+执行；`force=true` 表示主动重新生成——经 `{retryForce}` 变量下发步骤 bypass 产物缓存，普通补跑继续复用已生成产物）/ `skip` / `auto`（detached 后台跑完）/ `tweak-auto`（微调全流程编排）/ `switch-version`（按模板分发）。

### 引擎与模板边界

- `engine.js`：纯模板无关的步骤编排（创建/逐步/重试/跳过/终态），**无 video 概念**
- 脚本版本 / 微调等 video 概念在 `templates/video-generation/lib/`：tweak.js / switch-version.js / script-version.js
- **模板不 import engine.js**；cli 是子进程组合层，按 `state.template` 动态分发模板能力模块（如 `templates/<t>/lib/tweak.js`）
- 引擎支持步骤声明 `awaitInput: true`：完成且非末步时停靠 `status="awaiting_input"`，`next`/`auto` 拒绝越权推进，由模板动作重臂步骤后恢复（person-research 的 select/continue 在用）；模板列表扫描跳过无 `template.json` 的目录（纯文档目录不炸列表）
- `lib/state.js` / `lib/skip-when.js` 是 engine 与模板共用的基础设施

### 步骤类型

| 类型 | 说明 |
|---|---|
| `ai` | AI 生成（LLM 调用） |
| `script` | 跑脚本 |
| `tool` | 调用模板内 `lib/` 的纯函数 |

### 模板

> 每个 `template.json` 可选 `available`（boolean，缺省视为可用）：工作流列表页据此显示「可用 / 不可用」徽章，不可用卡片加虚线边 + 灰图标标识，但仍可点击。

- `templates/tech-video/`：科技风短视频（script.json 驱动 + 逐场景 TTS + BGM + SFX + 硬字幕 + SRT）
- `templates/video-generation/`：视频生成（含微调/版本切换/内容生成等模板级动作）
- `templates/comic-generation/`：漫画生成（故事→AI 分镜→每个 `sceneId` 生成无文字/无气泡锚点→逐页生成漫画图；`sceneId/scenePrompt` + 独立锚点锁连续场景且不继承成品页气泡；角色参考图锁人物一致性 + 风格库锁画风；分镜支持可选旁白 `narration`（灰底方框置顶）；每页生成后 `verifyPage` vision 质检气泡文字/尾巴指向、不通过带反馈重试一次；微调支持 AI 编辑或上传/粘贴图片直接替换指定页）
- `templates/floorplan-remodel/`：户型改造（v6：几何换源——`parse` 由 `extract-walls.js` CV 像素提取轴对齐墙段（黑墙 mask→厚度滤波游程→共线合并[门洞断口同墙]→交点吸附→薄线剔除；墨量越界/墙段<6 回退 vision 墙），vision 降为语义层（房间 bbox/名称、dims、wetRooms、adjacency）+ `detectOpenings` 门窗像素检测 + `pickEntryDoor` + 墙厚定承重；`generate` 输出符号锚点（`anchors.js`：{wall,t}/{room,edge,t} → 确定性解析像素，治 LLM 像素 hallucinate；newRooms 用 {room,rel} 相对框），承重硬校验+可拆白名单+面积/邻湿区校验不变；双渲染：SVG 叠原图 + `render-md.js` MD 派生视图（ASCII 户型画+表格，execution 页 mdFiles 链接，聊天 AI 可读上下文）；可选参数 `areaM2` 在图无尺寸标注时按外围 extent 兜底比例尺（`mmPerPxFromArea`）；创建页 checkbox 多选 + floorplan 上传 + title；v4：确认底图硬门槛；v5：确认预览叠原图+ID 芯片，确认后作废 plans 强制重生成（含 plan-*.md）；v6：确认面板彩色徽章+列表↔图交互高亮、方案图去胶囊/新墙轴对齐；v7：rules.json 五段知识库（patterns/constructionNotes/hardRules）+ newRooms 围合真源自动补墙 + 围合/孤儿化/硬下限校验 + 无 source 老识别黄条防呆；v8：四视图交付——`render-arch.js` 产出原始建筑图（`structure-arch.svg` 干净矢量+尺寸标注链）与平面布置图（`layout-original.svg`/`layout-pN.svg` 全屋家具俯视图元库），`generate-render.js` 产出效果图（`render-pN.png` 人视点）+俯视平面图（`birdview-pN.png` 鸟瞰，以布置图 SVG 栅格化 PNG 作 `image_url` 图生图参考）；`anchors.js` `resolveFurniture` 家具 rel→像素；`generate` LLM 扩 `furniture` 输出、原户型现状布置单独轻量 LLM；参数 `style`（11 种装修风格）注入渲染 prompt；渲染幂等复用+失败降级（写 error 字段不废方案）；execution 页 `FloorplanGallery` 原户型卡+每方案卡；v9：效果图多视角——`generate-render.js` 按房间类型选 3 视角（客餐厅/主卧/厨卫，缺则回退最大房/卫生间）产出 `render-pN-{living,master,wet}.png`，各视角独立 prompt（家具清单+风格+面积）；`classifyGap` 判窗阈值 1 点→≥3 点命中（治入户门细门扇线误判窗）+ 入户门下拉框列全部开口可翻转类型；v10：鸟瞰改确定性——`render-birdview.js` 纯代码渲染 `birdview-pN.svg`（地面色+墙厚+门窗+家具投影/高光，100% 贴合数据），替代 AI 鸟瞰图生图；效果图单图微调——`lib/tweak.js`（AI 图生图局部改/上传替换，复用 engine tweak-auto 编排，`tweak:true`）+ `FloorplanGallery` 微调入口）
- `templates/person-research/`：人物公开信息研究（V1，2026-10-28）：姓名+可选线索（手机号仅作公开页面匹配线索，normalizePhone 校验后存 `private.json` 与报告隔离，`redactPhone` 全量脱敏落盘）→ 多查询并发搜索 + URL 归一去重 + 域名分级（A 政府/B 媒体/C 平台/D 论坛）+ 同域名抓取限额 → LLM 聚类候选（同名消歧）+ 抽取主张（quote 逐字摘录软校验）→ `awaiting_input` 停靠，人工选定/排除/补充 → 多轮定向研究（意图 LLM 生成查询；证据归并：独立域名≥2 升 supported、冲突主张双向引用）→ 版本化 Markdown 报告（`[S#]` 引用校验剔除+重试、无主张走模板分支）。3 个 custom 动作（select/continue/report）经 http.js 注册；前端 execution 页 `PersonResearchPanel`（候选卡/证据/轮次/报告/继续输入框，创建后自动触发 discovery）。设计路线见模板目录 PLAN.md

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
├── app/                           # 应用日志（ai-chat + MCP + client-log，追加写/时间正序）
│   └── app-YYYY-MM-DD.log
├── workflows/                     # 工作流日志（按日，含执行 id 前缀）
│   └── workflows-YYYY-MM-DD.log
├── services/                      # 搜索子服务日志（search-service + searxng）
│   └── services-YYYY-MM-DD.log
└── tasks/                         # 任务日志
    ├── tasks-YYYY-MM-DD.log       # cron + 手动触发（按日）
    └── <task-name>.log            # HTTP「立即执行」（每任务一个）
```

> `logs/app/app-*.log` 由 ai-chat（NEXT logger）、MCP 子进程、`/api/client-log` 三方共享，统一**追加写（时间正序）**；读取方（`/api/logs`、`scripts/log.sh`）取尾部再反转展示。禁止「读整文件 → 前插 → 重写」（多进程会互相覆盖）。`createDateLogger`（workflows/tasks/services）仍是每 item 独立文件 + 倒序。

> **日志页**：侧栏「日志」→ `(main)/logs`。`/api/logs` 三种形态：`?list=1` 列分组文件、`?group&file&tail=N` 取尾部行（≤2000）、`?group&file&download=1` 附件流式下载；分组 app/tasks/services/workflows/backup，路径白名单防穿越。原 right-panel 的临时「运行日志」块已移除（集中到日志页）。

## MCP 系统

统一 MCP 服务器（`packages/mcp/`，stdio 协议），由 ai-chat 的 `lib/mcp-client.ts` spawn `node ../mcp/index.js` 拉起，进程内 `shared/llm` 每次调用 fresh-read 配置（改配置无需重建客户端）。客户端单例缓存 Promise，子进程死亡后由 `loadMcpTools` 调 `resetMCPClient()` 重连。

```
packages/mcp/
├── index.js                 # 统一入口（注册全部工具模块）
├── lib/
│   ├── env.js               # 环境变量
│   ├── logger-setup.js      # MCP 日志初始化（首个 import，提前拦截 console，禁止污染 stdout）
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
    ├── xiaohongshu/         # 4 tools：小红书笔记生成/修稿/导出/进度；finance 两阶段策划→正文，note-utils 负责候选评分/状态摘要/导出转换。任务状态存 data/xhs-tasks/<id>（跨重启），导出到 data/exports/<id>（浏览器经 /api/exports/<id> 打 zip 下载，7 天清理）
    ├── document/            # 2 tools：convertDocument / convertDocumentBatch（Pandoc→PDF/Word）
    ├── yapi/                # 1 tool：yapiApi（YApi 接口页 URL + 项目 token → 原始 JSON / TS 类型定义；schema-to-ts 纯转换器）
    └── todo/                # 6 tools（暂未注册）
```

共 36 个已注册工具。skill / exec 与 `packages/skills/` 联动：AI 在 system prompt 看到 `<available_skills>` 列表，按需 `loadSkill` 加载，用 `exec` 运行 skill 内脚本。

## 搜索服务系统

`packages/services/search/` 是独立常驻 Node 服务（非 npm workspace 包），提供联网搜索与网页抓取能力（Firecrawl Cloud 主搜/抓取 + 本地 SearXNG 兜底），MCP 的 search 模块薄适配调用。

```
packages/services/search/
├── service.json          # 服务监控清单（search-service + searxng）
├── server.js             # Node HTTP 服务（/search /scrape /map /crawl /parse /health /ready；SEARCH_SERVICE_PORT env 覆盖端口）
├── lib/
│   ├── searxng.js        # 调本地 SearXNG JSON API（类别→引擎映射）
│   ├── firecrawl.js      # 调 Firecrawl Cloud（search/scrape/map/crawl/parse，crawl 内部轮询）
│   └── search.js         # 编排：strategy 路由（auto/primary/expand）+ cleanResults 通用清洗（垃圾过滤/URL 去重并引擎/标题去重/sourceDomain）+ 限额；响应含 cleaning 统计
├── searxng/              # 本地 SearXNG Python 子服务（start.sh: clone→venv→install→run）
│   ├── settings.yml      # 启用 baidu/sogou/bing 系列引擎 + json 输出；无用默认引擎 inactive 掉
│   ├── limiter.toml      # 空 limiter 配置（消除 missing config 警告，用内置 schema 默认值）
│   └── start.sh          # host/port 从 config/network.json 读取（SEARXNG_PORT/BIND_ADDRESS 覆盖）
└── test/                 # normalize + cleanResults 单元测试 + live 真实集成测试
```

### searchWeb 类别映射

| category | 主搜 | 兜底(SearXNG) | 抓正文 |
|---|---|---|---|
| general | Firecrawl web | baidu / sogou / bing | ✅ 前 3 条 |
| images | Firecrawl images | baidu images / sogou images / bing images | ❌ |
| videos | — | sogou videos / bing videos | ❌ |
| news | Firecrawl news | bing news | ✅ 前 3 条 |
| wechat | — | sogou wechat | ❌ |

Firecrawl 主搜仅限 page=1（无分页），2 credits/次；timeRange→tbs(qdr:d/m/y)，language 忽略。背景：本机 SearXNG 抓取式引擎高频 CAPTCHA 且被挂起 1h、bing 恒 0 结果，故降为兜底。

### Firecrawl 工具

- `searchWeb`（主搜）：POST /v2/search → data.{web,news,images} 拍平
- `scrapeWebPage`：POST /v2/scrape → Markdown
- `mapWebsite`：POST /v2/map → 站点 URL 列表
- `crawlWebsite`：POST /v2/crawl + GET status（内部轮询，≤20 页）
- `parseDocument`：POST /v2/scrape + parsers:["pdf"]（仅 PDF）

- 端口：`config/network.json` 的 `hosts.local`(127.0.0.1) + `ports.searxng`(8080) / `ports.searchService`(8090)
- Firecrawl key：根 `.env` 的 `FIRECRAWL_API_KEY`
- 搜索失败语义：主搜+兜底均失败才报错（`search_failed: firecrawl(…) | searxng(…)`）；主搜失败已兜底或部分引擎失败返回 `degraded=true`；响应含 `provider`(firecrawl/searxng)
- 正文抓取失败不丢弃搜索结果（`contentFetched=false` + `contentError`）

## 聊天上下文（多轮）

`POST /api/chat` 把前端 `useChat` 的 `UIMessage[]` 经 `api/chat/to-model-messages.ts` 转成 AI SDK `ModelMessage[]`。**全量保留、不截断**：`text`/`file` + assistant 的 `reasoning`（provider 发为 `reasoning_content`）+ `tool-call`（发为 `tool_calls`）+ 紧随的 `role:'tool'` 消息（工具结果）。这是 MiniMax 多轮 Function Call 的硬要求（保持思维链连续），也是 deepseek 等多轮工具对话准确的前提；缺了就会出现「追问瞎猜」。未完成态（input-streaming/available）工具跳过以免悬空 tool-call。上下文过长用「压缩」功能（`/api/chat/compress`）治理，**不在转换层截断**。自写转换器（非 `convertToModelMessages`）以保留 `file.data`。

## 内网出口（corp egress）

公网云服务器无法访问公司内网（如 `yapi.cai-inc.com`）。Mac 在内网侧，跑一个常驻隧道服务把**本机 SOCKS5 出口**经反向 SSH 暴露到服务器；服务器侧的出口层按**域名白名单**决定请求走隧道还是直连——单点判断，MCP / 各处 `fetch` 自动受益。

```
Mac（公司内网）                              云服务器
corp-egress 服务                             @app/shared/egress.js
  ├─ 本机 SOCKS5 :11080  ◀──── ssh -R ────▶  127.0.0.1:11080（隧道入口）
  └─ ssh -N -R 127.0.0.1:11080:127.0.0.1:11080 root@server
                                             installEgress() 补丁 globalThis.fetch
                                               └─ host ∈ 白名单 → SOCKS；否则直连
```

- 隧道服务 `packages/services/corp-egress/`（`runner.js` + `socks-server.js`）：本机起**真正从本机出网**的 SOCKS5（`ssh -D` 出口在服务器侧、方向相反，故自实现最小 SOCKS5），再 `ssh -R` 反投；keepalive 重连 + `/health`。由本地 ai-chat 服务监控启停（`service.json` 标 `optional`，见「服务监控系统」）。启动前做**内网可达探针**（TCP `yapi.cai-inc.com:443`，3s，`CORP_PROBE_HOST` 可覆盖）：不通=本机不在内网 → 拒绝启动（挡掉在云服务器上误启动抢端口）。`process.title=corp-egress-runner`，stop 用 `pkill -f corp-egress-runner` 精确匹配（否则 `node runner.js` 的老进程杀不掉、端口僵尸）。
- 出口层 `@app/shared/egress.js`：`readEgressConfig()` fresh 读 `data/settings/egress.json`；`isCorpHost()`（精确 / `.后缀` / CIDR）；`egressFetch()` / `installEgress()`。corp 路径统一用 npm `undici`（与 Agent 同版本，避免与 Node 内建 fetch 的 undici 跨版本冲突）+ `socks` 自定义 `Agent.connect` → SOCKS → TLS。
- 挂载：ai-chat `instrumentation.ts` + MCP `index.js` 启动时 `installEgress()`。
- 配置/UI：设置页「网络出口」tab（开关 + 白名单增删改 + proxy + 连通性测试）；API `/api/settings/egress`(+`/test`)。
- 端口：`config/network.json` 的 `corpSocks`(11080) / `corpHealth`(11081)。
- **边界**：仅当 Mac 开机 + 公司网 + 隧道服务在线时生效（云服务器进内网只能借内网机器）；`workflows`/`tasks` 是独立子进程，不继承补丁（将来需内网时各自 `installEgress()`）。

## 登录鉴权

公网部署（云服务器直连；已移除本机自动 tailscale funnel）下的单密码鉴权，全部收口在 ai-chat 的 `src/proxy.ts`（Next 16 proxy，middleware 继任者，Node runtime）：

```
浏览器 → 公网IP:4321 → proxy.cjs(0.0.0.0:4321) → next-server(:4567, 仅回环)
（其余服务 chroma/searxng/search 恒回环）
                                                      └── proxy.ts 鉴权卡口（页面+API 全量）
```

- **模型**：单人应用，无用户名；生效密码 = `data/auth.json` 的 passwordHash（settings 页改密写入，gitignored）优先，根 `.env` `AUTH_PASSWORD` 兜底。
- **token**：`过期时间.密码指纹8位.HMAC-SHA256(AUTH_SECRET)`，Cookie `ai_session`（httpOnly / SameSite=Lax / prod Secure / 30 天）。指纹掺入 → 改密后所有旧会话立即失效。
- **卡口规则**（proxy.ts）：放行 `/login`、`/api/auth/*`（自带密码验证）、字体豁免路径（MCP document 工具经 Chrome 取 `/api/uploads/NotoSansCJKsc-Regular.otf`，字体加载带不了 Cookie，开源字体无泄漏风险）、`_next/*` 静态资源；未登录页面 307→login、API 401。
- **fail-closed**：`AUTH_PASSWORD` 未配置时生产全拒（login 接口报 `auth_not_configured`）、dev 放行。
- **防爆破**：login 与 change-password 共用内存计数，同 IP 连错 `AUTH_MAX_FAILS`(5) 次锁 `AUTH_LOCK_SECS`(600) 秒；重启进程清零。
- **matcher 坑**：basePath 根路径 `/ai`（裸路径，无尾斜杠）只有 isRoot matcher `'/'` 能覆盖，普通 `'/((?!_next...).*)'` 前缀化后要求子路径，`/ai` 会被静态缓存直出绕过鉴权（Next 16 实测）。故 matcher = `['/', '/((?!_next/static|_next/image|favicon.ico).*)']`。
- **绑定收紧**：next-server 与内部服务恒绑 127.0.0.1；proxy.cjs 生产经 `PROXY_BIND=0.0.0.0` 放开单口对外（deploy/prod 自动带），dev 默认回环（未配密码时鉴权放行，不暴露局域网）。
- **Cookie Secure 自动探测**：`x-forwarded-proto || nextUrl.protocol === https`——裸 IP HTTP 部署自动降级（否则浏览器拒发 Cookie），反向代理 TLS 下自动恢复 Secure。
- **安全响应头**（next.config.ts headers()）：nosniff / X-Frame-Options DENY / Referrer-Policy / HSTS；CSP 跳过（与 Next 内联脚本冲突）。

涉及文件：`packages/shared/auth.js`（+ test/auth.test.js）、`ai-chat src/proxy.ts`、`api/auth/{login,logout,change-password}/route.ts`、`app/login/page.tsx`、settings 页「密码管理」区块、`scripts/proxy.cjs`、`scripts/{prod,dev}.sh`、根 `.env`（AUTH_*）。

## 服务监控系统

设置页独立服务监控：以 `packages/services/*/service.json` 为唯一真相源，`ai-chat` 的 `lib/services/manager.ts` 扫描清单、执行启停命令、探测 HTTP 健康检查，设置页轮询展示并下发启动/重启/关闭。

```
packages/services/*/service.json      # 清单（services 数组，一目录可多进程）
  ├── id / name / description / cwd
  ├── start / stop                    # 命令数组，直接 spawn（不走 shell）
  ├── health: { type: "http", url }   # 健康检查 URL
  └── optional?                        # 可选服务（如仅特定主机有意义的 corp-egress）：未运行不算异常，UI 标「可选」badge

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
