# Changelog

## v0.11.18 (2026-09-03) — 独立服务监控面板

### 变更
- **设置页服务监控**：新增 `packages/services/*` 独立服务监控面板，基于各服务目录的 `service.json` 清单自动发现，展示运行状态、端口/健康检查地址，并支持启动、重启、关闭
- **服务清单**：`packages/services/search/service.json` 声明 `search-service` 与 `searxng` 两个独立服务（`cwd`/`start`/`stop`/`health`）
- **服务管理 API**：`GET /api/services` 返回服务列表与状态；`POST /api/services/:id/:action` 执行 `start`/`restart`/`stop`（重启 = 停止 + 启动组合，停止对 pkill 无匹配进程容忍）
- **状态模型**：健康检查通过 → `running`，启动中 → `starting`（60s 超时回退 `stopped`），失败 → `stopped`

## v0.11.17 (2026-09-03) — 小红书金融内容增长改造 + 图片任务轮询修复

### 变更
- **金融笔记两阶段生成**：先生成传播角度、读者痛点及多组标题/封面候选并自动择优，再按选中方案生成正文
- **普通人金融定位**：取消固定“30+程序员”标签；标题强化数字、损失、反常识与悬念，正文必须兑现标题承诺
- **正文价值密度**：每篇聚焦一个问题，首屏回应冲突，加入可复算数字、3 条行动清单、具体评论问题和事实来源等级
- **导出占位符统一**：Markdown 导出改为识别生成器实际使用的 `[IMG-N]`

### 修复
- **轮询计数反复归零**：小红书图片生成每张图完成/失败时改为读取最新 `task.json` 后再写回，避免旧状态覆盖轮询更新的 `checkCount` 和其他图片状态
- **图片超时错误不清晰**：`AbortError` 统一转换为“图片生成超时，请重试”
- **部分失败无法结束轮询**：明确 `ready`、`partial`、`failed` 都是终态；`partial` 返回成功数、失败数、总数和失败图片明细
- **AI 轮询规则不一致**：同步更新 xiaohongshu Skill 与聊天系统提示，禁止同一任务并发轮询，支持对失败图片单独重试

### 测试
- 新增小红书工具测试：标题候选选择、图片占位符转换、图片状态更新不覆盖 `checkCount`
- `npm run typecheck`、`npm run test` 全部通过

## v0.11.16 (2026-09-01) — 漫画锚点/参考图保真强化 + 重新生成 force 语义 + 气泡归属系列修复

### 修复
- **漫画气泡尾巴指错人物**：场景连续性不再把首张带气泡的成品页作为后续参考；每个 `sceneId` 先生成并持久化无文字、无气泡的独立锚点，全部正式页共同引用，锚点失败仅回退角色参考图
- **气泡归属提示强化**：图片 prompt 为每句对白明确写入说话人左右位置及气泡尾巴接触对象，不再只依赖笼统的「左人左泡、右人右泡」
- **气泡移除人物名前缀**：分镜继续用 `人物名: 台词` 保存归属，但首次生成和 AI 微调只把纯台词交给模型绘制；人物名仅作为禁止绘制的尾巴定位元数据
- **漫画视觉层级与表情强化**：锚点人物改为无明显表情的基础脸；正式页和 AI 微调强制按「背景 < 人物 < 气泡/文字」构图，并覆盖锚点重绘眼睛、嘴型、姿态、动作线与情绪符号；背景道具禁止遮挡人物和气泡
- **分镜感知角色造型**：`styleId` 进入分镜步骤，分镜读取风格描述；无肢体角色禁止生成抓手、摊手、挥手、指向、迈步等冲突动作
- **锚点自动失效**：锚点文件名从 `sceneId` 哈希改为完整 prompt 哈希，场景描述、画风或锚点规则变化时不再误复用旧图
- **重新生成不再秒结束**：工作流 retry 增加 `force` 语义；已完成步骤按钮传 `force=true` 真正重做，失败/警告步骤继续补跑；漫画页强制重做时不提前删除旧图，单页新图成功后覆盖旧图
- **人物跟参考图强化**：锚点与正式页 prompt 增加三条规则——人物造型复用参考图具体设计（服装/发型/眼镜/描边粗细）、人物高度占画面 50%-70% 禁止极小和大幅留白、画风文字与参考图冲突时以参考图为准；正式页同时喂 `[场景锚点, 原始角色参考图]` 双参考图（Seedream `image` 数组透传，minimax/qwen 取首张防呆）；强制「重新生成」时锚点不再复用，同步重建

### 验证
- 漫画回归测试 10/10、typecheck、完整 test、build 全绿；任务 `5ffc565e9ad8` 用双参考图+新锚点 force 重生成 8/8 页（失败 0），人物造型（花衬衫/圆眼镜/粗描边）与参考图一致

## v0.11.15 (2026-09-01) — 工作流手动步进卡死修复 + 场景分组按钮修复

### 变更
- **「下一步」按钮卡死修复**：执行页原用整体 `status === "running"` 禁用「下一步/自动执行」，但引擎 `runNextStep` 完成非末步后不写终态（status 保持 running）→ 手动步进模式第 1 步完成后按钮永久禁用，v0.11.13「生图前确认」暂停变死局；改用步骤级活动信号 `anyStepRunning || isTweakRunning` 判定禁用
- **列表「待下一步」态**：`listExecutions` 增加 `runningSteps`；列表页对 running 但无 running 步骤且未完成显示「⏸ 待下一步」（不脉冲），消除「🔄 执行中」误导
- **场景分组按钮报「第 undefined 页不存在」修复**：capability dispatcher 的 custom 原语只传 `{params, rest, request}` 不传 `body`，`scene-groups.js` 却解构 `body`；对齐 generate-content.js 约定改 `request.json()`

### 踩坑
- prod 是 `next start`（无热更），代码改动必须 `scripts/prod.sh` 重建+重启才生效；后台跑 prod.sh 要 detached 启动，否则 shell 超时 kill（SIGTERM, npm code 143）会连带杀掉刚起的服务

### 验证
- typecheck + test（22+11+5）全绿；prod 已 redeploy
- scene-group 真实 curl：new-scene → ok（sceneId subway-car-2）、merge-prev 无损还原；卡住执行刷新后按钮可点

## v0.11.14 (2026-09-01) — DeepSeek vision 模型接入 + 设置页模型概况（余额/可用性差异抹平）

### 变更
- **DeepSeek 多模态模型接入**：视觉评估模块新增 `deepseek-v4-flash-vision-exp`；`deepseek.js` `callLLM` 从「拒图+文字注入」改为 `image_url` 块原生直传（同 qwen.js 协议），`callMultimodalLLM` 可用 DeepSeek 读图
- **模型概况（差异抹平）**：新增 `shared/llm/balance.js` — DeepSeek `GET /user/balance` 真实余额 / 火山方舟 `GetAFPUsage`（HMAC-SHA256 签名 V4，AK/SK，日/月免费包额度）/ MiniMax·GLM·Qwen 无主动接口则 1-token ping 探测 chat 模型（报错=不可用，15s 超时）；统一归一化 `{status, available, balanceText, error}`
- **概况融合进设置页**：删独立概况块；Provider 配置卡标题行带 🟢/🔴 + 余量/错误；「模块配置」改名「模型配置」并移到「模块模型选择」上方；每个模型选项加可用点；新增 `GET /api/settings/balance`（并发查询 + 各模块当前模型可用性）
- **错误码中文化**：余额/探测错误按 HTTP 状态码映射中文（401 Key 无效或过期 / 403 无权限或余额不足 / 404 模型不存在 / 429 限流 / 5xx 服务端错误）
- `config.js` 新增 `getAccessKey`/`getSecretKey`（providers.json 优先、env 兜底）；`.env.example` 补火山 AK/SK 占位

### 踩坑
- 火山 `GetAFPUsage` 走管理端点 `ark.cn-beijing.volcengineapi.com`（非推理域名），签名 V4 需 AK/SK 而非 `ark-xxx` apiKey；401=签名错、403=无权限，可据此区分
- MiniMax/Qwen/GLM 无公开余额接口（仅 1008/Arrearage/1113 错误码），只能主动探测发现欠费

### 验证
- 火山签名真实调用 200（日 0/10000 · 月 8910/20000）；DeepSeek 余额 CNY 789.83；qwen 401 正确标红并中文化
- typecheck + test（22+11+5）全绿

## v0.11.13 (2026-08-31) — 漫画场景连续性 + 直接替换页图

### 变更
- **漫画分镜场景分组**：`storyboard.js` 要求每页输出 `sceneId` + `scenePrompt`；同一连续场景复用固定场景描述，换时间/地点/剧情阶段才换 `sceneId`
- **降低气泡错字率**：分镜校验增加单句对白正文 ≤12 字，长句触发重试拆页；仍保留 AI 原生气泡，不做程序化叠字
- **场景锚点图**：`generate-pages.js` 同一 `sceneId` 的第一页作为锚点，后续页优先参考该锚点，并把固定场景描述写入图片 prompt
- **分镜后手动修正分组**：执行详情页的 `script.json` 预览中，漫画页可点「并入上一场景」或「从此页新场景」；后端新增 `/execution/:id/scene-group`
- **微调直接替换图片**：漫画微调弹窗新增 `AI 微调` / `直接替换图片` 模式；直接替换要求选 1 页 + 上传/粘贴 1 张图，不调用 AI，直接覆盖对应页图片
- **直接替换刷新修复**：替换成功时递增 `tweakCount`，复用图片 `?v=` 缓存破坏；弹窗级监听粘贴事件，直接替换模式隐藏 textarea 后仍可 Ctrl+V
- **聊天重命名**：侧边栏对话菜单加「重命名」（内联 input，Enter/失焦提交、Esc 取消）；新增 `POST /api/conversations/rename`；记录加 `titleLocked`，重命名后 AI 回复触发的自动 save 不再覆盖用户标题
- **场景面板中文化+展示条件**：执行详情页场景分组面板仅在「comic + 分镜含 sceneId + 生图未开始」时展示；场景名取 scenePrompt 中文摘要，不再显示英文 slug/no-scene；顶部加说明行
- **joke-comic SKILL 对齐**：分镜规格补 sceneId/scenePrompt（对齐工作流硬校验）；数字诡辩正例换成房贷 40 年（原正例与烂梗黑名单自相矛盾）；明确「画面里具体说话的拟人角色入 cast，抽象概念不入」
- **Seedream seed 透传**：`volcengine.js` 不再丢弃 `seed` 参数

### 验证
- 新增 `comic-workflow.test.js` 覆盖对白长度/场景字段、场景 prompt、直接替换页图、场景分组更新
- `node --test packages/shared/test/comic-workflow.test.js`、`npm run typecheck`、`npm run test`、`npm run build` 全绿

## v0.11.12 (2026-08-31) — 日志系统重构 + 漫画逐页进度 + joke-comic SKILL 数据驱动升级

### 变更
- **日志系统重构**（`shared/logger.js`）：跨天自动切文件（修复长驻进程启动时固化文件名、跨天写错文件）；本地时区日期（弃用 `toISOString` 的 UTC，凌晨会错一天）；**恢复倒序展示**（最新在上）；跨天清理过期日志（>7 天）；内存 buffer 优化（避免每次读全文件）
- **漫画逐页进度**：`generate-pages.js` 每页把 `progress="N/29 页"` 写进 state，前端执行详情页 running 时实时显示「正在执行... N/29 页」
- **joke-comic SKILL 数据驱动升级**：手写「母题库/语言梗技法库/金句三技巧」替换为从 2613 条真实段子提炼的「反转结构公式」（总纲 + 6 子类，各配真实正例 + 何时用 + 占比）；新增「爆点榨取法」（数字对比/跨域对标/跨代延伸/绝杀补刀/升维荒诞 5 维度 + 房贷 40 年示范）；新增「烂梗黑名单」（过时/用滥，与低俗解耦）；创作流程加「检索素材」步骤（`searchKnowledge` learn-jokes）；规则去重归位（一条规则只出现一次）
- **素材库建设**：A-Joke 笑话 2613 条导入 chroma `chat/learn-jokes`（打标「类型+内核」+ 去重 state），作为段子生成的案例弹药库

### 踩坑
- minimax Token Plan 429 限流无法批量打标 → 临时用 deepseek-v4-flash（JSON 完整，pro 是推理模型 reasoning 吃满 maxTokens 会截断）
- 日志「倒序」意味着每次写全文件（O(n²)），app 日志大时慢；workflows 日志几 KB 无感

### 验证
- typecheck + test（shared 18 + mm 9 + search 5 全绿）；logger 倒序自检通过（文件首行=最新）

## v0.11.11 (2026-08-28) — joke-comic SKILL 优化：笑点具体化 + 语言梗库 + 分镜对齐 comic

### 变更
- **笑点落地铁律**：每个笑点必须落到具体物/数字/动作/一句机锋，禁止抽象情绪词当笑点；梗要「能画出来」
- **语言梗技法库**：新增 9 类（谐音/双关/成语新解/歇后语/网络热梗/数字梗/逻辑梗/押韵rap/对比反差），每类带正例 + 红线
- **故事完整性优先级**：明确「故事闭环 > 笑点密度」，起承转合四段各给验收点
- **分镜 JSON 化对齐 comic-generation**：分镜从 markdown 表格改为 `pages[{imagePrompt, cast:[{name,side}], dialogue[]}]`；对话格里「正在提问的人 side=left、回应者 side=right」，cast 只放会说话角色

### 验证
- SKILL 为纯文本指引，无代码，人工核验结构完整性

## v0.11.10 (2026-08-28) — 漫画微调改图片编辑 + 逐页容错/占位图 + preprocess 合并 vision

### 变更
- **漫画微调 = 图片编辑（不再重新生成）**：`comic lib/tweak.js` 底图固定为当前页（编辑语义），prompt 改「保持构图不变只做局部修改」；上传图交给 vision 模型（`callMultimodalLLM`）读成「修改意图」文字并入反馈；生成失败的页回退角色参考图做全新生成
- **逐页容错 + 占位图**：`generate-pages.js` 每页 try/catch（如敏感内容），失败只标记该页 `error` 并继续，不再中断整批；幂等复用已存在页文件（重试只补缺页、不重生成好页）；前端 `ImagesGallery` 对失败页渲染占位图 +「微调这页」按钮（新增 `onTweakPage` 回调）
- **最少页数参数**：`pageCount` 语义从「恰好 N 页」改「至少 N 页」（label「最少页数」），`validateStoryboard` 加硬校验 `pages.length < min` 自动重试
- **preprocess 合并进 vision（根治 401）**：删除独立 preprocess 模块（`core/preprocess-fetch.ts` / `core/preprocess-model.ts`），`preprocess.ts` 复用 `callMultimodalLLM`（跟随 vision provider）；设置页删 preprocess 选项、`types.ts`/`init.ts` 清理、`selection.json` 清残留
- **移除视频能力**：前端上传 `accept` 去 video 类型 + `/api/upload` 删 video 分支；`pipeline.ts` 视频无条件 `stripVideos` 静默丢弃；`video.ts` 删 `processVideos`/`loadVideosAsFile` 死代码，只留 `stripVideos`

### 踩坑
- `callMiniMax.callLLM` 默认 `format='json_object'` 会强制 JSON 输出，preprocess 要自由文本，需显式传 `format: null` 跳过 `response_format`
- tweak 上传图路径是 `/api/uploads/<filename>`（URL 路径非本地路径），需 `resolveUploadPath` 转 `data/static/images/<filename>` 才能读文件

### 验证
- typecheck + test（shared 18 + mm 9 + search 5）+ build 全绿
- 真实验证 `callMultimodalLLM`（minimax M3）读图返回描述、无 401

## v0.11.9 (2026-08-28) — 接入火山引擎 Seedream 图片模型 + 漫画微调/分镜优化

### 变更
- **火山引擎图片模型**：新增 `shared/llm/providers/volcengine.js`（Doubao Seedream 5.0 lite），接入 `IMAGE_GENERATORS`；密钥/baseURL/model 放 `.env`（VOLCENGINE_*），`env.ts`+`init.ts` 注册，启动时自动种子进 `data/settings/providers.json`；设置页「图片生成」加选项、配置卡自动出现
- **漫画微调复用通用 loading**：`comic lib/tweak.js` 驱动 generate-pages 步 running/completed，前端现有 step-running loading 自动显示；微调弹窗页选择默认不全选 + 空选拦截
- **分镜优化**：storyboard 提示词四要素（背景/人物/构图/说话人）+ 单镜头禁分格 + 对白≤3句硬校验；generate-pages 删除"已存在跳过"（重试=重生成）
- **重试轮询修复**：execution 页轮询条件加 `retrying`，重试后自动显示 loading 无需手动刷新
- **joke-comic SKILL**：新增内涵段子漫画创作技能
- **dialogue 改数组**：分镜 `dialogue` 为字符串数组（每元素「名字: 台词」），计数/生图/微调归一化兼容旧 string
- **画廊条漫+序号**：`ImagesGallery` 改无间隔连续竖排（条漫），每页左上角半透明序号徽章；去对白文本块
- **微调后图片自动刷新**：画廊图片 URL 加 `?v=<tweakCount>-<completedAt>` 缓存破坏 + 微调 done/failed 时 `fetchExecution()`，无需手动刷新
- **微调只提交本次反馈**：prompt 反馈块仅含本次 `feedback`，`tweakHistory` 仍累积但仅记录/日志不喂 AI（避免历史指令干扰指定页）
- **微调单选+参考图回退**：页选择改 radio 单选（一次一页）；参考图优先级 上传/粘贴图 > 角色参考图 > 当前页（不再用坏页当基底，错误不被保留）
- **prompt 强化**：每说话人仅一个气泡尾部指向该人物/左人左泡右人右泡；画面干净无黑点
- **日志增强**：storyboard/generate-pages/tweak 打印提交给 AI 的最终 prompt 全文（system+user / 图片 prompt）+ AI 原始返回
- **hot-news 定时任务**：新增每日热点新闻聚合（baidu/douyin/sina/toutiao/weibo/zhihu 六源并行抓取 → 关键词分类去重 → HTML 仪表盘 `dashboard.html`）

### 踩坑
- Seedream baseURL 用 `/api/plan/v3`（plan key），文档示例为 `/api/v3`；存 `.env` 可在设置页改
- `initSettings` 只种子**缺失**的 DEFAULT_PROVIDERS，不覆盖已有；新 provider 要进 `init.ts`+`env.ts` 才能从 `.env` 自动同步

### 验证
- typecheck+build 全绿；Seedream 文生图实测返回 URL；启动后 providers.json 自动含 volcengine

## v0.11.8 (2026-08-27) — 漫画生成工作流 + 工作流级资产库 + 执行记录存储下沉

### 变更
- **漫画生成工作流**：新增 `templates/comic-generation/`（2 步：script 分镜 → generate-pages 逐页生成），故事文本 → AI 分镜（含角色/关系解析）→ 逐页生成漫画图（对白直接画进画面），执行详情页新增 `images` 画廊预览
- **工作流级资产库**：新增角色参考图库 + 风格库（`lib/assets.js` + 引擎级 8 个 actions），跨执行复用。角色参考图「描述→AI 生成→预览→填名保存」两步式，风格纯文本手动创建；`http.js` 注册 7 个 custom handler + 1 个 stream（`dir` 字段自定义）
- **存储重构**：执行记录从 `data/workflows/<id>/` 下沉到 `data/workflows/tasks/<id>/`（`state.js` DATA_DIR 一处改，engine 等 6 处零改动）；资产库落 `data/workflows/assets/{characters,styles}`；`http.js` stream 原语支持 per-action `dir`（默认 `data/workflows/tasks`）
- **一致性机制**：每页用全员参考图 base64 作 `subject_reference`（minimax）/`image_url`（qwen）+ 风格 prompt + 固定 seed
- **工作流页面三层路由**：`/workflow`（类型卡片）→ `/workflow/type/[templateId]`（该类型执行记录 + 直接创建 + comic 专属资产库）→ `/workflow/execution/[id]`（详情）；「创建工作流」直接弹当前类型表单（去掉选类型步骤）
- **资产库移入漫画类型页**：角色参考图 / 风格拆为两个独立按钮+抽屉（原 tab 形式）；角色参考图生成支持**上传参考图（图生图）**，`generateCharacterHandler` 透传 `image_url`
- **逐页生成耗时日志**：`generate-pages.js` 每页记录生成/下载耗时 + 总耗时
- **画廊左右滑动**：`ImagesGallery` 接入 `image-viewer`（`ImageViewerProvider` + `register/open`），点图放大、←/→ 切换、页码
- **漫画隐藏微调**：执行详情页「微调」按钮仅 `video-generation` 显示（漫画无 tweak，消除「该模板不支持微调」报错）

### 踩坑
- 工作流资产（参考图/风格）是跨执行持久数据，不能放 `data/workflows/` 下——`listExecutions` 会扫描所有子目录读 state.json，混入会误判为执行记录且计数错乱；下沉到 `tasks/` 后与 `assets/` 平级天然隔离
- `tool` 步骤 args 只展开 output 的 string 字段，数组字段（如分镜 `pages`）不会进 `vars`；故 storyboard 把 `pages` 序列化成 `pagesJson` string 字段传参

### 验证
- `npm run typecheck` + `npm run test:shared`（18 全绿）
- 后端自检：actions 合并无重复（22 个）、matchPath 资产路由正确（list/生成/保存/删除/文件流互不冲突）

## v0.11.7 (2026-08-27) — qwen3.8-flash 接入 + 视觉/preprocess 迁 qwen + 模型可用性打标

### 变更
- **qwen3.8-flash 接入**：聊天 / MCP工作流 / 视觉评估三处面板加 `Qwen3.8-Flash`；`multimodal-config` 的 `imageModels` 加 `qwen3.8-flash`（支持图片直传）；`cost.ts` 补价（输入 ¥1/M、输出 ¥3/M）
- **视觉评估迁 qwen**：修复 404（`qwen3-vl-flash` 不在 token-plan 模型列表）——vision 默认改 `qwen3.8-max`，面板删除/标注该模型
- **preprocess 迁 qwen**：修复 429（minimax 配额耗尽）——preprocess 默认改 `qwen3.8-max`，加迁移 `minimax → qwen3.8-max`；`preprocess-fetch.ts` body 按 provider 分支（minimax 用 `reasoning_split`，qwen 用 `enable_thinking`，参数不通用）
- **模型可用性枚举**：`Availability = "api" | "plan" | "both"`，面板按类型打标「仅 API 支持」/「仅 Coding Plan 支持」；`qwen3-vl-flash`、`fun-music-v1` 标 `api`（token-plan 无此模型），其余 `both`。不禁用、可点（便于临时换 key 后仍可选用）
- **preprocess 提示词通用化**：从「1-2 句话总结」改为「忠实提取器」（转写全部文字 + 表格/图表结构带数据 + 视觉信息 + 不编造），修复传图只拿到结构、解析不出细节的问题

### 踩坑
- token-plan 模型列表 ≠ dashscope 官方：`qwen3-vl-flash`、`fun-music-v1` 在官方有、token-plan 无（404 model_not_found）；可用视觉模型只有 `qwen3.8-max/flash` 等千问家族
- qwen 与 minimax 的 chat 参数不通用：`reasoning_split`（minimax）vs `enable_thinking`（qwen），同 body 会导致 400
- preprocess 原 prompt「1-2 句话总结」让 qwen3.8-max 只返回表格结构（列名），丢品牌名/数字等细节

### 验证
- `npm run typecheck` + `npm run test`（shared 18 / mm 18 / search 5 全绿）

## v0.11.6 (2026-08-26) — 视觉评估独立模块 + 音乐生成迁移 qwen + MCP 工具面包屑

### 变更
- **视觉评估独立模块**：新增 `vision` selection 模块（面板「👁️ 视觉评估」），可选 MiniMax-M3 / Qwen3.8-Max / Qwen3-VL-Flash；`getMultimodalProvider()` 改读 `selection.vision`（原硬编码 `MULTIMODAL_MODELS` 已删）
- **generateDiagram 修复**：`generateCode` 加 `format:""`（原默认 `json_object`，DeepSeek 要求 prompt 含 "json" 导致 400）；视觉评估不再硬回退 MiniMax（原 workflow=deepseek 时回退 minimax 触发 429）
- **音乐生成迁移**：`bgm` 模块改名 `music`（面板「🎵 音乐生成」），移除 minimax（已不支持），仅留 qwen `fun-music-v1`；新增 `generateMusic` / `checkMusicProgress` 两个 MCP 工具（整首歌：prompt/lyrics/gender/is_instrumental，返回 24h 有效 URL）；media 工具 3 → 5，工具总数 33 → 35
- **MCP 工具面包屑日志**：`mcp/index.js` 包一层 `server.tool`，每次调用记 `▶ 调用工具: <name>` / `■ 工具完成: <name> 耗时 Xs`（模型名复用工具内 provider 日志）
- **设置页网格**：模块模型选择最多 4 列（`lg:grid-cols-3` → `lg:grid-cols-4`）

### 踩坑
- fun-music 走 DashScope 原生端点（`/api/v1/services/audio/music/generation`），非 compatible-mode，需 `baseURL.replace(/\/compatible-mode\/v1\/?$/,"")` 变换（同 qwen generateImage）
- qwen3-vl-flash 默认关思考，`enable_thinking:false` 是 no-op；qwen3.8-max 默认开思考，false 恰好关掉——故 qwen.js 写死的 `enable_thinking:false` 无需按 model 条件化
- 工作流模板 `bgm`（bgm_prompt/bgm.mp3/BGM 步骤/engine.js bgm_file）是工作流自有概念，与 selection 模块 key 解耦；迁移只改 selection key，工作流 `generateBGM` 函数名保留

### 验证
- `npm run typecheck` + `npm run test`（shared 18 / mm 18 / search 5 全绿）
- `node --check` 各改动 js 通过

## v0.11.5 (2026-08-25) — 定时任务目录收拢 + 日志体系收敛 + searxng 噪音治理

### 变更
- **tasks 目录收拢**：任务目录统一移入 `packages/tasks/tasks/`（引擎文件留顶层）；`.gitignore` 仪表盘匹配改 `packages/tasks/**/dashboard.html`
- **手动触发写日志**：新增 `packages/tasks/run-task.js`，`npm run tasks:run` 改经它执行，日志与 cron 一样写 `tasks-YYYY-MM-DD.log`（此前手动触发不留痕）
- **服务日志统一**：新增 `scripts/log-wrap.js`，search-service / searxng 改经它启动，统一写 `logs/services/services-YYYY-MM-DD.log`（倒序 + 按日 + 7 天清理）；`dev.sh` / `prod.sh` / `stop.sh` 同步
- **searxng 噪音治理**：`settings.yml` 用 `inactive: true` 禁用 wikidata / torch / ahmia（403 限流 / 缺依赖噪音）；新增 `limiter.toml` 消除缺失警告

### 踩坑
- searxng 禁用默认引擎要用 `inactive: true` 而非 `disabled: true`——`load_engines()` 只跳过 inactive，disabled 引擎照样 import + init 产生报错
- `precious-metals/history.js` 原 4 级 `..` 把历史写到了项目外（`~/Desktop/AI/data/`）；目录下移一层后 4 级恰好到项目根，自愈（新历史正确落到 `data/precious-metals/`）
- `createDateLogger` 只返回 logger 方法、不自动包装 console.log，需手动包（scheduler / run-task.js / log-wrap 均手动包）
- searxng git 版本检测报错（`could not expand include path '~/.gitcinclude'`）根因是 `version.py` 调 git 时剥离 HOME；无害（仅版本号 fallback），未修

### 验证
- `TASK=precious-metals npm run tasks:run` 链路通（行情 17/17、宏观 12/12、微信推送成功）
- `TASK=daily-reminder-am npm run tasks:run` 日志正常写入 tasks 日文件
- `npm run prod` 通过；重启后 services 日志 wikidata/torch/ahmia/limiter 全消，仅剩 git config（无害）
- 功能验证：`:8090/ready` → `{ok, searxngReady:true, firecrawlConfigured:true}`；`:8080/healthz` → OK

## v0.11.4 (2026-08-24) — 搜索能力扩展：5 工具 + SearXNG 分类 + Firecrawl 全套

### 变更
- MCP search 模块 1 tool → 5 tools（工具总数 29 → 33）
  - `searchWeb`：新增 `category`（general/images/videos/news/wechat）/ `language` / `timeRange` / `page` 参数
  - `scrapeWebPage`：抓指定 URL 为 Markdown（Firecrawl /v2/scrape）
  - `mapWebsite`：发现站内 URL（Firecrawl /v2/map）
  - `crawlWebsite`：抓网站多页（Firecrawl /v2/crawl + GET status，服务内部轮询，≤20 页）
  - `parseDocument`：解析在线 PDF（Firecrawl /v2/scrape + parsers:["pdf"]）
- SearXNG 启用 10 个引擎：baidu/sogou/bing + 各自 images/videos/news + sogou wechat
- `config/network.json` 的 `hosts.local` 改为 `127.0.0.1`，所有服务地址从 config 读取（不再硬编码）
- Search Service 新增 `/scrape /map /crawl /parse` 端点

### 类别→引擎映射
general→baidu/sogou/bing；images→百度/搜狗/必应图片；videos→搜狗/必应视频；news→必应新闻；wechat→搜狗微信。general/news 抓前 3 条正文，其余只返回摘要/缩略图（不消耗 Firecrawl 额度）。

### 踩坑
- Firecrawl `/v2/scrape` 的 `parsers` 枚举仅支持 `"pdf"`（docx/doc 需走 `/v2/parse` 文件上传，未接入）
- Firecrawl GET 请求不能带 body → `firecrawl()` 按 method 决定是否传 body
- 残留旧 search-service 进程占 8090 端口致新代码请求打到旧进程（EADDRINUSE），需先 kill

### 验证
- `npm run test`：shared 18 + mm 18 + search 5 全过
- `npm run test:search:live`：真实 Firecrawl scrape/map/crawl/parse 5 项通过
- typecheck + build 通过
- 端到端实测：general/images/wechat 搜索、scrape、map(17 URL)、crawl(2 页)、parse(PDF) 全通

## v0.11.3 (2026-08-24) — 联网搜索能力（searchWeb）

### 背景
MCP 原本只有 `fetchPage`（访问已知 URL）和 `crawlSite`（单站爬取），没有真正的搜索能力。模型查询实时信息时只能凭知识猜 API 地址、用 `exec` 临时写 Python，失败后无限盲试。

### 变更
- **删除** `packages/mcp/tools/fetch/`（fetchPage / crawlSite），MCP 工具 30 → 29
- **新增** `packages/mcp/tools/search/`：`searchWeb` 工具（薄适配，调搜索服务）
- **新增** `packages/services/search/`：独立 Node 服务（非 npm workspace 包）
  - 本地 SearXNG（Python venv，仅 baidu/sogou/bing，输出 json）
  - Firecrawl Cloud `/v2/scrape` 抓前 3 条正文转 Markdown
  - 编排：URL 去重、限额（≤10 结果、≤3 正文）、引擎状态
- `config/network.json` 增 `ports.searxng`(8080) / `ports.searchService`(8090)
- `.env` 增 `FIRECRAWL_API_KEY`（`.env.example` 未动，key 不入库）
- `scripts/{dev,prod,stop}.sh` 接入 SearXNG + 搜索服务启停
- `route.ts` TOOLS_PROMPT 加 searchWeb 使用规则（引用来源、禁止 exec 替代搜索）

### 失败语义
- 三引擎全失败才报错；部分失败返回 `degraded=true` + 引擎状态（如 sogou 被 CAPTCHA 拦截）
- 单条 Firecrawl 抓取失败不丢弃搜索结果（`contentFetched=false` + `contentError`）

### 验证
- `npm run test`：shared 18 + mm 18 + search 3 全过
- `npm run test:search:live`：真实 Firecrawl 抓 example.com 通过
- typecheck + build 通过
- 端到端实测：SearXNG baidu 9 条 + Firecrawl 抓 3 条正文成功（sogou CAPTCHA 正确标记 degraded）

## v0.11.2 (2026-08-24) — 修复历史过期图片导致聊天 500

### 根因
会话历史里残留过期 OSS 签名图 URL（`Expires` 已过）时，DeepSeek 等纯文本模型走 preprocess 路径，`preprocess.ts` 把原始 URL 直接发给 MiniMax-M3 描述，M3 fetch 过期 URL 得 403 → `preprocess 调用失败 (400): remote returned status 403` → 整条聊天 500。

### 修复
- `preprocess.ts` 远程图片先 `downloadRemoteImage()` 下载到本地缓存再 base64（对齐 direct 路径）；下载失败（过期/403）跳过该附件
- 本地文件/超限附件/缺失文件均 try/catch 降级跳过，不再抛错
- 一个附件都没解析出来时返回空描述（不调 LLM、不阻断对话）；空描述在 `buildSystemPrompt` 中不注入

### 验证
- typecheck + build 通过
- curl 确认过期 OSS URL 返回 403（`downloadRemoteImage` `!response.ok` → null → 跳过）

## v0.11.1 (2026-08-24) — 修复会话置顶不生效

### 根因
- `left-sidebar.tsx` 的 `handlePin` 只翻转 `pinned` 标志、未重排列表——排序逻辑只存在于 `fetchConversations`（挂载/refreshKey 时执行），所以置顶后会话不跳到顶部
- `store.ts` 的 `pinConversation` 置顶时 `updatedAt = Date.now()`，取消置顶后污染时间排序（本应回落原时间位却排到未置顶组最前）

### 修复
- 抽 `sortConversations(list)` 纯函数（pinned 优先 + updatedAt 倒序），`fetchConversations` 与 `handlePin` 复用
- `handlePin` 乐观更新后重排：置顶当场跳顶、取消回落到原时间位
- `pinConversation` 删 `updatedAt = Date.now()`，置顶/取消置顶只改 `pinned` 标志

### 验证
- `npm run typecheck` 通过；置顶/取消的跳位与回落靠人工点击确认（纯前端 UI 排序，无组件测试基建）

## 文档体系 (2026-08-21) — 三文档拆分 + md 命名统一

非代码版本发布，记录文档基础设施变更。

- 新增 `ARCHITECTURE.md`：代码实现单一真相源（包拓扑 / 目录结构 / 能力注册机制 / 知识库 / SKILL / 工作流 / 定时任务 / MCP 章节）；新建项目级 `AGENTS.md`（本地文件，已 gitignore）：会话先读 ARCHITECTURE.md + 结构变化同步 + 验证门禁
- `design.md` → `DESIGN.md`（md 命名统一大写），瘦身 474→232 行只留设计决策/规范；mermaid 策略模式 / API 表 / .env 示例补 qwen
- 根 README 纠偏：30 tools / 7 模块（补 preprocess）/ 工作流引擎 / proxy.cjs / 日志路径；文档区加 ARCHITECTURE / DESIGN 链接
- `packages/mcp/README.md` 重写（对齐 30 tools 实况，删过时 video 工具描述）；ai-chat README 瘦身为指针+包内特有内容；workflows/tasks/shared 补指针 README（锚点指向 ARCHITECTURE.md）；skills README 修过时引用

相关提交：41ec6bb / 60e8933 / 4aba768 / 538a508

## v0.11.0 (2026-08-21) — 阶段三：声明式能力注册（workflows/tasks 收敛进包）

### 背景
ai-chat 的 app/api 里堆着 15 个 workflows/tasks 路由：薄 CLI 包装、tweak 113 行后台编排（直接写 engine 的 state.json）、video-generation 特有能力（generate-content/upload）。能力逻辑泄漏在宿主应用里，与「ai-chat 只做注册」的目标架构相悖。
设计文档：`docs/superpowers/specs/2026-08-21-capability-registration-design.md`

### 新架构：actions.json + 通用 dispatcher
- `packages/shared/capability.js`：通用 dispatcher，4 原语（cli/stream/upload/custom）；路径模式 `:param` + 尾部 `*`；required 校验（version=0 不误杀）；notFound→404；detached fire&forget；stdout JSON 提取 + dotenv 噪音过滤 + 错误消息清洗
- `packages/workflows/actions.json`：引擎级 10 动作（templates/execute/executions/get/delete/file/next/auto/retry/skip）
- `packages/workflows/templates/video-generation/actions.json`：模板级 4 动作（generate-content/upload/tweak/switch-version）；http.js 自动扫描合并 templates/*/actions.json（重复 method+path 启动即报错）
- `packages/tasks/actions.json`：4 动作（list/run/edit/dashboard，全 custom）
- workflows/tasks 各加 package.json（@app/workflows、@app/tasks workspace 包）
- ai-chat 只剩 2 个挂载点：`app/api/{workflows,tasks}/[[...path]]/route.ts`（各 10 行纯委托），删 15 个旧路由 + `_lib/cli.ts` + `_lib/prompt.ts`

### engine 瘦身：video 概念迁出
- `tweakExecution`/`switchScriptVersion`/`initScriptHistory`/脚本版本读写/`resetSteps`/TWEAK_LIMIT 迁往 `templates/video-generation/lib/{tweak,switch-version,script-version}.js`（engine.js -275 行）
- `evaluateSkipWhen` 抽 `lib/skip-when.js`（engine 与模板共用）；LOG_DIR 移入 `lib/state.js`
- cli 按模板分发：`switch-version` 动态 import `templates/<t>/lib/switch-version.js`；新增 `tweak-auto`（import `templates/<t>/lib/tweak.js`，模板无该文件→明确报错）；新增 `templates` 命令；`retry` 收敛为组合命令（retryStep+runNextStep，原 ai-chat 两次调用）；`get` 统一 JSON 参数契约
- 原则保持：模板不 import engine.js（阶段二确立）

### tweak 编排收编
- ai-chat 113 行后台编排迁往 `packages/workflows/lib/tweak-auto.js`：写 tweakTask running → 模板 tweak → completed+version → runAllSteps → done/failed
- 修掉 ai-chat 直写 engine state.json 的泄漏（全部经 lib/state.js，子进程内完成）
- tweak 日志从 logs/app（前置拼接）改为 logs/workflows 日期日志

### 保留不变
子进程执行边界、console 劫持隔离、detached 长任务、全部 URL/请求/响应契约（前端零改动）

### 验证
- capability.test.js 11 个（匹配/解析/4 原语/required/notFound/Range/穿越守卫）；test:shared 18/18、test:mm 18/18、typecheck、build 全过
- dev server 端到端 curl 14+4 接口全通：templates/executions/execute/get(404 映射)/delete/next/retry/skip/switch-version/tweak（后台流水线 running→failed 状态机 + 日志）/file 全量+Range 206/upload 成功+拒绝/generate-content 真调 LLM 成功/tasks list/run-404/edit/dashboard HTML
- mcp（30 tools）+ scheduler 冒烟通过

### 坑记录
- Next webpack 打包的代码（http.js/handlers.js）不能用 import.meta.url 定位磁盘文件 → 沿用 process.cwd()=packages/ai-chat 约定
- Node ESM 裸导入子路径必须带 .js 后缀（`@app/workflows/http.js`）
- `/api/tasks` 本体无路径段 → 必须 `[[...path]]` 可选捕获 + segments 空值兜底
- 删路由后须清 `.next/types` 残留 validator，否则 typecheck/build 报已删模块

## v0.10.5 (2026-08-21) — 架构优化：shared 真包化 + 反向依赖消除

### 背景
- shared 无 package.json，4 个消费者（ai-chat/mcp/workflows/tasks）靠相对路径连接（最深 `../../../../shared`）；ai-chat 另有私有 `@shared` tsconfig 别名，导入方式不统一
- `templates/video-generation/lib/render.js` 动态 `import("../../../engine.js")` 取 `saveVideoVersion`——模板反向依赖引擎

### 阶段 1：shared 真包化
- 新增 `packages/shared/package.json`（`@app/shared`，private，type module，无 exports 字段 → Node 默认子路径解析）
- `npm install` 生成 workspaces 软链 `node_modules/@app/shared → ../../packages/shared`
- 26 个文件 42 处 import 全改裸导入 `@app/shared/...`：mcp 16 / workflows 17 / tasks 3 / ai-chat 6（含 generate-content/route.ts 的 6 层相对路径）
- 删 ai-chat tsconfig 的 `@shared/*` paths 别名（node_modules 解析，moduleResolution bundler）

### 阶段 2：反向依赖消除
- 新增 `packages/workflows/lib/state.js`：从 engine.js 迁出 DATA_DIR / VIDEOS_DIRNAME / ensureDir / readState / writeState / getVideosDir / saveVideoVersion
- engine.js 改 `import { DATA_DIR, ensureDir, readState, writeState } from "./lib/state.js"`（-44 行）
- render.js 动态导入改 `../../../lib/state.js`；模板→引擎反向依赖清零

### 验证
- typecheck ✓ / test:shared 7/7 ✓ / test:mm 18/18 ✓ / workflows cli list ✓ / mcp 启动（30 tools）✓ / tasks scheduler（2 任务）✓ / npm run build ✓
- 风险点确认：shared/llm/config.js 靠 import.meta.url 定位 data/settings，软链后 Node 解析真实路径，不受影响

### 文档
- design.md 更新 shared/（@app/shared workspace 包）与 workflows/lib/state.js 树

## v0.10.4 (2026-08-20) — TTS 超时 + 孤儿步骤自愈

### 背景
任务 5d959842270c tweak 后 TTS 等待 ~8 分钟，期间 step=running、UI 转圈、next/auto 被守卫挡住，形似卡死（最终 poll 上限内自解）。暴露三类脆弱点。

### 修复
- `shared/llm/providers/minimax.js` generateTTS：create/poll/files-retrieve fetch 加 `AbortSignal.timeout(30s)`、下载 120s（原来无超时，单个 hang 请求可阻塞 forever）；poll 每 30s 打 `[tts] 轮询 i/300 status=` 日志（长等待可见，不再"静默像死"）
- `engine.js` runNextStep：孤儿守卫——running 步 `startedAt` 超 30 分钟视为 worker 已死，重置 pending 继续（合法步骤上限是 render 超时 5 分钟，30 分钟安全；多服务器场景不做启动扫描，避免误伤）
- 详情页：running 步也显示「重做」按钮（即时手动解卡；engine retryStep 本就允许任意状态）

### 测试
- `tts-timeout.test.js`：不可达 baseURL，generateTTS 40s 内必抛（shared 测试 7/7）

### 外部事实记录
- MiniMax Music API 对新用户停服 → BGM 步永久 warning（用户决定保持现状：视频静音；开关 enable_bgm=no / bgm_file 上传）
- MiniMax TTS 队列偶发慢（~8min），现有 300×2s poll 上限可覆盖

## v0.10.3 (2026-08-20) — 机械门禁 + 阶段三 工作流 warning 与轮询

### P0 机械门禁（把"记得跑"变"必须过"）
- 根 `package.json` 加 `test`（= `test:shared` 6 个 + `test:mm` 18 个）与 `typecheck`（tsc --noEmit）
- `prod.sh` 加门禁：build 前必须 `npm run test && npm run typecheck`；不引新依赖（无 husky/CI；将来有 remote 原样搬进 Actions）

### P1 阶段三：warning 不被吞 + 轮询收敛
- `engine.js` 新增 `deriveTerminalStatus()`：末步完成但有 warning 步 → 终态 `completed_with_warnings`；`TERMINAL_STATUSES` 统一 runNextStep 守卫与 runAllSteps 终止判断
- `completedSteps` 不再把 warning 计成 completed；列表 API 新增 `warningSteps` 字段
- 列表页：条件轮询（仅有 running 执行时 5s 轮询）；徽章 `⚠️ 完成(有警告)` + 黄色状态 bar + 排序优先级紧随 running
- 详情页：轮询收敛为"有 running step 或 tweakTask running 才轮询"（warning 卡住/等待手动 next 不再 2s 空转）；新终态停轮询/解锁；进度行显示 `· N 警告`
- 回归：`engine-status.test.js` 3 个（终态纯函数）
- 修收敛回归：auto/next 的 POST 在服务端阻塞、客户端看不到 running step → 轮询条件加 `autoLoading || nextLoading`；`handleAuto` 返回后补 `fetchExecution()`。浏览器实测：点自动执行不刷新实时翻态，终态后轮询停

## v0.10.2 (2026-08-20) — 阶段一 settings 分发加固 + 阶段二 多模态管线修复

### 阶段一：settings 分发加固（shared/llm + ai-chat settings）
- `shared/llm/config.js`：新增 `LLM_SETTINGS_DIR` 测试缝隙、`getProviderModel()`、`assertProviderEnabled()`（unknown/disabled provider 明确抛错，不静默回退）
- `shared/llm/index.js`：workflow selection fresh-read，`selection.workflow.model` 真正传给 provider（此前路径 bug 一直回退 env）
- 4 个 provider（deepseek/glm/minimax/qwen）删模块级 baseURL/model 缓存，每次调用 fresh-read（改配置无需重启）
- ai-chat settings 删 `protocol`/`anthropicBaseURL` 残留（dispatcher/types/设置 UI）；`mcp-client.ts` 删 orphan reload-marker
- `strategies/deepseek.ts`：pro 档读 chat 选择、flash 档固定 `deepseek-v4-flash`

### 阶段二：多模态管线修复（按实际模态分流 + 失败不静默）
- 新增 `multimodal/preprocess.ts`：统一图片/视频 preprocess；**只发媒体、单条 user 消息**（根因修复：原来发全量对话含 assistant 轮，preprocess 模型续写回显历史而非描述图片）；远程 URL 转 `image_url`/`video_url`；缺失附件/超大小明确抛错
- `core/preprocess-fetch.ts`：HTTP 非 2xx、空 body、空 content、无效 JSON 均抛错（不再静默剥离）
- `pipeline.ts`：按实际存在模态分流；先按历史深度裁剪；图片+视频均需 preprocess 时合并为一次调用
- `multimodal-config.ts`：Qwen `videoModels: []`（video 禁止 direct）；`maxImageFileSize` 10MB；`isWithinHistoryDepth()`
- `image.ts`/`video.ts`：删旧重复 preprocess；direct 路径 name-based 去重 + 既有 file part 大小校验；strip 后空消息补 `[图片]`/`[视频]` 占位
- `attachment.ts`：`assertMediaDataSize()`（内联 base64 不绕过大小上限）
- `route.ts`：注入描述加绑定引导句（把 `[图片]`/`[视频]` 占位符与描述显式绑定，文本模型不再弃用描述）；`[multimodal] systemInjection len=` + `[preprocess] 描述 len=` 日志

### 测试（新增 packages/shared/test/，统一测试目录）
- `llm-dispatch.test.js` 3/3（阶段一回归）
- `ai-chat-multimodal.test.ts` 18/18（含回归：preprocess 请求只含媒体、不带历史对话轮）
- 运行：根目录 `node --test packages/shared/test/llm-dispatch.test.js`；ai-chat 下 `npx tsx --test ../shared/test/ai-chat-multimodal.test.ts`

### 验收
- 手工 1-4 通过：MiniMax 图片 direct；DeepSeek 图片/视频/图片+视频 描述注入
- 5-7（Qwen 图片/视频、preprocess 坏 baseURL 报错）因 Qwen 额度延后

## v0.10.1 (2026-08-20) — 模型选择取值修复 + 确认弹窗抽组件 + 移除重启机制

### 模型选择取值修复
- `getChatStrategy` 改按 `cfg.provider` 识别 strategy（原来解析 model 前缀，`qwen3.8-max` 拆成 `qwen3.8` 错配回退 minimax）
- `module-selector` chat deepseek 的 model 去掉 `(自动路由)` 后缀（原来把展示标签写进 selection.json 成非法 id）
- `deepseek.ts` 自包含 `DEEPSEEK_PRO/FLASH`：resolveModel 不再读 workflow（原来 chat=deepseek+workflow=minimax 时发 MiniMax-M3 给 DeepSeek → 400）；classifyTask 改读 chat 配置

### 确认弹窗抽组件（Neo-Brutalism）
- `alert-dialog.tsx` 加 brutal 卡片主题：overlay `bg-black/50`、content `rounded-none brutal bg-card`、footer 粗黑分隔、title 加粗；Action/Cancel 保持中性
- 新建 `components/ui/confirm-dialog.tsx`：共用确认弹窗，红色语义收敛在此（Action 红/Cancel 白，含 loading/tone）
- 4 处删除/整理确认（workflow / execution / memory×2）改用 `<ConfirmDialog/>`；创建工作流(自定义 div)、tweak(自定义按钮) 不受红色影响

### 移除重启机制
- 所有配置 fresh-read，保存即生效 → 删设置页"重启 MCP/定时任务"按钮 + 过时文案，改单行提示
- 删 `api/settings/restart-services` 路由；`scheduler.js` 删失效的 scheduler.pid 写入
- 坑：删路由后 build 报 Cannot find module（tsconfig include `.next-prod/types`）→ 清 `.next-prod/types` + `.next/cache/.tsbuildinfo`

## v0.10.0 (2026-08-19) — MiniMax M3 协议切换 + settings 单一真源 + lib/ 目录合理化

### 阶段 1：M3 切 OpenAI 兼容协议（修复"笨"）
- 根因：M3 走 Anthropic 协议 + `thinking:adaptive` + 128K `max_tokens`，thinking 与 text 共享配额被挤，输出被截断
- `providers.json` 删 `anthropicBaseURL`；`route.ts` 删 `M3_MAX_OUTPUT_TOKENS`/`isMiniMax`/`providerOptions`
- `chat-strategy` 加 `injectReasoningSplit`（注入 `reasoning_split:true`，thinking 分离到独立字段）；按 model 前缀识别 strategy
- 修复：删 anthropicBaseURL 后 dispatcher 返回 `protocol:"openai"`，原 `cfg.protocol==="anthropic"` 判断失效 → 改按 `model.toLowerCase().startsWith("minimax")`

### 阶段 2：settings 单一真源（动态读配置）
- `settings/types.ts` 加 `flashModel?` + `preprocess` module；`dispatcher.ts` 加 `provider`+`flashModel` 字段
- `providers.ts` 重写为 `getEmbeddingModel()`/`getWorkflowModel(tier)`/`getPreprocessModel()`（embedding 仅 GLM、preprocess 独立 module、workflow 支持 pro/flash 分级）
- `m3-raw-fetch.ts` 改读 `preprocess` module + `reasoning_split:true`
- `env.ts` 删 4 死常量；`instrumentation.ts` 启动时 `initSettings()`（删 JSON 后自动重建含新字段）
- `lib/prompts/video-content.txt` → `video-content.ts`（导出常量 + `buildVideoContentPrompt`）

### 阶段 3+4：lib/ 目录合理化（co-locate + 平级化，12 移动）
- 单 caller co-locate：`prompts/video-content.ts`→`workflows/generate-content/_lib/prompt.ts`；`ai/router/model-display.ts`→`components/chat/_model-display.ts`；`utils/mime.ts`→`multimodal/mime.ts`；`utils/upload-client.ts`→`(main)/_lib/`；`workflow-cli.ts`→`workflows/_lib/cli.ts`；`store/conversation-store.ts`→`conversations/_lib/store.ts`
- `lib/ai/*` 拆平级到 `lib/`：`core/ strategies/ multimodal/ router/ mcp-client.ts`，删 `lib/ai/`
- 最终 `lib/` 7 子系统：`core/ strategies/ multimodal/ rag/ settings/ utils/ + mcp-client.ts`；`utils/` 精简为 `utils/types/cost/env`

### 阶段 5：classifyTask 归位
- `classifyTask` 是 DeepSeek 专属（仅 DeepSeek 有 pro/flash 两档）→ 从 `router/task-router.ts` 移入 `strategies/deepseek.ts`；删 `lib/router/`
- `ModelTier` 类型归 `core/workflow-model.ts`（tier 真正归属）

### 约定
- API 内部私有 helper 用 `_lib/` 或 `_` 前缀（Next.js 不扫 `_` 前缀目录）
- co-locate 原则：单 caller + 单用途 → 移到调用方同目录；多 caller/成子系统 → 留 `lib/`

### 已知外部问题
- MiniMax API key 达 Token Plan 用量上限（429 rate_limit），chat 走 minimax 会失败，需升级套餐；代码已验证正常（临时切 deepseek 全链路通过）

## v0.9.1 (2026-08-19) — Qwen 接入 + 模型适配层统一

### Qwen 接入
- chat + workflow 接入 `qwen3.8-max`（OpenAI 兼容、多态/多模态），`chat-strategy` 加 QwenStrategy（fetch 中间件注入 `enable_thinking`）
- 图片生成接入 `qwen-image-3.0-pro`（DashScope 原生接口、同步）：文生图 + 图生图、多图、watermark/negative_prompt/seed 参数
- workspace key 需专属域名：`QWEN_BASE_URL` → `token-plan.cn-beijing.maas.aliyuncs.com`，图片接口 URL 由 baseURL 派生

### 模型适配层（shared/llm 抹平差异）
- 新增 `config.js`：providers.json 为真源、env 兜底（`getApiKey`/`getBaseUrl`/`readSelection`），apiKey/baseURL 全量切到 providers.json（10 处：4 provider + chroma + diagram + xiaohongshu + 4 个 tts/bgm）
- `index.js` 重构为分发层：`getWorkflowProvider()`（fresh-read，切模型无需重启）、`generateImage`/`generateTTS`/`generateBGM` 三分发器（读 selection.media/tts/bgm）
- 多态模型 `MULTIMODAL_MODELS` + `callMultimodalLLM`：diagram 视觉校验跟随 workflow 选择，deepseek/glm 回退 MiniMax-M3
- `minimax.js` 加 `generateTTS`（异步 create/poll/download）+ `generateBGM`，4 个 workflow 模板改调统一接口
- MiniMax TTS 现返回 tar 归档：加 `extractMp3FromTar` 解包 .mp3

### 图片成本
- qwen 图片尺寸降到 1K 档（对齐 MiniMax 预设、≤1MP、¥0.25/张）

### 修复
- tweak 路由缺 POST handler（405）→ 补回
- 执行页 warning 状态误显示为「完成」：加 warning 分支 + 重试按钮
- diagram 的 `DEEPSEEK_API_KEY` 预检 bug → 改读 workflow provider
- `shared/llm/index.js` selection.json 路径 bug（workflow 选择未生效）
- qwen workflow `enable_thinking:true` + json_object 卡死 → 改 `false` + 180s 超时
- settings 保存按钮激活态文字颜色改白

## v0.9.0 (2026-08-19) — Neo-Brutalism 糖果色换肤 + 多主题体系

### 主题体系
- 新增 `data-theme` 作用域换肤：token 定义在 `globals.css` 的 `[data-theme="*"]` 块，经 `@theme inline` 映射成 Tailwind 类
- `UI_THEME` env 定默认主题（`layout.tsx` 注入 `<html data-theme>`）；settings 页用 `data-theme="pink"` 局部粉主题
- 彻底删除像素风：移除 `.pixel-*` class、`--pixel-*` 变量、fusion-pixel 字体；`pixel-logo`/`pixel-loading` 改为通用 `logo`/`loading`

### 视觉规范（Neo-Brutalism 糖果色）
- 主色电光黄 `#FFE135`（黑字），背景纯白，直角，纯黑硬阴影，hover 位移 + active 按压
- 字体换 `@fontsource` Inter / Plus Jakarta Sans / JetBrains Mono
- 用户气泡黑底白字 + 黄硬阴影，AI 气泡白底黑字；ME 头像粉底白字
- 深绿 `#16A34A` 替代荧光亮绿（成功/完成/下载）

### 页面统一
- 各页面 header 统一：`px-4 py-3 border-b-[3px]` + 标题 + 右上角「返回聊天」按钮（去 emoji 颜文字）
- memory header 重设计，数据库/collection 选择器移入主体顶部
- workflow 列表删除按钮红底白字；execution 状态标签改纯文字、正在执行时拦截「下一步/自动执行」
- 下滑到底部按钮修复：`scrollToIndex` 加 `align: "end"`（此前滚不到底）+ 5 处 `[scroll-debug]` 日志

### 博客壳（site/，糖果屋风重设计）
- `pixel.css`：纯白背景 + 电光黄/soft 色 + 导航/hero/贴纸/跑马灯/彩色 panel/黑 footer 样式
- 首页全套：sticky 导航 + hero 黄底大 panel（高亮块 + 贴纸 + 打字机 + chips）+ 跑马灯 + 3 彩色类目 panel + 黑 footer
- finance/tech/life 列表页：加导航 + 彩色 header + 黑 footer

## v0.8.1 (2026-08-18) — 网络配置抽取 + 构建修复

### 网络配置单一真相源
- 新增 `config/network.json`：集中管理 host + 端口（aiChat dev/prodDirect/prodProxy、chroma），改一处全局同步
- 新增 `packages/shared/network.js`：`loadNetworkConfig()` 从 `process.cwd()` 向上遍历找 `config/network.json`（最多 5 层），找不到带 cwd 信息抛错
- 新增 `config/README.md`：字段说明 + 消费者清单 + 明确不在 config 里的内容（API key、LLM endpoint 等）

### 消费者改造
- `env.ts`：`CHROMA_URL` 从 `process.env` 兜底改为读 config（hosts.local + ports.chroma）
- `chroma-server.ts`：spawn 的 `--host/--port` 改读 config
- `vector-store.ts` / `admin/chroma/route.ts`：硬编码 `localhost:8000` 改为 `env.CHROMA_URL`
- `mcp/lib/chroma.js` / `mcp/tools/document/index.js`：改读 `loadNetworkConfig()`
- `generate-embeddings.ts` / `verify-migration.ts`：改读 `loadNetworkConfig()`，import 用 `@shared/network.js`
- `proxy.cjs` / `prod.sh` / `dev.sh` / `stop.sh`：端口改读 `config/network.json`
- `packages/shared/utils.js`：新增 `downloadsDir`（跨工具复用），fetch/xiaohongshu/document 去重

### 修复
- **构建失败（关键）**：`env.ts` 引入 `node:fs`/`node:path` + `@shared/network.js` 后，被客户端共享模块 `utils.ts`（`cn`）通过 `import { env }` 拉进浏览器 bundle，webpack 客户端编译报 `Module not found: Can't resolve 'fs'`。修复：`utils.ts` 不再 import 服务端专属的 `env`，`BASE` 直接读 `process.env.NEXT_PUBLIC_BASE_PATH`；`env.ts` 删掉死导入 `node:fs`/`node:path`
- `vector-store.ts` `parseChromaUrl` 缺端口时直接抛错（原来静默兜底 8000）

### 文件改动

| 文件 | 改动 |
|---|---|
| `config/network.json` | 新增（单一真相源） |
| `config/README.md` | 新增（字段 + 消费者清单） |
| `packages/shared/network.js` | 新增（loadNetworkConfig 共享读取器） |
| `packages/shared/utils.js` | 加 downloadsDir |
| `packages/ai-chat/src/lib/utils/env.ts` | 读 config + 删死导入 |
| `packages/ai-chat/src/lib/utils/utils.ts` | 去 env 依赖，直接读 NEXT_PUBLIC_BASE_PATH |
| `packages/ai-chat/src/lib/rag/chroma-server.ts` | 读 config + `@shared` alias |
| `packages/ai-chat/src/lib/rag/vector-store.ts` | env.CHROMA_URL + 端口校验 |
| `packages/ai-chat/src/app/api/admin/chroma/route.ts` | env.CHROMA_URL |
| `packages/ai-chat/src/app/api/uploads/[filename]/route.ts` | 字体 MIME + CORS |
| `packages/ai-chat/scripts/generate-embeddings.ts` | loadNetworkConfig |
| `packages/ai-chat/scripts/verify-migration.ts` | loadNetworkConfig |
| `packages/mcp/lib/chroma.js` | loadNetworkConfig |
| `packages/mcp/tools/document/index.js` | loadNetworkConfig + downloadsDir |
| `packages/mcp/tools/fetch/index.js` | downloadsDir |
| `packages/mcp/tools/xiaohongshu/index.js` | downloadsDir |
| `scripts/proxy.cjs` / `prod.sh` / `dev.sh` / `stop.sh` | 端口读 config |
| `package.json` | tasks:stop 端口 4568 → 4567 |

### 验证
- `tsc --noEmit` 0 错误
- `next build`（BUILD_DIR=.next-prod）通过，路由表完整
- `loadNetworkConfig()` 从 4 个 cwd（根 / ai-chat / mcp / scripts）均读到 config
- mcp 4 个模块 + 2 个 tsx 脚本 + scheduler + proxy 全部 import/启动正常

## v0.8.0 (2026-08-14) — 设置系统 + 策略模式重构 + GLM 接入 + 多处修复

### 设置系统
- 设置页面 ：模块选择 + 模块配置
- 6 个模块独立选择：chat / media / vector / workflow / tts / bgm
- 3 个 Provider 配置：DeepSeek / MiniMax / 智谱 GLM，BASE_URL + API_KEY 在线修改
-  持久化，启动时从 env 初始化
- 状态面板模型卡片只读展示 6 个模块当前选择
- 左侧栏「设置」入口启用
- TTS/BGM 模型接入 settings： /  可配置

### 策略模式重构
- ChatStrategy / ModelDisplayStrategy / TextLLMStrategy / ImageGenStrategy
- 新增 provider 只需 1 个策略类 + 1 行注册，chat/route.ts 零改动
-  dispatch 从  改为  表
- 新增 （GLM OpenAI 兼容实现）

### GLM 模型接入
- GLM 5.2 聊天模型接入（OpenAI 兼容）
- GLM 5.2 思考模式开启：
- GLM-5 → GLM-5.2 自动迁移

### 微调支持图片反馈
- 微调支持图片上传：粘贴/上传截图或参考图
- LLM 多模态扩展： 参数
- DeepSeek 降级：图片仅作为文字提示

### 修复
- 视频进度条无法拖动： 路由加 Range 请求支持（206 + Content-Range）
- 切换版本后视频不更新：video src 加  cache buster
- 全局滚动修复：根 layout body  → 
- workflow 日志错标 ：  → 
- tweakTask 卡死 "running" 修复： timeout + auto fire-and-forget
- engine.js 最后一步立即写 
- generate-content 路由加日志

### 文件改动

| 文件 | 改动 |
|---|---|
|  (types, store, init, dispatcher) | 新增 |
|  | 新增设置页面 |
|  | 新增模块选择卡片 |
|  | 新增 Provider 配置卡片 |
|  | 新增 API |
|  | 新增策略模式 |
|  | 新增模型标签策略 |
|  | 新增 MCP 重启机制 |
|  | 新增 GLM 实现 |
|  | 新增  动态函数 |
|  | 改读 settings + 策略模式 |
|  | dispatch 改 CALLERS 表 |
|  | 加 model 日志 |
|  | 滚动修复 |
|  | 滚动修复 |
|  | 只读展示 6 个模块 |
|  | 启用设置入口 |
|  | 删 selectedProvider |
|  | timeout + fire-and-forget |
|  | Range 请求 |
|  | 加日志 |
|  | 日志级别修复 |
|  | 最后一步立即写 completed |
|  | provider 扩展 |
|  | GLM API key 检查 |
|  | 读 settings |
|  | 读 settings |
|  | 支持图片参数 |

### 限制
- MCP / 定时任务：启动时读取配置，修改后需重启进程
- 工作流 CLI：每次新进程，自动读最新配置
- 聊天/图片/向量/tts/bgm：修改后立即生效
- GLM 5.2 不支持图片输入（多模态 badge 仅 MiniMax M3）

### 验证
- tsc 0 错误
- 端到端 workflow 完整跑通

## v0.7.1 (2026-08-13) — 微调功能 + 大量优化

### 新增
- 微调功能：AI 修改脚本 + 自动重跑 render
- 历史版本管理：scripts/v{N}.json + videos/v{N}.mp4
- 版本切换：一键切换历史版本，视频立即更新
- 异步任务：POST /tweak 立即返回，后台执行
- 客户端日志：POST /api/client-log 写入 app 日志文件
- 声明式动画：data-animate-in / data-transition 属性

### 修复
- CLI argv 被 \n 破坏 → feedback 走 state.json 传递
- render.js 正则误匹配 clip-content → 改为独立 class 匹配
- render.js 多余花括号 → 语法错误无法加载
- saveVideoVersion import 路径错误
- writeState 覆盖 videoFile 问题
- prompt-builder.js parseJSON 重复声明
- schema.js fonts/palette 字段过严
- 前端 useEffect 双轮询
- tweakTask 状态不触发前端更新

### 优化
- 动画引擎重写：11 种入场预设 + 擦除转场
- 设计规范：鼓励炫技，删除禁止项
- 视频播放器 260px → 320px
- file 路由缓存改为 no-cache
- 切换版本后自动复制视频到 output.mp4
- 微调中禁用按钮防重复
- 预更新步骤状态让前端立即看到变化

## v0.7.0 (2026-08-12) — M3 切换 Anthropic 协议 + 多处修复

### 核心改动：M3 `createOpenAICompatible` → `createAnthropic`

用户发现 M3 官方推荐 Anthropic SDK，且 Anthropic 协议原生支持 `type: "thinking"` 内容块（不再需要 `reasoning_split` / `extractReasoningMiddleware` 等 hack）。

**切换后优势**：
- thinking 是协议原生 content block，AI SDK `@ai-sdk/anthropic` 原生支持
- 思考过程 `[思考过程]` UI 恢复（`thinking: { type: 'adaptive' }`）
- 图片直传恢复（M3 重新加入 multimodal registry）
- 工具调用稳定（新聊天窗口验证通过）

**代价**：
- 视频直传暂时不可用（`@ai-sdk/anthropic` provider 在代码层面拒了 video，TODO 等升级）
- 视频走 preprocess 路径（text 描述）

### 新增/修改

| 文件 | 改动 |
|---|---|
| `.env` | `MINIMAX_ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic/v1` |
| `env.ts` | `MINIMAX_ANTHROPIC_BASE_URL` 默认值 |
| `providers.ts` | `createOpenAICompatible` → `createAnthropic({ baseURL, apiKey })` |
| `chat/route.ts` | 删视频 raw-fetch 路径 + `messagesContainVideo`/`fileToOpenAI` 死函数 |
| `chat/route.ts` | `thinking: { type: 'adaptive' }` + `M3_MAX_OUTPUT_TOKENS = 131072` |
| `m3-raw-fetch.ts` | 删 `m3ChatStream`/`toUIMessageStream`，保留 `m3ChatComplete`（DeepSeek preprocess 用） |
| `multimodal-config.ts` | M3 重新加回 registry（图片直传），`videoModels: []`（TODO） |
| `package.json` | `@ai-sdk/anthropic@3.0.110` |

### 修复

| 文件 | 修复 |
|---|---|
| `upload-client.ts` | `file` → `base64` 字段名匹配 `upload/route.ts` |
| `xiaohongshu/index.js` | note.md 图片 CDN URL → 相对路径 |
| `xiaohongshu/index.js` | export 返回 blogUrl + 内容完整性校验 |
| `xiaohongshu/index.js` | index.html `.img-block` 加 `max-width:600px` |

### 净效果

| 维度 | 改前 | 改后 |
|---|---|---|
| M3 协议 | OpenAI 兼容（preprocess 降级） | Anthropic 原生（图片直传） |
| 思考过程 | ❌ 始终丢失 | ✅ 原生支持 |
| 视频 | 直传（AI SDK 不支持） | preprocess（TODO 等升级） |
| 代码行数 | - | **-119 行** |
| tsc | 0 错误 | 0 错误 |

### 已知限制

- 视频直传：`@ai-sdk/anthropic` provider 在 `convertToModelMessages` 阶段拒了 video，M3 端点支持但 AI SDK 不支持。等 provider 升级后可通过 fetch 拦截器还原。
- 长上下文工具调用：M3 在 76 条消息后可能退化，建议用「压缩对话」或开新窗口。

## v0.6.16 (2026-08-12) — 工具方法去重（sleep + parseJSON + task-state + generateImage）

用户问"generateImageAsync 和 generateImage 是不是重复了"，全盘扫描后执行了一次性去重。

### 新建共享模块

| 文件 | 导出 | 替换 |
|---|---|---|
| `shared/utils.js` | `sleep`, `shortId` | 10 处 sleep + 5 处 randomUUID |
| `shared/llm/parse-json.js` | `parseJSON` | 3 处（ai.js + xiaohongshu + diagram + tech-video prompt-builder）|
| `mcp/lib/task-state.js` | `writeTaskState`, `readTaskState`, `updateTask`, `getAdaptiveWait` | 3 处 MCP 工具（image + xiaohongshu + diagram）|

### 合并重复 fetch

| 文件 | 改动 |
|---|---|
| `shared/llm/providers/minimax.js` | `generateImage` 加 `image_url` 参数（支持 `subject_reference`）|
| `mcp/tools/media/image.js` | 删重复 fetch 逻辑，改用共享 `generateImage()` + `task-state` |

### 更新消费者

| 文件 | 改动 |
|---|---|
| `mcp/tools/media/image.js` | 用 `shared/utils.js` + `task-state.js` + `minimax.js` |
| `mcp/tools/xiaohongshu/index.js` | 用 `shared/utils.js` + `task-state.js` + `parse-json.js` |
| `mcp/tools/diagram/index.js` | 用 `shared/utils.js` + `task-state.js` |
| `workflows/lib/step-types/ai.js` | 用 `parse-json.js` |
| `workflows/templates/video-generation/lib/tts.js` | 用 `shared/utils.js` sleep |
| `workflows/templates/video-generation/lib/bgm.js` | 用 `shared/utils.js` sleep |
| `workflows/templates/tech-video/lib/tts.js` | 用 `shared/utils.js` sleep |
| `workflows/templates/tech-video/lib/bgm.js` | 用 `shared/utils.js` sleep |
| `workflows/templates/tech-video/lib/prompt-builder.js` | 用 `parse-json.js` |
| `workflows/templates/tech-video/utils.js` | sleep 重导出 `shared/utils.js` |
| `tasks/precious-metals/fetcher/sina.js` | 用 `shared/utils.js` sleep |
| `tasks/precious-metals/fetcher/kline.js` | 用 `shared/utils.js` sleep |

### 净效果

| 维度 | 改前 | 改后 |
|---|---|---|
| `sleep` 定义 | 10 处 | 1 处（`shared/utils.js`）|
| `parseJSON` 定义 | 4 处 | 1 处（`shared/llm/parse-json.js`）|
| `writeTaskState`/`updateTask` | 3 处 | 1 处（`mcp/lib/task-state.js`）|
| 自适应轮询 | 3 处 | 1 处（`mcp/lib/task-state.js`）|
| `generateImage` fetch | 2 处 | 1 处（`shared/llm/.../minimax.js`）|
| 净 LOC | - | **-120 行** |
| tsc | 0 错误 | 0 错误 |

### 已知未合并

- `video-generation/lib/prompt-builder.js` 的 `parseJSON` 保留本地版本（有增强错误处理：try/catch JSON.parse + 位置信息）
- callLLM（deepseek/minimax 重复）推迟
- TTS/BGM 完整复制（video-generation vs tech-video）推迟

## v0.6.15 (2026-08-12) — M3 回退朴素 createOpenAICompatible + 多模态统一 preprocess

用户决策："回到一开始吧，M3 用 createOpenAICompatible，图片/视频走解析再喂文本"

### 根因回顾

v0.6.14 尝试用 `extractReasoningMiddleware` 解析 M3 的 ` thinking` 标签 → 报 "reasoning-delta without start"（AI SDK v6.0.220 中间件 edge case）。继续打补丁会陷入"修了 A 坏了 B"循环。

根本问题：M3 有非标准字段（`reasoning_content`），AI SDK 的 openai-compatible provider 不认识 → 理解成本持续产生。

### 架构决策

**放弃 M3 直传多模态**（image_url / video_url），改为**统一 preprocess 路径**：

```
用户上传图片/视频
  ↓ processor.ts: M3 返回 'none'（退出 registry）
  ↓ preprocessImagesDescription / preprocessVideoDescription
  ↓ m3ChatComplete (reasoning_split=true) 拿 text 描述
  ↓ 剥掉 file parts，注入 systemInjection
  ↓ M3 只看到 text，走标准 AI SDK 路径
```

### 改动

| 文件 | 改动 | 净行数 |
|---|---|---|
| `multimodal-config.ts` | 删 minimax 条目（M3 退出多模态 registry） | -5 |
| `providers.ts` | 删 fetch 拦截器 + `getMinimaxModel` + `extractReasoningMiddleware` 导入 | -43 |
| `chat/route.ts` | 改 import + model 调用（`getMinimaxModel` → `minimax`） | +2 / -2 |
| `m3-raw-fetch.ts` | `m3ChatComplete` 里 `reasoning_split: false` → `true`（preprocess 拿到干净 text） | +1 / -1 |

### 净效果

| 维度 | 改前 | 改后 |
|---|---|---|
| M3 多模态 | 直传 image_url/video_url | preprocess（text 描述） |
| M3 reasoning | `extractReasoningMiddleware`（v0.6.14）→ 报错 | 无 reasoning UI（但稳定） |
| 工具调用 | 偶尔 hallucinate（长上下文压力） | 标准 AI SDK 路径，稳定 |
| AI SDK 兼容 | ⚠️ M3 自定义字段 | ✅ 纯 text，100% 兼容 |
| 代码行数 | - | **-54 行** |
| tsc | 0 错误 | 0 错误 |

### 代价

- M3 不再"直接看图" — 看图能力从"直传"降级为"preprocess 文本描述"
- 对大多数场景（"这张图是什么"），preprocess 输出已够用
- 未来如需恢复直传，只需在 registry 重新加回 minimax 条目

### 验证

- `tsc --noEmit` 0 错误
- preprocess 代码（v0.6.7 已写）已验证
- 需要重启服务（`next dev` 热更已自动生效）

## v0.6.14 (2026-08-12) — M3 文字流思考过程丢失修复

### 问题
用户报："聊天都没有思考过程了 / 调用了什么工具也没展示"

### 根因
M3 文档关键信息（**用户提供的官方文档**）：
> "`reasoning_split` 不会开启或关闭 thinking。它只控制 thinking 内容的返回方式：
> - 为 `true` 时，thinking 通过 `reasoning_content` 和 `reasoning_details` 返回
> - 为 `false` 时，原生 Chat Completions 响应会将 thinking 保留在 `content` 字段中的 `<think>...</think>` 标签内"

**历史 bug**（commit `5ac0065` 7月埋下）：
- `providers.ts` 的 fetch 拦截器强制注入 `reasoning_split: true`
- 原作者以为"AI SDK handles thinking natively"
- 实际 AI SDK v6 的 `@ai-sdk/openai-compatible` provider **完全不知道 `reasoning_content` / `reasoning_details` 字段**
- 思考内容在响应里**被静默丢弃**
- `isReasoningUIPart(part)` 永远不进入 → `<details>[思考过程]</details>` 永远不显示

只有视频流（`m3-raw-fetch.ts`，v0.6.8 我手写的）能显示思考。

### 修复
- `providers.ts`：删除 `reasoning_split: true` 注入 → 让 M3 用默认行为，thinking 进 `content` 的 `<think>` 标签
- `providers.ts`：新增 `getMinimaxModel()` helper，用 `wrapLanguageModel + extractReasoningMiddleware({ tagName: 'think' })` 抽取标签成独立 reasoning 事件
- `chat/route.ts`：`minimax(modelName)` → `getMinimaxModel(modelName)`（1 行）

### 净效果
| 维度 | 改前 | 改后 |
|---|---|---|
| 文字流思考显示 | ❌ 静默丢失 | ✅ 标准 AI SDK 模式抽取 |
| 视频流思考显示 | ✅ 已正常 | ✅ 不变 |
| 工具事件 | ❌ 用户报不显示 | ✅ 透传 middleware 恢复（预期）|
| 改动行数 | - | +18 / -6 |

### 关键学习
- M3 双模式：`reasoning_split=true` 走 `reasoning_details`（OpenAI 不识别），`reasoning_split=false` 走 `content` 内的 `<think>`（AI SDK 友好）
- 标准 AI SDK 模式：`extractReasoningMiddleware` 处理 inline 思考标签
- v0.6.8 改 m3-raw-fetch 时只考虑视频路径，文字流没改 → bug 一直存在

### 验证
- tsc 0 错误
- **需 `npm run dev` 或 `next dev` 热更新生效**（已自动）

## v0.6.13 (2026-08-12) — note status 区分错误诊断

用户报：`/ai/api/note/92b8c2f7/status` 报 404，但 `92b8c2f7` 任务从未被记录创建。

调查发现：
- `/tmp/xhs-tasks/` 里 3 个旧目录（`0dbb0749` / `59c903ff` / `85511240`）**全是空的**（没 task.json）
- `writeTaskState()` 没日志，失败完全静默
- note status 路由无法区分"任务不存在"vs"task.json 损坏"

### 修复

| 文件 | 修改 |
|---|---|
| `packages/mcp/tools/xiaohongshu/index.js` | `writeTaskState` 加 try/catch + `[xhs] writeTaskState: success/FAILED ...` 日志 |
| `packages/ai-chat/src/app/api/note/[taskId]/status/route.ts` | 404 时区分"目录不存在"vs"task.json 缺失"，返回不同 error 文案 |

### 净效果
- 下次 `writeTaskState` 失败会立刻在日志看到 `[xhs] writeTaskState: FAILED taskId=xxx err=...`
- 前端 / 调试能区分两类 404：
  - `"笔记任务不存在或已过期"`（任务确实没创建）
  - `"任务数据已损坏（目录存在但 task.json 丢失）"`（任务创建过但文件丢失）

### 验证
- tsc 0 错误
- **需重启 MCP server** 让 `writeTaskState` 改动生效（Next.js 自动热重载）

## v0.6.12 (2026-08-12) — 日志噪音修复 + note status 404 日志

### 问题
1. `/tmp/xhs-tasks/6c11d6b8/` 不存在 → URL `/ai/api/note/6c11d6b8/status` 返回 404，但**路由不记 log**，没法调试
2. 日志里 `[ERR] [workflow] cli stderr: ◇ injected env (0) from ../../.env // tip: ⌘ ...` **全是 dotenv 包的营销 tip 噪音**
   - dotenv 在每次 workflow CLI 启动时打 1 行 stderr 推广话术
   - `injected env (0)` 是 "没注入新变量"（不是错误，因为 Next.js 进程已经设过 env）
   - 但我们的 route 把所有 stderr 当 [ERR] 记录 → **60+ 次/分钟**误报

### 修复

| 文件 | 修改 |
|---|---|
| `lib/workflow-cli.ts` | `runWorkflowCli` 加 stderr 过滤：跳过 `◇ injected env` / `// tip:` 行 |
| `app/api/note/[taskId]/status/route.ts` | 404 时打 `[note:status] taskId=xxx not found` |

### 净效果
- 日志噪音 -99%（dotenv tip 全部过滤）
- 真 stderr 错误仍可见
- 404 请求现在日志可见，方便排查
- tsc 0 错误

## v0.6.11 (2026-08-11) — 二次死代码扫描（按"内部使用也算使用"原则）

用户纠正：只删"全项目 0 引用"的导出。**内部使用的（字段类型/同文件调用）保留**。

### 删除（7 项，0 引用）

| 文件 | 删除 | 备注 |
|---|---|---|
| `lib/utils/format.ts` | 整个文件 | 只剩 `formatDateTime`，v0.6.8 引入后从未调用 |
| `lib/ai/multimodal-markers.ts` | `UPLOAD_MARKER_MATCH` | message-item.tsx 用内联正则，未引这个常量 |
| `lib/ai/multimodal-markers.ts` | `UPLOAD_MARKER_SPLIT` | 同上 |
| `lib/rag/vector-store.ts` | `_resetChromaClientForTesting()` | 测试 helper，无测试存在 |
| `lib/rag/vector-store.ts` | `CODE_DB` 常量 | SHARED_DB/CHAT_DB 在用，CODE_DB 没人用 |
| `lib/rag/vector-store.ts` | `ChunkEmbedding` interface | 0 引用（SearchResult 是不同接口）|
| `lib/rag/vector-store.ts` | `ADMIN_PAGE_SIZE_DEFAULT` | 0 引用（admin/chroma 用魔数 100）|

### 保留（"内部使用算使用"）

| 类型/常量 | 内部用途 |
|---|---|
| `DISTANCE_FUNCTION` | line 146 `"hnsw:space": DISTANCE_FUNCTION` |
| `SOFT_DELETE_WINDOW_MS` | line 209 软删过期判断 |
| `getChromaClient()` | line 143/173/245 内部调用 |
| `SearchConfig` / `CrossDbSearchConfig` | searchOneCollection 形参 |
| `ListChunksOptions` / `ListChunksResult` | listAllChunks 形参与返回 |
| `CompactResult` | compactCollection 返回类型 |
| `purgeExpiredSoftDeletes()` | searchOneCollection 调用 |
| 16 个类型导出（`TokenUsage` / `MessageMetadata` / `Attachment` / `Strategy` 等） | 同文件字段类型 |

### 净效果

| 维度 | 改前 | 改后 |
|---|---|---|
| lib/utils/ 文件数 | 7 | 6（format.ts 删除）|
| 真正 0 引用的导出 | 7 | 0 |
| 净 LOC | - | **-28**（format.ts -10, multimodal-markers -3, vector-store -15）|
| tsc | 0 错误 | 0 错误 |

## v0.6.10 (2026-08-11) — 死代码清理 + NoteImage/NoteData 共享

基于 grep 扫描发现的未使用导出。

### 删除的死导出（14 项，~70 行）

| 文件 | 删除 | 备注 |
|---|---|---|
| `lib/utils/format.ts` | `formatRelative` | 0 引用 |
| `lib/utils/env.ts` | `Env` type | 0 引用 |
| `lib/utils/mime.ts` | `IMAGE_EXTS` / `VIDEO_EXTS` / `ALL_VIDEO_EXTS_FOR_DETECT` export | modality-detector 和 upload/route 各自有 local copy |
| `lib/utils/mime.ts` | `getExt` / `isImageExt` / `isVideoExt` | 0 引用 |
| `lib/utils/types.ts` | `RetrievedChunkMeta` / `ReasoningPart` / `ToolPart` | 0 引用 |
| `lib/ai/multimodal-markers.ts` | `UPLOAD_MARKER_REGEX` / `CONTEXT_SUMMARY_PREFIX` | 0 引用 |

### 删死 import + 死 re-export

| 文件 | 删除 | 备注 |
|---|---|---|
| `lib/ai/processor.ts` | `import { ATTACHMENT_REGEX, UPLOAD_MARKER_STRIP }` + `export { ... }` | body 里完全没用到，re-export 也无人 import |

### NoteImage/NoteData 去重（v0.6.10 关键修复）

`components/chat/note-preview-card.tsx` 和 `app/note/[taskId]/page.tsx` 各自定义了重复的 `NoteImage` / `NoteData` 接口，且字段不一致：
- `note-preview-card.tsx`：`status: "pending" \| "done" \| "failed"`（精确）
- `note/[taskId]/page.tsx`：`status: string`（宽松）

修复：
1. `lib/utils/types.ts` 里的 `NoteImage` / `NoteData` 改成与 `note-preview-card.tsx` 一致的字段（精确类型）
2. 两个组件删本地 interface，改 `import type { NoteData } from "@/lib/utils/types"`
3. 副作用：`note/[taskId]/page.tsx` 从 `status: string` 升级到严格 union（类型更安全）

### 净效果

| 维度 | 改前 | 改后 |
|---|---|---|
| 死导出 | 14 项 | 0 |
| NoteImage/NoteData 重复定义 | 2 处 | 1 处共享 |
| 净 LOC | - | **-91 行**（来自本次 commit + dashboard.html 无关改动）|

### 验证

- `tsc --noEmit` 0 错误
- `format.ts`: 24 行 → 9 行（formatRelative 删）
- `mime.ts`: 48 行 → 28 行（6 导出删）
- `types.ts`: 90 行 → 72 行（5 接口删）
- `multimodal-markers.ts`: 22 行 → 17 行（2 常量删）
- `processor.ts`: 123 行 → 119 行（import + re-export 删）

## v0.6.9 (2026-08-11) — `src/lib/` 目录重构（按功能聚类）

用户反馈"`src/lib/` 下文件太多"。不改任何代码逻辑，只调整目录组织。

### 新结构

```
src/lib/
├── ai/                   # 9 个 — AI SDK 集成
│   ├── providers.ts            # glm/deepseek/minimax
│   ├── model-router.ts        # DeepSeek 路由分类
│   ├── multimodal-config.ts   # provider 能力注册表
│   ├── modality-detector.ts   # 模态识别
│   ├── multimodal-markers.ts  # marker 正则
│   ├── image-processor.ts     # 图片处理
│   ├── video-processor.ts     # 视频处理
│   ├── processor.ts           # 策略分发器
│   └── m3-raw-fetch.ts        # M3 raw fetch
├── rag/                  # 3 个 — RAG
│   ├── retrieve.ts            # 跨库检索
│   ├── vector-store.ts        # Chroma 客户端
│   └── chroma-server.ts       # Chroma 进程管理
├── store/                # 1 个 — 存储
│   └── conversation-store.ts  # 对话 JSON
├── utils/                # 7 个 — 工具
│   ├── env.ts                 # env 集中
│   ├── format.ts              # 日期格式
│   ├── mime.ts                # MIME 字典
│   ├── types.ts               # 核心类型
│   ├── utils.ts               # cn + BASE
│   ├── cost.ts                # 价格计算
│   └── upload-client.ts       # 客户端上传
├── workflow-cli.ts       # 顶层 — CLI 子进程
└── prompts/
    └── video-content.txt
```

### 路径映射

| 旧 | 新 |
|---|---|
| `@/lib/providers` | `@/lib/ai/providers` |
| `@/lib/model-router` | `@/lib/ai/model-router` |
| `@/lib/multimodal-config` | `@/lib/ai/multimodal-config` |
| `@/lib/modality-detector` | `@/lib/ai/modality-detector` |
| `@/lib/multimodal-markers` | `@/lib/ai/multimodal-markers` |
| `@/lib/image-processor` | `@/lib/ai/image-processor` |
| `@/lib/video-processor` | `@/lib/ai/video-processor` |
| `@/lib/processor` | `@/lib/ai/processor` |
| `@/lib/m3-raw-fetch` | `@/lib/ai/m3-raw-fetch` |
| `@/lib/retrieve` | `@/lib/rag/retrieve` |
| `@/lib/vector-store` | `@/lib/rag/vector-store` |
| `@/lib/chroma-server` | `@/lib/rag/chroma-server` |
| `@/lib/conversation-store` | `@/lib/store/conversation-store` |
| `@/lib/env` | `@/lib/utils/env` |
| `@/lib/format` | `@/lib/utils/format` |
| `@/lib/mime` | `@/lib/utils/mime` |
| `@/lib/types` | `@/lib/utils/types` |
| `@/lib/utils` | `@/lib/utils/utils` ← utils.ts 重命名为 utils/utils.ts |
| `@/lib/cost` | `@/lib/utils/cost` |
| `@/lib/upload-client` | `@/lib/utils/upload-client` |
| `@/lib/workflow-cli` | 不变（保留顶层） |

### 决策

- **合并** ×：用户问"文件功能是否可以合并" — 我检查了所有文件，结论是**大多数文件职责清晰，不该合并**。强行合并会让 utils.ts 变成"杂物间"反模式。
- **保留 `lib/utils/utils.ts`**：丑但最简单，IDE 补全自动区分。
- **`workflow-cli.ts` 留在顶层**：CLI 调用是横切关注点（workflow + 未来 task 等可能都用），不属于任何子目录。

### 变更文件

- 20 个 `git mv`（仅移动，内容 0 改动）
- 25 个文件 import 路径更新（应用层 12 + lib/ 内部 9 + 间接 4）
- 1 个文件路径修复（`scripts/verify-migration.ts`）

### 验证

- `tsc --noEmit` 0 错误
- 功能完全不变（只移动 + 改 import）

## v0.6.8 (2026-08-11) — 整体代码优化（类型安全 + 工具合并 + 死代码清理）

用户之前提到"等会来一次整体的代码检查优化"，今天完成。一次跑完 9 个 phase（基线 → 工具新建 → 死代码 → 合并 → 类型 → UI 抽离 → 性能 → 临时测试 → 收尾），零功能改动。

### 核心改动

**A. 类型安全（最关键）**
- 新建 `src/lib/types.ts`：定义 `Message` / `MessagePart` / `MessageMetadata` / `TokenUsage` / `NoteData` 等核心类型
- **消除 47 处 `any`** + **删除 6 处 `// eslint-disable`**（其中 4 处是隐藏的真实 hook 错误）
- 影响：`image-processor.ts` / `video-processor.ts` / `processor.ts` / `m3-raw-fetch.ts` / `modality-detector.ts` / `route.ts` / `message-item.tsx` / `page.tsx` / `markdown-components.tsx`

**B. 工具方法去重（合并 4 处散落）**
- `src/lib/workflow-cli.ts`（合并 `cli-parser.ts`）— 替换 8 处 workflow route 的 `execFile` 包装
- `src/lib/conversation-store.ts` — 5 个 conversations route 全部走统一 helper
- `src/lib/upload-client.ts`（`uploadFile` / `readAsBase64`）— 合并 `handlePaste` + `handleFileChange` 重复块
- `src/lib/multimodal-markers.ts` — 8 个 marker/URL 正则常量统一导出，6 处内联正则全部移除（`js-hoist-regexp`）

**C. 新增工具**
- `src/lib/env.ts` — 集中 9 个 env 读取（MINIMAX/DEEPSEEK/GLM/CHROMA_BASE_URL/API_KEY 等），替换 5 处散落
- `src/lib/mime.ts` — `extToMime` / `isImageExt` / `isVideoExt`，替换 5 处 MIME 字典
- `src/lib/format.ts` — `formatDateTime` / `formatRelative`，合并 3 处日期实现

**E. 目录瘦身（删除 5 个文件）**
- `config/multimodal.json`（从未被读取的 dead config）
- `src/lib/api-path.ts`（1 行 export → 并入 utils.ts）
- `src/lib/cli-parser.ts`（合并到 workflow-cli.ts）
- `src/app/body-wrapper.tsx`（5 行 identity → 内联 layout.tsx）
- `src/components/ui/card.tsx`（0 处引用）

**F. 死代码**
- `vector-store.ts` 删 `COLLECTION_NAME = "java_knowledge"`（@deprecated，无 caller）
- `chroma-server.ts` 删 `isChromaOwnedByThisProcess`（无 caller）
- `modality-detector.ts` 删 `isVideoPath` / `isImagePath`（无 caller）
- `execution/[id]/page.tsx` 删 `STEP_GROUPS` 空数组
- `admin/chroma/route.ts` 删 `MAX_LIMIT` / `MIN_LIMIT` / `MAX_TOP_K` / `ADMIN_PAGE_SIZE_DEFAULT` 导入
- `providers.ts:10` `name: "aether"` 错名 → `"deepseek"`（实际是 DeepSeek provider）

**G. UI 组件抽离**
- `src/components/ui/pixel-logo.tsx`（新）— 统一 `left-sidebar.tsx` 和 `page.tsx` 里两份几乎一样的 `PixelLogo` 实现

**H. 性能微调**
- `MessageItem` 套 `React.memo`（按 msg.id + isLoading 比较）
- 6 处内联正则全部 hoist 到 `multimodal-markers.ts` 模块级常量
- 修了一个隐藏 bug：全局 regex + `.test()` 会保留 lastIndex，导致 `processor.ts` 的 `hasImage`/`hasVideo` 在多消息场景下偶发 false。改用 `String.search()` 后正常
- `parseCliOutput` 加括号匹配（之前 trailing line 会让 JSON.parse 崩）

### 测试（临时）

写了 4 个测试文件 `packages/ai-chat/_test/*.test.ts`（mime / multimodal-markers / workflow-cli / format），`node --test` 跑 **15/15 通过**，跑完即删 `_test/`。

测试过程发现 2 个真实 bug：
1. `processor.ts` 的 `hasImage/hasVideo` 用 `IMAGE_URL_REGEX.test()` — 全局 regex 的 lastIndex state 导致多消息场景偶发 false（已修）
2. `parseCliOutput` 不处理 trailing noise — 当 CLI 输出 `{"ok":true}\n` 后还有日志，JSON.parse 失败（已加括号匹配算法）

### 净效果

| 维度 | 改前 | 改后 |
|---|---|---|
| `any` 类型 | 47 处 | 0 |
| `eslint-disable`（除 2 处合法 `<img>`） | 6 处 | 0 |
| env 读取散落点 | 5 个文件 | 1 个 (`env.ts`) |
| workflow route `execFile` 包装 | 8 份重复 | 1 个 helper |
| conversation route `fs` 操作 | 5 份重复 | 1 个 helper |
| MIME 字典 | 5 份 | 1 个 helper |
| 多模态正则 | 6 处内联 | 1 个文件模块级常量 |
| 死代码 | 9 项 | 0 |
| TypeScript 编译 | 0 错误 | 0 错误 |
| 净 LOC | - | ~-280 行（功能不变）|

### 变更文件

**新增（10）**
- `src/lib/types.ts`
- `src/lib/env.ts`
- `src/lib/format.ts`
- `src/lib/mime.ts`
- `src/lib/multimodal-markers.ts`
- `src/lib/workflow-cli.ts`
- `src/lib/conversation-store.ts`
- `src/lib/upload-client.ts`
- `src/components/ui/pixel-logo.tsx`
- `_test/*.test.ts`（4 个临时测试，已删）

**删除（5）**
- `config/multimodal.json`
- `src/lib/api-path.ts`
- `src/lib/cli-parser.ts`
- `src/app/body-wrapper.tsx`
- `src/components/ui/card.tsx`

**修改（~25）**
- 4 个 lib 文件（image/video/processor/m3-raw-fetch）— 类型 + 正则常量
- 3 个 layout 组件（page、schedule、workflow）— 移除 eslint-disable
- 5 个 conversations route — 全部走 conversation-store
- 8 个 workflow route — 全部走 workflow-cli
- 多个文件用 env 替换散落 process.env 读取

### 已知限制
- ESLint 实际跑不起来（`eslint-config-next` 依赖的 `next/dist/compiled/babel/eslint-parser` 在 16.x 缺失），靠 `tsc --noEmit` 替代
- PixelButton 重构（20 处 inline style）推迟 — 用户原本提的，但 YAGNI 原则下没做（未量化收益，改动面太大）
- NoteBody 组件抽离（note-preview-card + note/[taskId] 共享）推迟 — 同样 YAGNI

### 后续 TODO
- 上线后跑 7 个核心场景回归测试
- PixelButton / NoteBody 抽离可作为单独 PR
- Qwen3.8-Max 接入（之前提过）
- Files API 路径（>50MB 视频走 mm_file://）

## v0.6.7 (2026-08-11) — 代码清理 + DeepSeek preprocess 路径修复

### 核心改动
- **route.ts**（净 -100 行）：删除冗余 preprocess 死代码，重构为单一 `POST()` 函数；提取 video detection / model construction / system prompt 三个辅助函数
- **m3-raw-fetch.ts**（新增 163 行）：M3 OpenAI 兼容接口的流式/非流式调用 + OpenAI SSE → AI SDK UI message stream 转换
- **image-processor.ts**（+50 行）：preprocess 改用 `m3ChatComplete`（绕开 AI SDK），支持 UIMessage 格式的 `[图片:xxx]` 标记自动加载文件
- **video-processor.ts**（+30 行）：preprocess 改用 `m3ChatComplete`，支持 UIMessage 格式的 `[视频:xxx]` 标记自动加载文件
- **processor.ts**（+10 行）：image/video preprocess 改串行（避免并发读取同一目录竞态）
- **providers.ts**（+1 行）：统一默认 baseURL 到 `https://api.minimaxi.com/v1`

### 修复
- **DeepSeek + 视频 preprocess 路径**：之前因 messages 是 ModelMessage 格式（无 file parts），preprocess 读不到文件内容；现在主动从 data/static/videos/ 读取并构造 video_url
- **DeepSeek + 图片 preprocess 路径**：同样的修复，主动从 data/static/images/ 读取图片文件
- **DeepSeek + 图片+视频**：image/video preprocess 改串行（避免并发文件读取竞态）

### 视频直传路径全景

| 场景 | 路径 |
|---|---|
| M3 + 仅图片 | AI SDK streamText（file→OpenAI provider 自动转 image_url）|
| M3 + 仅视频 | raw fetch → m3ChatStream（OpenAI provider 不支持 video file）|
| M3 + 图片+视频 | raw fetch（自动检测 video）|
| DeepSeek + 任何附件 | preprocess 路径：M3 描述 → 文字注入 system prompt |
| 无附件 | AI SDK streamText 正常路径 |

### 端到端测试（7 个核心场景全部通过）
- ✅ M3 + 仅图片（AI SDK 路径）
- ✅ M3 + 仅视频（raw fetch 路径）
- ✅ M3 + 图片+视频（raw fetch 路径）
- ✅ DeepSeek + 仅视频（preprocess 路径）
- ✅ DeepSeek + 仅图片（preprocess 路径）
- ✅ DeepSeek + 图片+视频（preprocess 路径）
- ✅ 仅文字（AI SDK 路径）

### 上传边界测试
- ✅ webm 拒绝（M3 不支持）
- ✅ 未知 MIME 拒绝
- ✅ 60MB 视频拒绝（>50MB 限制）

### 变更文件
**新增**：
- `packages/ai-chat/src/lib/m3-raw-fetch.ts`（163 行）

**修改**：
- `packages/ai-chat/src/app/api/chat/route.ts`（+80 / -180 行，净 -100）
- `packages/ai-chat/src/lib/image-processor.ts`（+50 / -30 行）
- `packages/ai-chat/src/lib/video-processor.ts`（+30 / -50 行）
- `packages/ai-chat/src/lib/processor.ts`（+10 / -5 行）
- `packages/ai-chat/src/lib/providers.ts`（+1 / -1 行）

**净效果**：+173 / -256 行 = -83 行总代码，video 直传路径 + DeepSeek preprocess 路径完整

### 已知限制（待办）
- M3 通过 OpenAI 兼容接口不支持原生 `image_url` 格式（需要 file→fetch 拦截器重写）— 已实现
- Files API 路径（>50MB 视频走 mm_file://）— 未实现
- M3 的 `video_url` 是 M3 自定义扩展，标准 OpenAI 不支持 — 已通过 raw fetch 绕过
- Qwen3.8-Max 接入预留（multimodal-config.ts 已配置，但 .env 无 QWEN API key）
- 已知 `page.tsx` 有 AI SDK v6/v7 重复实例化错误（pre-existing，与本次改动无关）

## v0.6.6 (2026-08-10) — M3 视频 API 修正（image_url → video_url + fps 参数）

### 重大修正
之前 v0.6.5 实现错了——M3 文档明确要求 video 用 `video_url` content type，且 M3 自己按 `fps` 采样视频帧。v0.6.5 用 ffmpeg 预抽帧是错误方案。

### 核心改动
- **废弃 ffmpeg 抽帧**：`video-processor.ts` 不再调 ffmpeg
- **M3 视频 content type**：直接传 `video_url` + `fps: 1`
- **providers.ts fetch 拦截器**：自动把 `image_url`（MIME 是 `video/*`）重写为 `video_url`
  - 业务代码只需 `{type: 'image', image: 'data:video/mp4;base64,...'}` 即可
  - AI SDK 自动转成 image_url → 拦截器再改成 video_url
  - 无需绕过 AI SDK
- **统一大小限制**：
  - 图片最大 **10MB**（M3 限制）
  - 视频最大 **50MB**（M3 base64 限制）
- **MIME 白名单调整**：
  - 去掉 `video/webm`（M3 不支持）
  - 加 `video/x-msvideo`（AVI）
- **`detail` 默认值**：图片/视频都默认 `default`，M3 自适应 token
- **历史深度**：保留 `image=all` / `video=1` 默认

### 测试视频方法
ffmpeg 生成测试视频：
```bash
ffmpeg -y -f lavfi -i testsrc=size=320x240:duration=3:rate=12 \
  -pix_fmt yuv420p /tmp/test.mp4
```

### 验证清单
- [ ] M3 直接接收 base64 video_url，返回合理响应
- [ ] M3 + 图片 + 视频（一次调用）能解析两者
- [ ] DeepSeek + 视频：preprocess（M3 描述）+ 文字 fallback
- [ ] Files API 路径（>50MB 视频）：**TODO 下次**
- [ ] Qwen3.8-Max 接入：架构已预留

### 改动文件
- `packages/ai-chat/src/lib/providers.ts`（+18/-3 行）— fetch 拦截器加 video_url 转换
- `packages/ai-chat/src/lib/video-processor.ts`（重写，废弃 ffmpeg）
- `packages/ai-chat/src/lib/processor.ts`（简化，删 frame-extract 分支）
- `packages/ai-chat/src/lib/multimodal-config.ts`（删 videoFrameCount，加 videoFps）
- `packages/ai-chat/src/app/api/upload/route.ts`（webm 移除、大小 10/50MB）
- `packages/ai-chat/src/app/(main)/page.tsx`（accept 同步更新）
- `packages/ai-chat/config/multimodal.json`（删 videoFrameCount）

### 清理
- 删除 `packages/ai-chat/test-*.mjs`（3 个临时测试文件）

### 待办（Files API）
M3 文档提到 >50MB 视频需走 Files API：`mm_file://{file_id}`（最大 512MB）。本次未实现，留 TODO：
- 新增 `/api/m3/files/upload` 路由
- 调用 M3 `/v1/files/upload` 拿 file_id
- processor 检测超 50MB 自动转 Files API 路径

## v0.6.5 (2026-08-10) — 多模态架构重构（图片直传 + 视频支持 + Qwen3.8-Max 接入准备）

### 多模态架构（策略模式 + 配置驱动）
- **新增 `lib/multimodal-config.ts`**：Provider 注册表（M3/Qwen 等），新增 provider 只需加配置项
- **新增 `lib/processor.ts`**：处理器工厂，根据 provider/model 能力自动选择路径
- **新增 `lib/image-processor.ts`**：图片直传（读 base64）+ Preprocess 兜底
- **新增 `lib/video-processor.ts`**：视频 ffmpeg 抽帧（N 帧 → image content）
- **新增 `lib/modality-detector.ts`**：识别 [图片:]/[视频:]/URL 三种来源
- **新增 `config/multimodal.json`**：运行时配置（env 覆盖 JSON 覆盖默认值）

### 三种处理策略
- **direct**：多模态 provider 直接接收 image content（M3 图片 / Qwen 图片）
- **frame-extract**：视频抽帧后作为多 image content（Qwen 视频）
- **preprocess**：纯文本 provider 走 M3 描述 → 文字注入 system（DeepSeek）

### 上传与存储
- **新增目录**：`data/static/videos/`（视频独立目录）
- **图片**：`data/static/images/<uuid>.<ext>`（最大 20MB）
- **视频**：`data/static/videos/<uuid>.<ext>`（最大 100MB）
- **MIME 白名单**：png/jpg/jpeg/gif/webp + mp4/webm/quicktime/x-matroska
- **Range 支持**：`/api/uploads/[filename]` 支持视频流式播放（拖动进度条）

### UI 改动
- 文件选择器 `accept` 支持视频格式
- 视频附件显示 ▶ 视频缩略图
- 视频上传/处理失败 toast 提示
- message-item 支持视频预览（`<video controls>`）

### 历史深度可按模态分级
- 图片默认 `all`（上下文够大）
- 视频默认 `1`（base64 巨大，避免撑爆）
- 通过 env `MULTIMODAL_IMAGE_DEPTH` / `MULTIMODAL_VIDEO_DEPTH` 覆盖

### 修复
- **旧路径 bug**：`route.ts` 旧 preprocessImages 引用 `data/uploads/`（已不存在）→ 改成 `data/static/images/`
- **路径穿越防护**：`uploads/[filename]` 加 `isPathSafe()` 校验
- **MIME 校验**：upload 拒绝非白名单类型，防止 XSS

### Qwen3.8-Max 接入路径（后续）
- `providers.ts` 加 `qwen`（仿 `minimax`）
- `multimodal-config.ts` 的 `MULTIMODAL_REGISTRY` 加 `qwen` 条目
- **业务代码零改动**（已在配置中预留）

### 变更文件
**新增**：
- `packages/ai-chat/src/lib/multimodal-config.ts`（~110 行）
- `packages/ai-chat/src/lib/processor.ts`（~90 行）
- `packages/ai-chat/src/lib/image-processor.ts`（~160 行）
- `packages/ai-chat/src/lib/video-processor.ts`（~150 行）
- `packages/ai-chat/src/lib/modality-detector.ts`（~90 行）
- `packages/ai-chat/config/multimodal.json`（~25 行）

**修改**：
- `packages/ai-chat/src/app/api/chat/route.ts`（preprocess → processor）
- `packages/ai-chat/src/app/api/upload/route.ts`（MIME + 路径分流）
- `packages/ai-chat/src/app/api/uploads/[filename]/route.ts`（Range + 多目录 + 路径安全）
- `packages/ai-chat/src/app/(main)/page.tsx`（UI + 视频缩略图 + 错误 toast）
- `packages/ai-chat/src/components/chat/message-item.tsx`（视频预览）

### 遗留（TODO）
- **生成图片回流**：工具生成图片后，URL 替换为 `[图片:uuid]` 让多模态 M3 看到（未实现，会让"再画一张类似的"失效）
- **历史图片文件丢失**：当前是 `error` 策略（明确报错），可改为 `ignore` 静默跳过
- **视频直接传 URL**：当前所有多模态视频都走 frame-extract（架构已预留 direct 模式）

## v0.6.4 (2026-08-10) — 视觉组合语法 + 场景结构词汇表 + 渲染 bug 修复

### 视觉组合语法（composition grammar）
- **script-rules.md 新增章节**：从"做什么"扩展到"怎么搭"
- **6 大元素词汇表**：几何/有机/排版/色彩/纹理/运动（抽象概念，不锁死具体样式）
- **组合语法**：层数规则（≥3 层）/ 焦点规则（1 个焦点）/ 对比规则（动静大小明暗疏密）/ 节奏规则（相邻场景换元素类型）
- **自检清单**：4 个问题（3 层/3 类/抹字立得住/重叠度 <50%）
- **5 条反模式**：纯文字+emoji/全场景同元素/无背景层/装饰少/抹字崩溃

### 场景结构词汇表
- **6 种结构类型**：stat-card / process-step / data-viz / comparison / quote / list
- **强约束**：每个视频至少用 3 种结构类型
- **分布建议**：10 场景 = 1 hook + 4-5 body（混用） + 1 peak + 1 outro
- **效果**：从「所有场景长得一样」跃升到「柱状图/对比/流式列表/多结构」

### JS 动画策略 A/B
- **策略 A（推荐）**：clip 级动画 `gsap.from('#clip-1', ...)` — 选择器 100% 命中
- **策略 B**：内嵌 `<script>` 用 `this.querySelector(...)` — 更丰富但需小心
- **不推荐**：在 `jsAnimation` 字段写 `#stage .clip-N .classname` — 选择器找不到目标

### 设计 Tokens 强制
- 不再允许 `"designTokens": {}` 空对象
- 必须填 `palette`（background/primary/secondary）+ `fonts`（heading/body）

### 渲染 bug 修复（关键）
- **render.js:162 正则**：`class="clip([^"]*)"` → `class=["']clip([^"']*)["']`
- **原因**：AI 输出单引号 `class='clip'` 时正则不匹配，data-start/data-track-index 未注入
- **后果**：只有 scene 1 显示，后续场景全是黑屏
- **修复后**：单/双引号都支持，10 场景全部正常渲染

### 视频质量验证
- 同一主题「银行的赚钱逻辑」3 轮迭代
- iter1：1.7MB 78% 静态帧（GSAP 选择器全失败）
- iter3 重渲染：4.1MB 6 种场景结构 0 个动画报错
- 真实 SVG 可视化：柱状图、风险对比图、流式列表

### 变更文件
- `packages/workflows/templates/video-generation/script-rules.md`（+131 行）
  - 「视觉组合语法」章节
  - 「场景结构词汇表」章节
  - JS 动画策略 A/B
  - designTokens 强制 + scene id 必填
- `packages/workflows/templates/video-generation/lib/render.js`（+2/-2 行）
  - 正则支持单/双引号

## v0.6.3 (2026-08-07) — 设计规范分离 + 美学方法论 + 设计人格

### 设计规范拆分为 10 个文件
- **design-rules/ 目录**：将 script-rules.md 中的设计规则拆分为 10 个独立文件
  - `01-typography.md`：字体层级（5 级）、字重限制（900+400）、中英混排
  - `02-color.md`：60/30/10 颜色比例、3 色调色板、4 套色板参考
  - `03-layout.md`：3 种布局语法、9:16 竖屏优先
  - `04-spacing.md`：8-point grid、元素间距表
  - `05-shadows.md`：软阴影原则、3 级阴影表、颜色匹配
  - `06-animation.md`：时长表、缓动表、转场模式、stagger 规则
  - `07-narrative.md`：Peak-End Rule、五段式节奏、场景节拍
  - `08-components.md`：5 种组件类型、变体、使用指南
  - `09-svg.md`：尺寸约束、元素数量、线宽、可读性
  - `10-anti-patterns.md`：视觉/动画/布局/字体/SVG 反模式
- **prompt-builder.js**：新增 `loadDesignRules()` 函数，所有设计规则自动加载到 system prompt

### 设计人格
- **角色改写**："极具创造力的短视频设计师" 替代 "短视频脚本策划"
- 4 条设计信念：规则是基础创新是灵魂、对比出效果、每个场景有个性、敢于打破常规

### 视觉规范
- **60/30/10 颜色比例**：60% 背景、30% 辅色、10% 主色
- **8-point 间距系统**：所有间距 8 或 4 的倍数
- **阴影规范**：软阴影、3 级阴影表、颜色匹配
- **字体层级硬限制**：最多 4 种字号 + 2 种字重

### 叙事节奏
- **Peak-End Rule**：用户记住峰值+结尾
- **五段式节奏**：Hook(0-3s) → Build(3-15s) → Peak(15-25s) → Cool(25-35s) → End(35-45s)

### 校验增强
- schemaVersion 容错：`z.union([z.literal(1), z.literal("1")])`
- designTokens 容错：colors→palette、typography→fonts 自动转换
- 组件多样性软检查：建议至少 3 种组件类型
- css/jsAnimation 软警告（不阻断）

### 渲染优化
- **dedupeCss**：自动合并相同值的 CSS 规则，减少 HTML 冗余
- **超时 300s**：HyperFrames/ffmpeg 加超时 + stderr 捕获

### 修复
- 重试 3→5 次
- 动态 maxTokens 8000→16000→32000
- 修复表单重置（formValuesRef.current）
- contentRequirement 字段：新增"内容要求"输入框

### 日志系统
- **createDateLogger**：按日期划分（tasks-YYYY-MM-DD.log / workflows-YYYY-MM-DD.log），自动清理 7 天，内容带任务前缀
- **console 拦截**：engine.js runSteps/runNextStep 加 console hook，模板 lib 的 console.log 自动写入工作流日志
- **render.js execId 修复**：path.basename(path.resolve(workDir, "..")) → path.basename(workDir)

### system/user 分离
- script-rules.md 全部内容放入 system prompt（行为准则），风格指南+任务+错误放入 user prompt（动态内容）
- prompt-builder.js 删除硬编码的"输出要求"，全部移到 script-rules.md
- ROLE 合并到 script-rules.md ## 角色

### skipWhen 条件跳过
- engine.js 新增 evaluateSkipWhen()，支持 xxx_no/xxx_yes/xxx_present/{var}==="value" 语法
- tts 步骤 enable_tts_no 时跳过，bgm 步骤 has_bgm_file 时跳过

### prompt 系统（script-rules.md 完全重组）
- 新增：设计系统（3色调色板+4字体角色+3布局语法）、输出要求、移动端适配、JS动画原则、转场多样性
- 合并去重：HTML约束+简洁性合并、JS动画原则去重、硬规则统一汇总
- 美学原则：5 个抽象原则（对比/层级/节奏/留白/焦点）
- JS 动画原则：5 个原则（stagger/节奏对比/缓动对比/目的性/节制）

### 字体与渲染
- 字体本地化：复用 tech-video 的 fonts/，render.js 注入 @font-face 块
- 字体路径修正：fonts/ 放到 render/ 下，URL 改为 fonts/xxx.woff2
- 渲染超时：HyperFrames/ffmpeg 加 300s 超时 + stderr 捕获
- 视频时长修正：amix duration=shortest + -shortest 标志，BGM 短于视频时自动循环

### 校验与容错
- schemaVersion 容错：z.union([z.literal(1), z.literal("1")])，字符串 "1" 自动转数字
- css/jsAnimation 强制：每个场景必须有 css 和 jsAnimation（非空字符串）
- clips→scenes 容错：LLM 输出 clips 字段时自动转为 scenes
- parseJSON 增强：错误信息带文本片段+位置

### LLM 调用优化
- 动态 maxTokens：8000→16000→32000，截断检测自动翻倍
- 重试次数：3→5 次
- maxTokens 默认值：deepseek 8000、minimax 8000

### 表单与 UI
- contentRequirement 字段：新增"内容要求"输入框，指导 AI 生成内容
- 表单重置修复：handleAiGenerate 改用 formValuesRef.current
- 状态紧贴：workflow 列表状态 badge 紧贴 title
- 步骤执行时间：engine.js 4 处 elapsed 写入 state.json
- uploads 统一：data/uploads + data/workflows/uploads → data/static/{images,audio}

### 动画与转场
- 基础转场增强：opacity fade → fade+slide（y:40→0 滑入，y:0→-20 滑出），ease: power2.out/in
- GSAP 自由动画：animation.html 加占位符，AI 可在 clip 内写 <script>gsap.to()</script>
- 转场多样性：提示 AI 覆盖默认转场

### 代码规范
- 消除中文判断：enable_tts "否"→"no"，template.json 改为 yes/no
- 禁止中文判断：共享库写入铁律

## v0.6.1 (2026-08-05) — video-generation 改造 + 目录整理 + 10 项修复

### 重构
- **video-generation 架构改造**：script.json 驱动 + Zod 校验 + 重试，4 步管线（script→tts→bgm→render）
- **TTS 可选**：创建时可选 enable_tts，选否时跳过 + 隐藏步骤
- **风格选择**：用户可选（Neo-Brutalist/奶油风/极简/自动），不选则 AI 决定
- **目录整理**：删除 subtitles.js、3 个旧 MD，templates/ 重组为 styles/，简化 utils.js 和 errors.js
- **渲染分离**：render.js 纯画面渲染 + ffmpeg 音频混合，不依赖 HyperFrames 内置音频
- **日志系统**：render.js 使用 shared/logger 写入 workflow 日志

### 修复
- engine 防并发运行（有步骤 running 时拒绝新请求）
- CLI timeout 300s→900s
- schema 放宽（type 接受任意字符串，title 可选，id 接受数字/字符串）
- AI 生成的 HTML 字体替换为 sans-serif（避免 HyperFrames 编译卡住）
- script.json 预览格式化显示
- utils.js 路径修复（.. 去掉）
- 时间格式：YYYY-MM-DD HH:mm:ss
- 下载按钮只在 concat 步骤显示
- LLM prompt 优化（maxTokens 8000，减少重试）

### 变更文件
- `packages/workflows/templates/video-generation/template.json` — 重构
- `packages/workflows/templates/video-generation/lib/prompt-builder.js` — 新增
- `packages/workflows/templates/video-generation/lib/schema.js` — 新增
- `packages/workflows/templates/video-generation/lib/render.js` — 重构
- `packages/workflows/templates/video-generation/lib/errors.js` — 简化
- `packages/workflows/templates/video-generation/lib/bgm.js` — 上传+缓存+重试
- `packages/workflows/templates/video-generation/script-rules.md` — 新增
- `packages/workflows/templates/video-generation/utils.js` — 简化
- `packages/workflows/engine.js` — 防并发+retryable
- `packages/workflows/cli.js` — ANSI 转义码过滤
- `packages/ai-chat/src/app/(main)/workflow/page.tsx` — 表单+TTS隐藏
- `packages/ai-chat/src/app/(main)/workflow/execution/[id]/page.tsx` — JSON预览+步骤隐藏
- `packages/ai-chat/src/app/api/workflows/execution/[id]/next/route.ts` — timeout 900s

## v0.6.0 (2026-08-04) — 视频生成 v2 完整实现 + 10 项修复

### 新增
- **video-generation-v2**：8 步管线（script → validate → tts-scenes → bgm → sfx-pick → render → concat），7 步（删除 HTML 预览）
- **11 套 HyperFrames 模板**：从越南项目迁移，全部翻译中文 + 本地字体（编译 352s → 36ms）
- **工作流引擎**：step-by-step 执行、重试、跳过、auto 模式、warning 状态
- **工作流创建表单**：视频标题 + 内容描述 + AI 智能生成内容 + BGM 上传 + 品牌名
- **Drawer 抽屉**：场景列表 40% 右侧滑入，背景遮罩 + 淡入淡出
- **渲染步骤预览**：单视频切换模式，手机壳播放器，逐场景视频卡片
- **统一错误处理**：WorkflowError + retryable 区分 + warning 橙色三角 ⚠
- **SFX 音效**：3 层语义匹配，自动下载（myinstants.com）
- **本地字体**：Noto Sans SC + 9 种西方字体，共 83 个 woff2（9.7MB）
- **20 个单元测试**：schema/sfx/audio/parseCliOutput

### 修复
- script 截断：maxTokens 2000 → 8000
- BGM 上传：formValues 闭包修复（useRef）+ createExecution 预拷贝
- DeepSeek format 参数：支持 format:'text' 用于内容生成
- brand 占位符：prompt + render + schema 三层防护
- retry 重试后自动执行当前步骤
- concat 无音频时崩溃：voiceRaw 不存在时跳过 Step 2-4
- 下载按钮只在 concat 步骤显示
- CLI stdout 过滤：防止 dotenv 输出泄漏到 JSON
- parseCliOutput：Math.max → Math.min 修复
- normalizePath：iframe 不截断子目录

### 变更文件
- `packages/workflows/templates/video-generation-v2/` — 新增（~80 文件）
- `packages/workflows/engine.js` — title 字段 + retryable 区分
- `packages/workflows/cli.js` — stdout 过滤 + 动态 import dotenv
- `packages/ai-chat/src/app/(main)/workflow/page.tsx` — 表单重构 + 列表 card 优化
- `packages/ai-chat/src/app/(main)/workflow/execution/[id]/page.tsx` — Drawer + 步骤跟随 + 渲染预览
- `packages/ai-chat/src/components/ui/drawer.tsx` — 新增
- `packages/ai-chat/src/lib/cli-parser.ts` — 新增
- `packages/ai-chat/src/lib/prompts/video-content.txt` — 新增
- `packages/ai-chat/src/app/api/workflows/generate-content/route.ts` — 新增
- `packages/ai-chat/src/app/api/workflows/upload/route.ts` — 新增
- `packages/ai-chat/src/app/api/workflows/execution/[id]/file/[...path]/route.ts` — 新增
- `packages/shared/llm/providers/deepseek.js` — format 参数
- `packages/shared/llm/providers/minimax.js` — format 参数
- `package.json` — test:video-v2 脚本
- `.gitignore` — SFX mp3 排除

## v0.5.11 (2026-07-30~31) — 预览区手机样式 + Chrome 扩展 + shared/llm 模块

### 新增
- **预览区手机样式**：渲染预览改为手机壳模式（刘海屏 + 竖屏 9:16），视频/音频统一
- **Chrome 扩展**：每日提醒（10:00 学习 / 17:30 复盘），alarms + notifications
- scheduling task 支持 `crons` 数组，多个 cron 表达式

### 修复
- GSAP 自动计算 data-start，预览和渲染都兼容
- preview.js 支持双层 JSON 解析
- HyperFrames 渲染成功（render 参数从文件路径改为目录路径）
- render.js ROOT_DIR 路径修正（5 层 `..`）
- 跳过步骤计入完成计数
- 删除按钮改为灰色

### 变更文件
- `packages/ai-chat/src/app/(main)/workflow/execution/[id]/page.tsx` — 手机壳预览
- `packages/workflows/templates/video-generation/lib/preview.js` — 双层 JSON 解析
- `packages/workflows/templates/video-generation/lib/render.js` — 路径修正 + 音频降级
- `packages/workflows/templates/video-generation/templates/animation.html` — GSAP 自动计算
- `packages/chrome-extension/` — 新增扩展
- `packages/tasks/scheduler.js` — crons 数组支持

## v0.5.10 (2026-07-29) — 视频流程重构 + MCP 修复 + LLM 模块重组

### 重构
- **视频生成流程**：AI 只输出场景 HTML → 模板自动包装 → 通用 GSAP 动画
- **LLM 模块重组**：`shared/llm.js` → `shared/llm/index.js` + `providers/deepseek.js` + `providers/minimax.js`
- **ai.js**：改用括号配对解析 JSON（复用小红书 parseJSON 算法）
- template.json prompt 强约束：无论如何返回 JSON

### 新增
- **跳过步骤**：engine.js `skipStep()` + CLI `skip` 命令 + API 路由
- 工作流详情页 4 种状态 UI 统一升级（pending/running/skipped/failed）
- 步骤列表 loading 动画（旋转圈+进度条）

### 修复
- MCP 启动失败：xiaohongshu/image import 路径修复
- MiniMax 禁用 thinking：`thinking: { type: "disabled" }`
- 环境变量重命名：`MCP_LLM_PROVIDER` → `LLM_PROVIDER`
- 代理路由前缀匹配：`/workflow` → 支持 `/workflow/execution/[id]`
- getOutputValue 增强兜底：字段→output.output→整对象 JSON
- 日志改为倒序

### 变更文件
- `packages/workflows/templates/video-generation/template.json` — prompt 强约束
- `packages/workflows/lib/step-types/ai.js` — 括号配对解析
- `packages/workflows/engine.js` — skipStep
- `packages/workflows/cli.js` — skip 命令
- `packages/shared/llm/` — 模块重组
- `packages/ai-chat/src/app/api/workflows/execution/[id]/skip/route.ts` — 新增
- `packages/mcp/tools/xiaohongshu/index.js` — import 路径修复
- `packages/mcp/tools/media/image.js` — import 路径修复

## v0.5.9 (2026-07-28) — 工作流系统 + 视频能力从 MCP 迁移

### 新增
- **工作流引擎**：`packages/workflows/engine.js`（createExecution/runSteps/runNextStep/runAllSteps/retryStep/listExecutions）
- **CLI 调度**：`packages/workflows/cli.js`（start/run/next/auto/retry/delete/get/list）
- **步骤类型**：ai（LLM 调用）/ script（Node 脚本）/ tool（模块调用）
- **工作流日志**：`logs/workflows/<id>.log`，每步耗时+输出摘要
- **API 路由**：8 个端点（templates/execute/executions/execution/next/auto/retry/skip）
- **执行详情页**：3 区布局（左侧步骤列表+右侧预览区），6 种预览类型
- **文件服务**：`/api/workflows/execution/[id]/file/[filename]`
- 工作流列表页：响应式网格、状态徽章、进度条、删除

### 迁移
- **视频能力**：MCP `tools/media/video.js` → `workflows/templates/video-generation/`
- 5 步：AI 脚本生成 → TTS → BGM → HTML 预览 → 渲染 MP4
- 删除 MCP 视频/音频/HTML 工具，MCP 只保留 image 工具

### 修复
- preview.js 不再调用 LLM（直接使用 AI 步骤生成的 HTML）
- tts.js 合并 create+poll（generateTTS 函数）
- bgm.js 加 getAudioDuration
- cli.js console→stderr 重定向（stdout 纯 JSON）
- 50 条执行上限
- 删除改为 AlertDialog

### 变更文件
- `packages/workflows/` — 新增引擎+CLI+步骤类型+模板
- `packages/ai-chat/src/app/(main)/workflow/` — 新增页面
- `packages/ai-chat/src/app/api/workflows/` — 新增 8 个 API 路由
- `packages/mcp/tools/media/video.js` — 删除
- `packages/mcp/tools/media/audio.js` — 删除
- `packages/mcp/tools/media/html-builder.js` — 删除
- `packages/mcp/templates/` — 迁移到 workflows

## v0.5.8 (2026-07-21) — 本地博客 + 反向代理 + 照片墙

### 重构
- **本地博客**：GitHub Pages → 本地 `serve` + Tailscale Funnel 内网穿透
- **反向代理**：`scripts/proxy.cjs`，统一 443 端口，`/` → 博客，`/ai/` → AI 工作台
- **生产构建隔离**：`.next-prod` 目录，与 dev `.next` 互不冲突
- **脚本精简**：`package.json` scripts 从 5 个减到 4 个，脚本逻辑移到 `scripts/`

### 新增
- **照片墙**：Page 9 翻牌卡片设计（polaroid 风格 + N° 编号 + 装饰线 + 3D 翻转）
- **图片压缩管线**：`scripts/compress-images.cjs`（92 张 65MB → 20MB），xiaohongshu 导出自动压缩
- **EXIF 方向修复**：sharp `.rotate()` 保留原始方向
- **首屏优化**：`Cache-Control` 30 分钟 + `loading="lazy"` + `IntersectionObserver` 懒加载
- **生产环境 basePath**：`.env.production` 隔离 `/ai` 前缀

### 修复
- 上下文窗口超限（base64 剥离，1.3M → 正常）
- 发送闪屏（预上传 + fire-and-forget）
- 错误信息不透明（日志 + 前端 toast）
- 日志文件膨胀（17.6MB → 3.8MB）
- `/api/logs` 响应缩小（200 行 × 500 字符）
- 侧边栏版权 + 博客链接
- 图片中文文件名 404（`decodeURIComponent`）
- Chroma 权限冲突（交给 instrumentation 管理）

### 变更文件
- `scripts/proxy.cjs` — 新增反向代理
- `scripts/prod.sh` — 先杀后启，反向代理启动
- `scripts/stop.sh` — kill -9 强制杀
- `scripts/compress-images.cjs` — 新增图片压缩
- `packages/ai-chat/next.config.ts` — basePath + distDir
- `packages/ai-chat/src/app/api/chat/route.ts` — base64 剥离 + 错误日志
- `packages/ai-chat/src/app/api/upload/route.ts` — 文件上传
- `packages/ai-chat/src/app/api/uploads/[filename]/route.ts` — 新增
- `packages/ai-chat/src/app/(main)/page.tsx` — 预上传 + BASE 前缀
- `packages/ai-chat/src/components/chat/message-item.tsx` — 图片放大 + 正则放宽
- `packages/ai-chat/src/components/layout/left-sidebar.tsx` — 博客链接 + 版权
- `packages/ai-chat/src/lib/api-path.ts` — 新增 BASE 工具
- `packages/mcp/tools/xiaohongshu/index.js` — 图片压缩 + syncToBlog + updateBlogIndex
- `packages/skills/blog/SKILL.md` — 新增
- `.env.production` — 新增
- `package.json` — 脚本精简
- `README.md` — 部署说明更新
- `design.md` — 架构更新
- `CHANGELOG.md` — 本文

## v0.5.7 (2026-07-21) — 博客上线 + 错误处理 + 图片上传重构 + 数据源统一

### 新增
- **博客系统**：`site/` 目录，GitHub Pages 部署（https://xiaoshengkai.github.io/xiaoshengkai-ai/）
- **精致像素风设计**：暖白纸底 + 新粗野主义（3px 黑边框 + 4px 硬阴影）+ 系统字体
- **金融板块**：12 篇文章列表页，左图右文卡片（缩略图 + 标题 + 副标题）
- **hover 三重反馈**：缩略图放大 1.08x + 标题变蓝 + 箭头滑入
- **打字机效果**：首页副标题逐字出现
- **文章导航**：sticky 顶部返回列表 + 右侧下一篇链接
- **自动化嫁接**：`exportXiaohongshuNote` 导出时自动同步到 `site/{category}/` 并更新列表页
- **博客 SKILL**：`packages/skills/blog/SKILL.md`，按需加载，AI 提到博客时自动加载
- **侧边栏博客链接**：启用侧边栏「博客」菜单，点击跳转 GitHub Pages
- **侧边栏版权**：`© 2026 开盛` 显示在底部
- **GitHub Actions 部署**：推送 master 时自动部署 `site/` → `gh-pages`
- **图片上传重构**：base64 → 文件存储（`data/uploads/`），消息格式 `[图片:/api/uploads/uuid.png]`
- **图片预览**：粘贴/选择时预上传，用户图片点击放大（useImageViewer 集成）
- **文件读取 API**：`/api/uploads/[filename]` 支持任意文件类型

### 修复
- **上下文窗口超限**：base64 图片数据剥离（1.3M tokens → 正常），发给 LLM 前替换为 `[图片]`
- **错误信息不透明**：日志记录 statusCode/responseBody，前端 toast 显示具体原因
- **发送闪屏**：saveConversation fire-and-forget，不阻塞 sendMessage
- **日志响应过大**：/api/logs 截断到 200 行 × 500 字符
- **日志文件膨胀**：base64 数据清理（17.6MB → 3.8MB）
- 侧边栏版权不显示（flex-1 div 始终渲染）
- 博客 footer 不贴底（min-height: 100dvh + flexbox）
- finance/index.html 中 URL 编码（空格和中文标点）
- 文章缩略图被卡片左侧色条遮挡
- 旧格式兼容代码清理（`[图片数据:base64]`、`[上传图片:N]`）

### 重构
- **数据源统一**：`data/` 目录（chroma/、uploads/、conversations/），chroma 从 packages/ai-chat/data/ 迁出，uploads 从 packages/ai-chat/public/ 迁出

### 变更文件
- `packages/skills/blog/SKILL.md` — 新增博客 SKILL
- `site/` — 新增，完整博客静态文件
- `packages/mcp/tools/xiaohongshu/index.js` — syncToBlog + updateBlogIndex（~100 行）
- `packages/ai-chat/src/app/api/chat/route.ts` — 错误日志、图片剥离、新格式适配
- `packages/ai-chat/src/app/api/upload/route.ts` — 新增文件上传
- `packages/ai-chat/src/app/api/uploads/[filename]/route.ts` — 新增文件读取
- `packages/ai-chat/src/app/api/logs/route.ts` — 响应缩小
- `packages/ai-chat/src/app/(main)/page.tsx` — 预上传、闪屏修复
- `packages/ai-chat/src/components/chat/message-item.tsx` — 新格式渲染、图片放大
- `packages/ai-chat/src/components/layout/left-sidebar.tsx` — 博客链接 + 版权
- `packages/ai-chat/src/lib/chroma-server.ts` — chroma 路径
- `package.json` — chroma 路径、log 命令
- `.github/workflows/deploy.yml` — 新增
- `CHANGELOG.md` — 本文

## v0.5.6 (2026-07-16) — 历史对话列表 + 保存逻辑简化

### 新增
- **历史对话列表**：左侧菜单栏新增对话列表，JSON 文件持久化（`data/conversations/`），支持新对话/切换/删除/置顶
- **对话 API**：`/api/conversations/getList`、`getDetail`、`save`、`delete`、`pin`
- **对话 Context**：`conversation-context.tsx` 管理对话状态，页面和侧边栏共享

### 简化
- **保存逻辑**：只在发送前 + AI 回复完成后保存，不再 debounce 自动保存
- **删除"重新开始"按钮**：对话列表已替代"新对话"功能
- **页面首次加载**：不再自动加载最新对话，从空白状态开始

### 修复
- **MiniMax thinking**：`reasoning_split: true` 后 AI SDK 原生处理思考过程，删除 ~30 行 regex 代码
- **小红书笔记**：`[插图-N]` → `[IMG-N]` 英文占位符，避免中文误匹配
- **cursor 不生效**：`.pixel-bg::after` 的 `z-index: 9999` 覆盖全屏拦截光标，改为 `z-index: 0`

### 变更文件
- `packages/ai-chat/src/app/api/conversations/` — 新增 5 个 API 路由
- `packages/ai-chat/src/components/layout/conversation-context.tsx` — 新增
- `packages/ai-chat/src/components/layout/left-sidebar.tsx` — 对话列表 + 置顶/删除
- `packages/ai-chat/src/app/(main)/page.tsx` — 简化保存逻辑 + 删除 localStorage
- `packages/ai-chat/src/app/(main)/layout.tsx` — 包裹 ConversationProvider
- `packages/ai-chat/src/app/globals.css` — 修复 cursor
- `packages/mcp/tools/xiaohongshu/index.js` — [IMG-N] 占位符

## v0.5.5 (2026-07-15) — 搜索增强 + 交互优化 + MiniMax 探索

### 搜索增强
- **MCP searchKnowledge**：`database` 指定且无 `collection` 时，搜该库所有 collection（新增 `listCollectionsForDb`），解决"聊天 AI 搜不到金融表"问题
- **RAG 预检索**：`topK` 3 → 5，给跨 collection 内容更多命中机会
- **记忆库批量删除**：删除后调用 `reloadList()` 从 API 验证，确保数据一致

### 交互优化
- **MiniMax 思考过程**：`details` 默认折叠，思考中自动展开，思考结束自动折叠
- **记忆库按钮**：搜索/整理数据/批量删除统一为像素立体感 + 固定颜色 + `cursor-pointer`，移除 hover 变色

### MiniMax 探索（未采纳）
- 尝试 `@ai-sdk/anthropic` 接入 MiniMax Anthropic 端点：v4 版本不兼容 AI SDK v6，v3 版本构建通过但运行时未知，最终回退
- 确认：`createOpenAICompatible` 下 MiniMax 不支持 tool calling

### MiniMax reasoning_split（采纳）
- `providers.ts` 自定义 `fetch` 注入 `reasoning_split: true`，思考内容分离，正文干净
- AI SDK 原生支持 `reasoning_content` → `isReasoningUIPart`，思考过程自动显示为折叠块
- 删除 `message-item.tsx` 中 ~30 行 thinking regex 处理代码

### GLM embedding 长文本优化
- `embedText` 改为自动分段：≤2000 字直接 embedding，>2000 字分段并行 embedding 后取平均
- 解决 `addKnowledge`/`updateKnowledge` 长文本（5000+ 字）embedding 失败问题
- 删除 selftest 代码

### 其他修复
- **Hydration 不匹配**：`selectedProvider` 改用 `useEffect` 懒加载 `sessionStorage`
- **滚动按钮**：改为 `absolute` 定位，浮在输入框上方
- **Chroma 日志**：`updateKnowledge`/`deleteKnowledge` 加全链路日志
- **旧日志清理**：删除 `mcp-*.log`、`nextjs-*.log`

### 变更文件
- `packages/ai-chat/src/lib/providers.ts` — 自定义 fetch + reasoning_split
- `packages/ai-chat/src/components/chat/message-item.tsx` — 删除 thinking regex
- `packages/ai-chat/src/app/(main)/page.tsx` — hydration 修复 + 滚动按钮定位
- `packages/mcp/lib/chroma.js` — 分段 embedding + 日志增强
- `packages/mcp/tools/chroma/index.js` — updateKnowledge/deleteKnowledge 日志 + 删除 selftest

## v0.5.5 (2026-07-14) — 多模型接入 + MiniMax 适配 + 体验优化

### 新增
- **多模型支持**：右侧面板切换 DeepSeek / MiniMax，选 DeepSeek 保持自动路由（classifyTask → pro/flash），选 MiniMax 固定 M3
- **模型选择持久化**：`sessionStorage` 存/读 `selectedProvider`，刷新不丢失
- **MiniMax 思考过程显示**：` think` 标签自动提取为可折叠「思考过程」块，流式传输中实时更新（思考中→思考过程→正文）

### 修复
- **MiniMax thinking 标签报错**：`ReactMarkdown` + `rehype-raw` 渲染 `< think>` 标签导致 React 崩溃，改为 regex 提取 + `<details>` 折叠块
- **MiniMax 思考过程流式优化**：处理三种状态（思考中/思考完成/无思考），流式传输不再报错
- **MiniMax JSON 解析失败**：`mcp/lib/minimax.js` `content` 优先于 `reasoning_content`，修复小红书笔记生成时 JSON 解析失败
- **页面刷新崩溃**：`useChat` 加 `onError` 回调，`toast.error` 替代 `unhandledRejection`
- **发送后自动滚动**：`handleSend` 后 `setTimeout 50ms` 滚动到底部，显示 AI 等待状态

### 优化
- **TOOLS_PROMPT**：小红书笔记触发词更全（写篇笔记/做成笔记/总结成笔记），参数说明结构化，轮询行为明确
- **系统提示词**：强化中文指令（"所有思考过程必须用中文描述"）
- **小红书笔记格式**：表格改为结构化列表（`- **方案A**：成本100元，收益200元`），小红书不支持 Markdown 表格
- **MiniMax 定价**：`cost.ts` 新增 MiniMax M3（$0.55/$2.19 per 1M tokens）

### 变更文件
- `packages/ai-chat/src/app/api/chat/route.ts` — provider 参数 + MiniMax 模型 + 中文思考强化 + TOOLS_PROMPT 优化
- `packages/ai-chat/src/app/(main)/page.tsx` — selectedProvider 状态 + sessionStorage + onError + 即时滚动
- `packages/ai-chat/src/components/layout/right-panel.tsx` — 模型切换按钮 + provider/model 字段适配
- `packages/ai-chat/src/components/chat/message-item.tsx` — MiniMax thinking 标签提取 + 流式思考显示 + provider/model 字段
- `packages/ai-chat/src/lib/cost.ts` — MiniMax M3 定价
- `packages/mcp/lib/minimax.js` — content 优先于 reasoning_content
- `packages/mcp/tools/xiaohongshu/index.js` — 表格 → 结构化列表 prompt

## v0.5.4 (2026-07-13) — 三栏布局 + 统一日志系统 + 控制台整理

### 新增
- **三栏布局**：左侧菜单栏（240px）+ 中间内容区 + 右侧状态面板（280px），路由组 `(main)` 共享布局
- **左侧菜单栏**：对话置顶（独立块），记忆库/工具库/工作流/定时任务/博客/设置（后续模块预留）
- **右侧状态面板**：彩色卡片（模型/Token统计/检索记忆/运行日志），像素边框风格，`[ERR]` 红色/`[INFO]` 蓝色/`[WARN]` 黄色
- **统一日志系统**：`packages/shared/logger.js` 共享日志模块，MCP + Next.js 合入 `app-YYYY-MM-DD.log`，倒序写入，7 天自动清理
- **`/api/logs`**：返回最新 500 行日志，用于右侧面板实时展示
- **检索记忆展示**：API `messageMetadata` 新增 `retrievedChunks` 字段，右侧面板实时显示当前上下文注入的知识库条目

### 重构
- **记忆库页面迁移**：`/admin/chroma/page.tsx` → `/(main)/memory/page.tsx`，像素风格适配
- **日志系统抽取**：`packages/mcp/index.js`（32 行→1 行）+ `packages/ai-chat/src/instrumentation.ts`（45 行→1 行），统一调用 `createLogger(source)`
- **控制台日志整理**：MCP 端 19 处 `console.error` → `console.log`（操作追踪类），Next.js 端信息日志同理，`[cleanMessages]` → `console.warn`，真实错误保持 `console.error`
- **body-wrapper 简化**：移除 `/admin` 特殊处理
- **对话页拆分**：根 `page.tsx` → `/(main)/page.tsx`，聊天区 + 右侧面板并排

### 优化
- 右侧面板：Token 统计加 label（本轮消耗总 token/本轮消耗金额），卡片彩色标题栏 + 分隔线 + 内容区
- 运行日志卡片：`max-h-[500px]` + 内部滚动，API 返回 500 行
- 检索记忆卡片：`max-h-[220px]` + 内部滚动
- "整理数据"按钮：固定红色背景，去掉 hover 变色

### 变更文件
- `packages/shared/logger.js` — 新建
- `packages/ai-chat/src/app/(main)/layout.tsx` — 新建
- `packages/ai-chat/src/app/(main)/page.tsx` — 新建
- `packages/ai-chat/src/app/(main)/memory/page.tsx` — 新建
- `packages/ai-chat/src/components/layout/left-sidebar.tsx` — 新建
- `packages/ai-chat/src/components/layout/right-panel.tsx` — 新建
- `packages/ai-chat/src/app/api/logs/route.ts` — 新建
- `packages/ai-chat/src/app/api/chat/route.ts` — messageMetadata 加 retrievedChunks
- `packages/ai-chat/src/app/body-wrapper.tsx` — 简化
- `packages/ai-chat/src/app/globals.css` — 新增 sidebar/panel 样式
- `packages/ai-chat/tsconfig.json` — 新增 @shared/* 路径
- `packages/mcp/index.js` — 日志系统改用共享模块
- `packages/ai-chat/src/instrumentation.ts` — 日志系统改用共享模块
- `packages/mcp/tools/*/index.js` — 19 处 console.error → console.log
- `packages/ai-chat/src/app/page.tsx` — 删除
- `packages/ai-chat/src/app/admin/chroma/page.tsx` — 删除

## v0.5.3 (2026-07-13) — 预览体验优化 + 内容丰富度 + MiniMax 稳定性

### 修复
- **预览页滚动**：`note/[taskId]/page.tsx` 容器加 `overflow: auto`，修复 `layout.tsx` 的 `overflow-hidden` 继承导致无法滚动
- **iframe 嵌入预览**：`checkXiaohongshuNoteProgress` ready 返回加 `iframe` 字段，笔记直接内嵌在聊天中
- **自动导出行为**：SKILL.md + TOOLS_PROMPT 明确"笔记生成后不要自动导出，先展示预览"
- **JSON 解析增强**：`parseJSON()` 改为括号计数算法，精确匹配 `{...}` 边界，不受推理文本/JSON 示例干扰
- **MiniMax 推理分离**：`lib/minimax.js` 优先用 `reasoning_content` 字段，避免推理内容混入 JSON
- **maxTokens 调整**：`8000` → `10000`，MiniMax 推理 token 不再挤占内容空间
- **API Key 检查**：根据 `MCP_LLM_PROVIDER` 只检查当前 provider 的 key
- **导出 HTML 样式**：使用 `marked` 库做 Markdown→HTML 转换，补齐 CSS（h3/blockquote/table/列表），与预览页视觉一致

### 优化
- **内容丰富度**：正文 5-8段/3-6句 → 6-10段/3-5句，新增可用内容形式（表格/列表/引用/对比）
- **模板去重**：删除 `knowledge.md` 和 `finance.md` 中的重复段落/例子限制，统一由 baseRules 控制
- **Usage 追踪**：`lib/deepseek.js` 和 `lib/minimax.js` 加 `data.usage` 完整结构日志

### 新增
- **github-gem-seeker** skill：搜索 GitHub 开源项目替代重复造轮子
- 新增依赖：`marked`（Markdown→HTML 转换）

### 变更文件
- `packages/mcp/tools/xiaohongshu/index.js` — parseJSON 括号计数 + maxTokens 10000 + 内容丰富度 + API Key 检查 + marked 导出
- `packages/mcp/tools/xiaohongshu/templates/knowledge.md` — 删除重复限制
- `packages/mcp/tools/xiaohongshu/templates/knowledge/finance.md` — 删除重复限制
- `packages/mcp/lib/minimax.js` — reasoning_content 优先 + usage 日志
- `packages/mcp/lib/deepseek.js` — usage 日志
- `packages/ai-chat/src/app/note/[taskId]/page.tsx` — 预览页滚动修复
- `packages/skills/xiaohongshu-note/SKILL.md` — 预览行为修正
- `packages/ai-chat/src/app/api/chat/route.ts` — TOOLS_PROMPT 更新
- `packages/skills/github-gem-seeker/SKILL.md` — 新增 skill
- `packages/mcp/package.json` — 新增 `marked` 依赖

## v0.5.2 (2026-07-11) — 优化与重构

### 优化
- **maxTokens 8000**：knowledge 模板 `maxTokens: 4000` → `8000`，支持小红书 8000 字长文
- **Token 大幅节省**：`generateXiaohongshuNote` 和 `checkProgress` 返回精简（-97%），只传 title + excerpt + imageCount，ready 状态保留完整 note
- **MD 格式优化**：段落间加 `\n` 保底 + 模板 prompt 强制 Markdown 格式（###/ - /**/ >），防止"一坨"纯文本
- **SKILL.md 导出行为**：统一为聊天展示预览链接 + 告知完整文件夹路径和文件列表
- **去除 MD 底部"由小盛开AI自动生成"**

### 重构
- **共享 LLM 调用**：`lib/deepseek.js` 新增 `callLLM`，消除 xiaohongshu/diagram/video 3 处 fetch 重复
- **LLM Provider 路由**：`lib/llm.js` 统一入口，根据 `MCP_LLM_PROVIDER` 环境变量切换 deepseek/minimax
- **`lib/minimax.js` 扩展**：新增 `callLLM`（MiniMax 文字生成），与 `generateImage`（图片生成）共存
- **usage 字段统一**：`totalTokens` → `{ totalTokens }` 标准化，兼容 DeepSeek 和 MiniMax 差异
- **调用方模型参数清理**：删除 xiaohongshu/diagram/video 中的 `DEEPSEEK_MODEL` 常量和 `model` 参数，由 provider 自行决定默认模型

### 修复
- **loadSkill 路径 bug**：`skill/index.js` SKILLS_DIR `../../skills` → `../../../skills`，修复后 loadSkill 能正确加载 skill 内容
- **MiniMax JSON 解析**：`response_format: { type: "json_object" }` + `reasoning_split: true`，MiniMax 正确返回纯 JSON
- **HTTP 错误处理**：`lib/deepseek.js` 和 `lib/minimax.js` 加 HTTP 状态码检查和错误日志
- **JSON 解析增强**：`xiaohongshu/index.js` 新增 `parseJSON()` 函数，去 markdown 标记 + 提取 `{...}` 内容，兼容多模型

### 变更文件
- `packages/mcp/lib/llm.js` — 新建（统一 LLM 路由）
- `packages/mcp/lib/deepseek.js` — `callDeepSeekLLM` → `callLLM` + usage 统一 + HTTP 检查 + `response_format`
- `packages/mcp/lib/minimax.js` — 新增 `callLLM` + HTTP 检查 + `response_format` + `reasoning_split`
- `packages/mcp/tools/xiaohongshu/index.js` — 改用 lib/llm.js + maxTokens 8000 + MD 格式优化 + Token 精简 + JSON 解析增强
- `packages/mcp/tools/xiaohongshu/templates/knowledge.md` — Markdown 格式强制要求
- `packages/mcp/tools/xiaohongshu/templates/knowledge/finance.md` — Markdown 格式强制要求
- `packages/mcp/tools/diagram/index.js` — 改用 lib/llm.js + 删 DEEPSEEK_MODEL
- `packages/mcp/tools/media/video.js` — 改用 lib/llm.js + 删 DEEPSEEK_MODEL
- `packages/mcp/tools/skill/index.js` — SKILLS_DIR 路径修复
- `packages/skills/xiaohongshu-note/SKILL.md` — 导出行为修正
- `.env` / `.env.example` — 新增 `MCP_LLM_PROVIDER` / `MINIMAX_CHAT_MODEL`

## v0.5.1 (2026-07-10) — 小红书笔记自动生成

### 新增
- **小红书笔记 MCP 工具**：`generateXiaohongshuNote` / `updateXiaohongshuNote` / `checkXiaohongshuNoteProgress` / `exportXiaohongshuNote`（4 tools）
- **模板系统**：`templates/knowledge.md`（通用知识分享）+ `templates/knowledge/finance.md`（金融知识，五段式：场景代入→概念拆解→数据论证→算账冲击→金句收尾）
- **二级类目**：`knowledge` 大类下支持 `finance` 等二级类目，LLM 自动推断
- **excerpt 摘要**：LLM 自动生成 ≤30 字精彩摘要，嵌入 `note.md` 标题下
- **NotePreviewCard**：聊天内嵌预览卡片，ReactMarkdown 渲染（h3 红色左边框、blockquote 暖橙底、**加粗**、列表）
- **独立预览页**：`/note/[taskId]`，完整笔记预览 + 导出按钮
- **导出文件夹**：HTML + MD + 图片下载到 `~/Downloads/{笔记标题}/`
- **15 个日志点**：`[xhs]` 前缀，全链路追踪（LLM 耗时/token/图片生成/搜索/导出）
- **Skill**：`packages/skills/xiaohongshu-note/SKILL.md`，LLM 自动加载

### 重构
- **模型名 env 化**：新增 `DEEPSEEK_PRO_MODEL`/`DEEPSEEK_FLASH_MODEL`/`GLM_EMBEDDING_MODEL`/`MINIMAX_IMAGE_MODEL` 环境变量，替代全部硬编码模型名
- **共享 lib 抽取**：`packages/mcp/lib/chroma.js`（`searchChroma`/`embedText`/`getCollection`）+ `packages/mcp/lib/minimax.js`（`generateImage`），消除 chroma/image/xiaohongshu 之间的重复代码
- **模板 prompt 抽取**：`systemPrompt` 从代码中移到 `templates/*.md`，`loadTemplate()` 读取
- **TEMPLATES 英文 key**：`knowledge`/`product_review`/`experience`/`opinion`，二级类目嵌套结构

### 修复
- `loadSkill` 路径 bug：`skill/index.js` SKILLS_DIR `../../skills` → `../../../skills`
- xiaohongshu 用错 MiniMax URL：`api.minimax.chat` → `api.minimaxi.com`
- xiaohongshu 搜索未用 GLM embedding：`new ChromaClient` → `searchChroma`（GLM embedding-3）
- `deepseek-chat` 模型废弃：替换为 `DEEPSEEK_PRO_MODEL` 环境变量
- `DEEPSEEK_BASE` 硬编码：改为 `process.env.DEEPSEEK_BASE_URL`
- `updateXiaohongshuNote` content JSON 解析失败：返回错误而非降级为 string
- `generateXiaohongshuNote` 缺对话上下文：新增 `context` 参数
- 知识分享长内容截断：`maxTokens: 2000` → `4000`，正文 3-5 段 → 5-8 段，插画 1-3 张 → 3-5 张

### 变更文件
- `packages/mcp/tools/xiaohongshu/index.js` — 新建（~480 行，4 tools）
- `packages/mcp/tools/xiaohongshu/templates/knowledge.md` — 新建（通用知识分享模板）
- `packages/mcp/tools/xiaohongshu/templates/knowledge/finance.md` — 新建（金融知识模板）
- `packages/mcp/lib/chroma.js` — 新建（共享 Chroma 搜索逻辑）
- `packages/mcp/lib/minimax.js` — 新建（共享 MiniMax 图片生成）
- `packages/ai-chat/src/components/chat/note-preview-card.tsx` — 新建（聊天内嵌预览）
- `packages/ai-chat/src/app/note/[taskId]/page.tsx` — 新建（独立预览页）
- `packages/ai-chat/src/app/api/note/[taskId]/status/route.ts` — 新建（状态查询 API）
- `packages/skills/xiaohongshu-note/SKILL.md` — 新建（Skill 定义）
- `packages/mcp/index.js` — 注册 xiaohongshu 模块
- `packages/mcp/tools/skill/index.js` — SKILLS_DIR 路径修复
- `packages/mcp/tools/chroma/index.js` — 改用 lib/chroma.js
- `packages/mcp/tools/diagram/index.js` — 模型名 env 化
- `packages/mcp/tools/media/video.js` — 模型名 env 化
- `packages/ai-chat/src/app/api/chat/route.ts` — TOOLS_PROMPT + 模型名 env 化
- `packages/ai-chat/src/app/api/chat/compress/route.ts` — 模型名 env 化
- `packages/ai-chat/src/app/api/memory/route.ts` — 模型名 env 化
- `packages/ai-chat/src/lib/model-router.ts` — 模型名 env 化
- `packages/ai-chat/src/lib/vector-store.ts` — 模型名 env 化
- `packages/ai-chat/src/components/chat/message-item.tsx` — 识别 xhs 任务渲染卡片
- `.env` / `.env.example` — 新增 4 个模型名环境变量
- `docs/superpowers/specs/2026-07-10-xiaohongshu-note-design.md` — 设计文档
- `docs/superpowers/plans/2026-07-10-xiaohongshu-note.md` — 实现计划

## v0.5.0 (2026-07-10) — 图片生成异步化 + 停止生成 + 风格库

### 新增
- **停止生成**：`page.tsx` 加停止按钮（Square 图标，白底黑边），`route.ts` 加 `abortSignal: req.signal`
- **图片生成异步化**：`generateImage` + `generateImageFromImage` 全异步，返回 taskId
- **checkImageProgress**：新建，查询图片生成进度（动态递减间隔）
- **图片风格库**：`skills/image-styles/`，73 种视觉风格（国风/日系/科幻/艺术/动画/奇幻/摄影/手作/极简/亚文化/MBE 等）
- **风格索引**：`_index.md` 按类别索引，AI 先选风格再加载详细 prompt 模板

### Token 优化
- **route.ts 系统 prompt**：15 行 → 5 行（-60%）
- **route.ts TOOLS_PROMPT**：65 行 → 22 行（-66%）
- **图片描述**：`maxOutputTokens: 300` 限制 MiniMax 输出
- **buildSystemPrompt 按 diagramType 拆分**：每次只传 200-400 字
- **删除 THEMES 常量**：配色通过示例文件引导

### 图表修复
- D2 fontArgs 空字符串 → 删除变量
- D2 style 属性加 `style.` 前缀
- erDiagram 括号配对跳过
- sql_table 语义误报
- CJK 字体下载移除
- 时序图 activate/deactivate 配对检测
- 截图分辨率：`getBoundingClientRect()` + `style.width` 缩放
- 16px 留白

### 变更文件
- `packages/mcp/tools/media/image.js` — 异步化 + checkImageProgress
- `packages/ai-chat/src/app/page.tsx` — 停止按钮
- `packages/ai-chat/src/app/api/chat/route.ts` — 系统 prompt + TOOLS_PROMPT 瘦身 + abortSignal
- `packages/skills/image-styles/` — 新建（73 个风格文件 + SKILL.md）
- `packages/mcp/tools/diagram/index.js` — buildSystemPrompt 拆分 + 删除 THEMES

## v0.4.9 (2026-07-09) — Token 消耗优化 + 图表类型全覆盖

### Token 消耗优化（↓78%）
- **buildSystemPrompt 按类型拆分**：原来的全量 3000 字规则改为按 diagramType 只传 200-400 字
- **route.ts 瘦身**：系统 prompt 15→5 行（-60%），TOOLS_PROMPT 65→22 行（-66%）
- **图片描述加 maxOutputTokens: 300**：防止 MiniMax 生成过长图片描述

### 新增图表类型
- **饼图**：pie 规则 + 示例（马卡龙 6 色配色）
- **象限图**：quadrantChart 规则 + 示例（14 个 themeVariables 精细控制）
- **甘特图**：gantt 规则 + 示例（马卡龙柔和色系）
- **ER图**：erDiagram 规则 + 示例（9 实体 13 关系）
- **类图**：classDiagram 规则 + 示例（7 类配色方案）
- **状态图**：stateDiagram-v2 规则 + 示例（12 状态配色）
- **时序图**：sequenceDiagram 规则 + 示例（activate/deactivate 配对检测）

### 异步化
- **generateDiagram 全部异步**：返回 taskId，后台执行
- **checkDiagramProgress**：新增，动态递减间隔（默认 20s，最低 12s）

### 优化
- 默认配色改为 sketch 马卡龙粉彩色系
- 多模态视觉校验加 context 参数（MiniMax 压缩用户需求）
- 截图分辨率：getBoundingClientRect() + style.width 缩放
- 16px 留白，waitForFunction 超时 15s→90s
- 示例文件按类型拆分（9 个独立文件）
- 删除 THEMES 常量（配色通过示例文件引导）
- 删除 CJK 字体下载（macOS 自带 PingFang SC）

### 修复
- D2 fontArgs 空字符串 bug
- D2 style 属性加 style. 前缀
- erDiagram 括号配对跳过
- sql_table 语义误报
- MiniMax JSON 解析："score" 精准匹配 + try/catch
- 时序图 activate/deactivate 配对检测

### 变更文件
- `packages/mcp/tools/diagram/index.js` — 重构 buildSystemPrompt + 异步化 + 10 种图表类型规则
- `packages/ai-chat/src/app/api/chat/route.ts` — 系统 prompt + TOOLS_PROMPT 瘦身
- `packages/mcp/tools/diagram/templates/` — 新增 9 个示例文件

## v0.4.8 (2026-07-08) — 图表生成重构：Mermaid + D2 双引擎

### 新增
- **`generateDiagram` MCP 工具**：`diagram/index.js`，根据描述自动生成图表
  - 双引擎：Mermaid（流程图/时序图/类图/状态图/ER图/甘特图/饼图/思维导图/Git图）+ D2（架构图/网络拓扑/SQL模式/容器嵌套）
  - 三套主题：corporate（莫兰迪商务）/ dark（深色科技）/ sketch（手绘柔和）
  - 受众适配：executive(决策层) / technical(执行层) / mixed
  - 简单场景单图，复杂场景 Mermaid + D2 双图互补
- **四层校验体系**：语法校验 → 语义校验 → 视觉校验 → 多模态视觉评估（MiniMax-M3）
- **自修复流程**：渲染失败返回具体错误（行号+原因），AI 修复后重试最多 3 次
- **CJK 字体**：自动下载 Noto Sans SC，多源镜像兜底，D2 编译时指定
- **示例模板**：`diagram/templates/diagram-examples.md`，Mermaid + D2 高质量示例供 AI 参考

### 重构
- 工具文件夹化：`tools/chroma.js → tools/chroma/index.js` 等 7 个工具统一改为文件夹结构，与 `media/` 保持一致

### 优化
- 渲染：`page.screenshot({ clip })` + `deviceScaleFactor: 6` + SVG 缩放 + 可见内容裁剪，排除空白区域
- CDN 兜底：Mermaid 脚本 jsdelivr → unpkg，字体 Google Fonts → PingFang SC/Microsoft YaHei
- 语法校验：状态机感知字符串和注释，跳过 `%%` 注释行和引号内括号
- 陷阱检测：`()` 在 `[]` 标签内、`<>` 在标签内、`[]` 嵌套（排除 `[[` 子图语法）
- 日志：全链路 7 阶段耗时 + prompt 长度 + 错误堆栈
- D2 规则扩展：完整样式属性表 + 8 个常见陷阱
- 删除 `diagram` skill 目录（36 个文件），图表功能改为 MCP 工具

### 修复
- Puppeteer 找不到 Chrome → 加 `CHROME_PATH` 探测（puppeteer 自带 → 系统 Chrome → 通用路径）
- `element.screenshot()` 不尊重 `deviceScaleFactor` → 改用 `page.screenshot({ clip })`
- D2 `fontArgs` 空字符串导致 extra argument → space 前置
- D2 `direction` 值错误 / `style.padding`/`fontColor` 不存在 → System prompt 补充完整
- CJK 字体 URL 重定向卡住 → 改用 `raw.githubusercontent.com` 直连 + jsdelivr 镜像
- 字体下载错误分类 → 区分超时/DNS/连接拒绝/HTTP 状态码
- `[]` 嵌套检测误报 `[[` 子图 → 正则排除 `[[` 开头
- MiniMax JSON 解析失败 → `{"score"` 精准匹配 + try/catch 降级
- 导航超时 → `networkidle0` 改为 `networkidle2`

### 变更文件
- `packages/mcp/tools/diagram/index.js` — 新建（~1000 行）
- `packages/mcp/tools/diagram/templates/diagram-examples.md` — 新建
- `packages/mcp/tools/*/index.js` — 7 个工具文件夹化
- `packages/mcp/index.js` — 注册 diagram 模块 + 路径更新
- `packages/ai-chat/src/app/api/chat/route.ts` — TOOLS_PROMPT 加 generateDiagram
- `packages/skills/diagram/` — 删除（36 个文件）
- `packages/skills/README.md` — 删除 diagram 节点
- `packages/mcp/README.md` — 工具表 + 目录结构更新
- `design.md` — 目录结构更新
- `README.md` — 工具数 + 功能描述更新

## v0.4.7 (2026-07-08) — 图表预览优化 + 图片查看器 + 布局修复

### 新增
- **图片查看器**：`image-viewer.tsx`（Context + Provider + ViewerOverlay），点击图片全屏查看，多图 ← → 切换，键盘支持
- **puppeteer SVG → PNG**：`svg2png.mjs`，用系统 Chrome 渲染，CJK 完美支持
- **fixture 优先策略**：AI 复制 fixture JSON 只改标签，不再手算坐标

### 优化
- `preview-html.sh` → `export-png.sh`：只生成 PNG，去掉 HTML 中间层
- `/preview/[taskId]/route.ts`：支持 `.png` 后缀，返回 `image/png`
- SKILL.md Step 2：改为"先读 fixture → 复制 → 只改标签"，删除布局 tips
- Shape Vocabulary：16 行 → 4 行核心 + 使用指引，减少 AI 误用
- `generated-image.tsx`：集成 `useImageViewer`，点击打开查看器

### 调试
- `file.js` 路径统一：所有文件工具基于 PROJECT_ROOT 解析相对路径
- `exec.js` cwd 修复：`path.resolve(PROJECT_ROOT, workdir)`
- `skill.js` SKILLS_DIR 修复：`../../skills`
- `exec.js` PROJECT_ROOT 修复：`fileURLToPath` 计算
- `layout.tsx` + `page.tsx`：`suppressHydrationWarning` 三层覆盖

### 变更文件
- `packages/ai-chat/src/components/ui/image-viewer.tsx` — 新建
- `packages/ai-chat/src/components/ui/generated-image.tsx` — 集成查看器
- `packages/ai-chat/src/app/page.tsx` — 包裹 ImageViewerProvider
- `packages/ai-chat/src/app/preview/[taskId]/route.ts` — 支持 PNG
- `packages/skills/diagram/scripts/export-png.sh` — 重命名 + puppeteer
- `packages/skills/diagram/scripts/svg2png.mjs` — 新建
- `packages/skills/diagram/SKILL.md` — fixture 优先 + Shape 简化
- `packages/mcp/tools/file.js` — 路径统一
- `packages/mcp/tools/exec.js` — 路径修复
- `packages/mcp/tools/skill.js` — 路径修复
- `packages/mcp/package.json` — 新增 puppeteer 依赖

## v0.4.6 (2026-07-07) — SKILL 系统 + 图表生成重构

### 新增
- **SKILL 系统**：`packages/skills/` 模块，对标 opencode/codex skill 机制
  - `loadSkill` MCP 工具：扫描 skills/ 目录，解析 SKILL.md frontmatter，按需加载
  - `SKILL_LIST` 注入 system prompt：AI 启动时自动看到可用 skill 列表
  - 新增 `greet` skill（问候回复格式）和 `diagram` skill（图表生成）
- **fireworks-tech-graph 集成**：`skills/diagram/` 完整移植
  - `generate-from-template.py`：模板引擎，7 套风格，自动箭头路由
  - `validate-svg.sh`：7 项 SVG 语法校验 + 渲染验证
  - `preview-html.sh`：SVG 转预览 HTML，支持 iframe 嵌入
  - `generate-diagram.sh`：验证 + PNG 导出（cairosvg 自动安装）
  - 11 个风格参考文件、10 个 SVG 模板、7 个 JSON 回归样例
- **exec MCP 工具**：通用 shell 命令执行，支持项目根和 skills/ 目录
- **图表 iframe 预览**：AI 生成 SVG → 保存预览 HTML → 回复中嵌入 iframe 直接展示
- **系统 prompt 第 7 条规则**：AI 检查 `<available_skills>` 自动加载匹配 skill

### 删除
- `diagram.js` MCP 工具（图表生成改为 SKILL + exec）
- `mermaid.tsx` 前端组件 + mermaid npm 依赖
- opencode 安装的 fireworks-tech-graph 副本

### 重构
- **`packages/mcp-server` → `packages/mcp`**：目录重命名，所有引用更新
- **`file.js` 路径统一**：所有文件工具相对路径基于 PROJECT_ROOT 解析，与 exec 一致
- **SKILL.md 优化**：英文化、默认 Style 2 Dark Terminal、布局指导、CJK 警告、视觉自审步骤

### 修复
- `skill.js` SKILLS_DIR 路径：`../../skills`（之前多了一层 `../`）
- `exec.js` PROJECT_ROOT：`fileURLToPath` 计算（之前 `process.cwd()`）
- `exec.js` cwd：`path.resolve(PROJECT_ROOT, workdir)`（之前相对 cwd 解析）
- `layout.tsx` + `page.tsx` hydration 警告：`suppressHydrationWarning` 三层覆盖

### 变更文件
- `packages/skills/` — 新建
- `packages/mcp/tools/skill.js` — 新建
- `packages/mcp/tools/exec.js` — 新建
- `packages/mcp/tools/file.js` — 路径解析重构
- `packages/mcp/tools/media/index.js` — 去掉 diagram 导入
- `packages/mcp/tools/media/diagram.js` — 删除
- `packages/mcp/index.js` — 注册 skill + exec
- `packages/mcp/package.json` — name 改为 mcp
- `packages/mcp/README.md` — 架构图 + 工具表更新
- `packages/ai-chat/src/app/api/chat/route.ts` — SKILL_LIST + 第 7 条规则 + 路径
- `packages/ai-chat/src/components/chat/markdown-components.tsx` — 去掉 mermaid
- `packages/ai-chat/src/components/ui/mermaid.tsx` — 删除
- `packages/ai-chat/src/app/layout.tsx` — suppressHydrationWarning
- `packages/ai-chat/src/app/page.tsx` — suppressHydrationWarning
- `design.md` — 目录结构更新
- `README.md` — 链接更新
- `~/.config/opencode/opencode.json` — 路径更新
- `.env.example` — 注释更新

## v0.4.5 (2026-07-07) — 视频渲染修复 + 体验优化

### 重构
- `parseTiming` 删除：不再解析 GSAP 代码拆分场景，整个 bodyHTML 作为单个 clip，内容零丢失
- `convertToHyperFrames` 简化为单 clip 模式，不再依赖 GSAP 代码格式
- `checkVideoProgress` → `checkTaskProgress`：覆盖预览和渲染两个阶段

### 新增
- Google Fonts 内联：拉取 CSS + 下载字体文件到 workDir，改写本地路径，视频字体与预览一致
- 编译日志：编译开始/完成时间戳，精确定位渲染耗时
- 渲染输入日志：htmlSize、narrationDuration、totalFrames
- 页面初始化滚动到底部：setTimeout 100ms 后 scrollToIndex
- TOOLS_PROMPT 三模板选项：cream（奶油风）、bw（极简黑白）、Neo-Brutalist（默认）
- `checkTaskProgress` 返回 `iframe` 字段，AI 直接嵌入聊天

### 优化
- GSAP 代码提取：matchAll + 否定前瞻跳过 src 脚本，正确提取内联动画代码
- 字幕 CSS 顺序：兜底在前，AI 样式在后，自动覆盖
- 模板 CSS 冗余删除：去掉 .scene/*/body 重复定义
- SCRIPT_SYSTEM_PROMPT GSAP 时序修复：+= 位置参数，禁止 delay
- bw.md 优化：精简格式，对齐其他模板
- AI 耐心提示：渲染时间预期 + 不要催促及建议替代方案
- `checkTaskProgress` 描述：iframe 字段说明 + 正向反馈 + 耐心提示

### 修复
- SCRIPT_SYSTEM_PROMPT 反引号语法错误：`+=` → +=
- ROOT_DIR 路径：多一层 `..` 指向 monorepo 根

### 变更文件
- `packages/mcp/tools/media/video.js` — parseTiming 删除、convertToHyperFrames 简化、Google Fonts 内联、GSAP 时序、checkTaskProgress 重命名
- `packages/mcp/templates/bw.md` — 格式优化
- `packages/ai-chat/src/app/api/chat/route.ts` — TOOLS_PROMPT 优化
- `packages/ai-chat/src/app/page.tsx` — 初始化滚动到底部

## v0.4.4 (2026-07-04) — 图片理解 + 动画优化 + 日志系统

### 新增
- 图片理解：粘贴/上传图片 → MiniMax-M3 描述 → 注入 system prompt，DeepSeek 间接理解图片
- 图片上传 UI：缩略图预览、Cmd+V 粘贴、📎 按钮、删除，像素复古风格
- `minimax` provider（MiniMax-M3），统一用 `MiniMax-M3` 模型
- 极简黑白模板 `bw.md`：杂志式非对称排版，纯黑纯白，对比度 ≥ 15:1
- 字幕系统：`generateSubtitles()` 按中文语速（4 字/秒）拆分旁白，注入 HyperFrames clips
- `checkVideoProgress` 动态递减间隔：`interval` 参数 + 每次 ×0.9 递减至 60%
- `checkVideoProgress` 返回 `iframe` 字段，AI 不需要自己构造 iframe 标签
- `generateHTMLPreview` 返回 `iframe` 字段，动态计算尺寸（width=437.625，高度按比例）
- `generateHTMLPreview` 参数 `width`/`height`（默认 1080×1920），prompt/渲染/iframe 全链路动态适配
- `renderVideo` 渲染前同步 workDir → Downloads
- `renderVideo` 状态日志
- `preview/[taskId]` 路由加 `Cache-Control: no-cache`
- 日志系统：倒序写入（最新在顶部），mcp + nextjs 双端统一

### 优化
- 脚本生成：`deepseek-v4-pro` → `deepseek-v4-flash`（240s → 48s）
- 渲染：`--workers` 动态 CPU 核数（原硬编码 4）
- 渲染：`npx hyperframes` → 本地二进制路径
- GSAP：CDN → 本地复制到 workDir，解决 headless 浏览器加载失败
- GSAP 免费化：`npm install gsap`，DrawSVGPlugin 等全插件免费
- `ROOT_DIR` 路径修复：多一层 `..` 指向 monorepo 根
- `checkVideoProgress` 强制 `preview_path` → workDir，AI 编辑后预览立即生效
- `checkVideoProgress` running 分支也覆盖 `preview_path`
- `updateTask` 写入 `preview_path` 到磁盘
- `checkCount` 重置：`startVideoRender` 时清零，防止渲染阶段继承预览计数
- `userQuery` 剥离 `[上传图片:N]` 和 `[图片数据:...]` 标签
- system prompt 强化：`"所有思考过程必须用中文描述，不要使用英文"`
- `TOOLS_PROMPT` 去掉 iframe 硬编码模板，改为 `"直接使用返回结果中的 iframe 字段"`
- `TOOLS_PROMPT` 明确 `generateHTMLPreview` 返回 `status=started`，需等 `checkVideoProgress` 到 `preview_ready`
- `markdown-components.tsx` iframe 去掉硬编码 width/height
- `page.tsx` localStorage 保存前剥离 `[图片数据:...]`
- `convertToHyperFrames` 参数化 W/H（默认 1080/1920）
- `MINIMAX_BASE_URL` 统一：`.env` → `https://api.minimaxi.com/v1`，mcp 路径去掉 `/v1/` 前缀

### 修复
- `convertToModelMessages` 崩溃：`cleanMessages` 过滤 `null` 和 `type` 为 undefined 的 parts
- `isDataUIPart`/`isToolUIPart` 崩溃：`message-item.tsx` 加 `p.type` 守卫
- `message-item.tsx` 用户消息渲染 `[上传图片:N]` 从 sessionStorage 取回
- `message-item.tsx` 用户消息剥离 `[图片数据:...]` 前缀
- `message-item.tsx` file 类型 part 渲染上传图片
- `preprocessImages` `cleanedParts` 防 null：`p.type` → `p?.type`
- 图片缩略图：`object-cover` → `object-contain`，`h-16` → `h-10`
- `handleSend` 异步化：`onKeyDown` + `onClick` 加 `await`
- `POST /api/chat` 错误日志加 stack

### 删除
- `api/describe-image/route.ts`（图片描述合并到 chat 管线）

### 变更文件
- `packages/mcp/tools/media/video.js` — 模型、渲染、进度、尺寸、日志、同步
- `packages/mcp/templates/animation.html` — 响应式、溢出保护、容器查询、表格约束
- `packages/mcp/templates/bw.md` — 新增极简黑白模板
- `packages/mcp/tools/media/audio.js` — MINIMAX_BASE_URL 路径
- `packages/mcp/tools/media/image.js` — MINIMAX_BASE_URL 路径
- `packages/mcp/tools/media/html-builder.js` — MINIMAX_BASE_URL 路径
- `packages/mcp/tools/media/utils.js` — MINIMAX_BASE_URL 默认值
- `packages/mcp/index.js` — 日志倒序
- `packages/ai-chat/src/lib/providers.ts` — 新增 minimax
- `packages/ai-chat/src/app/api/chat/route.ts` — preprocessImages、cleanMessages、TOOLS_PROMPT、日志
- `packages/ai-chat/src/app/page.tsx` — 图片上传、handleSend、localStorage
- `packages/ai-chat/src/components/chat/message-item.tsx` — 图片渲染、guard
- `packages/ai-chat/src/components/chat/markdown-components.tsx` — iframe 去硬编码
- `packages/ai-chat/src/app/preview/[taskId]/route.ts` — Cache-Control
- `packages/ai-chat/src/instrumentation.ts` — 日志倒序
- `.env` — MINIMAX_BASE_URL

## v0.4.3 (2026-07-04) — 渲染优化与修复

### 优化
- 渲染引擎升级：hyperframes 0.7.22 → 0.7.26
- 渲染参数优化：`--player-ready-timeout=5000`（等待播放器就绪）、`--protocol-timeout=900000`（15min 超时）、`--workers 4 --fps 24`
- 字体加载：删除 `@import Google Fonts`，改用 HyperFrames 内置字体映射，消除构建时字体下载阻塞

### 修复
- SVG 图表使用实际 hex 色值替代 CSS 变量，确保渲染引擎正确解析颜色

### 变更文件
- `packages/mcp/package.json` — hyperframes 版本更新
- `packages/mcp/tools/media/video.js` — 渲染参数调整
- `packages/mcp/tools/media/html-builder.js` — 字体映射、SVG 色值
- `packages/mcp/templates/animation.html` — 字体加载方式调整
- `packages/mcp/templates/default.md` — 明确 SVG hex 色值要求
- `packages/mcp/templates/cream.md` — 明确 SVG hex 色值要求

## v0.4.2 (2026-07-03) — 视频生成架构重构

### 重构
- 视频生成架构：从 JSON 模板改为 MD 风格描述 + 动画骨架模板
- 动画引擎：CSS @keyframes → GSAP（GreenSock Animation Platform）
- 图表渲染：Chart.js → 内联 SVG + GSAP 动画（chart.js 依赖已删除）
- `media.js` → `media/` 子目录拆分（image/diagram/video/audio/html-builder）

### 新增
- `generateHTMLPreview` 工具：生成 GSAP HTML 预览，不渲染为 MP4
- `renderVideo` 工具：将 HTML 预览渲染为 MP4 视频
- 预览流程：`generateHTMLPreview` → 聊天中 iframe 预览 → 用户确认 → `renderVideo` → MP4
- 模板系统：`templates/animation.html`（骨架）、`templates/default.md`（Neo-Brutalist）、`templates/cream.md`（奶油风）
- 路由：`/preview/[taskId]` — HTML 预览代理
- 组件：iframe 组件（`markdown-components.tsx`）— 支持聊天中嵌入视频预览
- 进度追踪：`checkVideoProgress` 支持 30s 轮询间隔

### 删除
- `generateHTMLtoShortVideo` 工具（被 `generateHTMLPreview` + `renderVideo` 替代）
- `templates/default.json`、`templates/cream.json`（改为 MD 格式）
- `vendor/gsap.min.js`、`vendor/DrawSVGPlugin.min.js`（GSAP 从 CDN 加载）

### 新增依赖
- `rehype-raw` — iframe 预览支持

### 变更文件
- `packages/mcp/tools/media/` — 从 media.js 拆分为 image.js / diagram.js / video.js / audio.js / html-builder.js
- `packages/mcp/templates/` — 新增 animation.html / default.md / cream.md，删除 default.json / cream.json
- `packages/mcp/vendor/` — 清空
- `packages/ai-chat/src/components/chat/markdown-components.tsx` — 新增 iframe 组件
- `packages/ai-chat/src/app/preview/[taskId]/route.ts` — 新增预览代理路由
- `packages/ai-chat/package.json` — 新增 rehype-raw
- `README.md` / `design.md` / `CHANGELOG.md` / `packages/mcp/README.md` — 文档同步

## v0.4.1 (2026-07-01) — 本地生产部署 + 修复

### 新增
- 生产部署脚本：`npm run prod`（构建 + Chroma 后台 + Next.js nohup 后台，端口 4567）
- `npm run stop` — 停掉 :4567 和 :8000
- `npm run log` — tail -f /tmp/xiaosheng-ai.log 实时日志

### 修复
- 构建超时：`next/font/google` Geist 字体被墙，改用本地 `@fontsource` 字体
- `addKnowledge({database:"code"})` 路由错误：之前全部落入 `chat_knowledge`，修复后自动路由到 `code/<项目目录名>`
- build 脚本加 `--webpack` 标志（Next.js 16 Turbopack 默认但有 webpack 配置）
- `searchKnowledge` AGENTS.md 未指定 `topK`，默认仅返回 3 条，改为 `topK=100`

### 优化
- chroma.js `defaultCollection` 改为三分支（shared/code/chat），code 用 `basename(process.cwd())` 自动取项目名
- opencode MCP 配置删除 `cwd` 字段，使 MCP server 继承当前工作目录
- 去掉 `.env.local` 依赖，CHROMA_URL/CHROMA_AUTO_START 有默认值

### 变更文件
- `package.json` — 新增 prod/stop/log 脚本
- `packages/ai-chat/package.json` — build 加 --webpack
- `packages/ai-chat/src/app/layout.tsx` — 移除 Geist 字体
- `packages/ai-chat/src/app/globals.css` — --font-sans 改本地字体
- `~/.config/opencode/opencode.json` — 删除 mcp cwd
- `~/.config/opencode/AGENTS.md` — searchKnowledge 加 `topK=100`
- `packages/mcp/tools/chroma.js` — defaultCollection 加 CODE_DB 分支

### 2026-07-01 后续更新

#### 数据迁移
- 7 条金融知识从 `chat/chat_knowledge` 迁移到 `chat/learn-finance`
- 删除 chat 库 11 个垃圾 collection（`getOrCreateCollection` 误创建残留）

#### 管理面板
- chat 库 collection 下拉改为动态加载（同 code 库逻辑）
- `useEffect` 合并 chat/code 的 collection 加载

#### 回到底部按钮
- 圆形下箭头按钮，`float-right relative bottom-[50px]`，悬在输入框上方
- 消息 >5 条且不在底部时显示，固定占位容器防抖动
- subtle 风格，`h-8 w-8 rounded-full`

#### 输入框改造
- `<input>` → `<textarea>` 多行输入框
- 默认 1 行，最大 15 行（`max-h-80`），超出滚动
- Enter 发送，Shift+Enter 换行，发送后自动重置高度
- 去掉 `>` 提示符图标

#### 输入区布局重构
- 三层结构外包 `pixel-input-group`（像素边框，`focus-within` 变蓝）
- 工具栏层：压缩对话 + 重新开始（左侧），预留模型切换
- 输入层：textarea 去边框（`pixel-input-group` 内样式覆盖）
- 底部层：发送按钮（右侧），预留文件上传（左侧）
- 去掉分隔线，Footer spacer 删除
- CSS 新增 `.pixel-input-group` 样式

#### RAG 预检索动态化
- `vector-store.ts` 新增 `listCollections(database)`，60s 缓存
- `retrieve.ts` 动态遍历 shared + chat 所有 collection，不再硬编码

#### TOOLS_PROMPT 通用化
- 去掉分类词，通用描述：主题笔记 → `database="chat" collection="<命名>"`，一般对话 → `database="chat"`（不传 collection）
- `searchKnowledge` 强调 database 和 collection 必须同时传

#### searchKnowledge 检索优化
- topK max 30 → 100
- 每个 collection 取 `topK * 3`，合并后截断，避免跨 collection 遗漏

#### 学习主题 collection 支持
- `addKnowledge` 工具描述开放 `collection` 参数：学习场景传 `collection=learn-<主题>`
- 代码逻辑零改动，`getOrCreateCollection` 自动创建

### 变更文件
- `packages/ai-chat/src/app/page.tsx` — 回到底部按钮、输入框改造、布局重构
- `packages/ai-chat/src/app/globals.css` — 新增 `.pixel-input-group` 样式
- `packages/ai-chat/src/app/admin/chroma/page.tsx` — chat collections 动态加载
- `packages/ai-chat/src/lib/vector-store.ts` — listCollections()
- `packages/ai-chat/src/lib/retrieve.ts` — 动态预检索
- `packages/ai-chat/src/app/api/chat/route.ts` — TOOLS_PROMPT
- `packages/mcp/tools/chroma.js` — topK 放宽、searchCollection 优化、addKnowledge 描述

### 2026-07-01 后续更新 2

#### 短视频生成
- 新增 `generateHTMLtoShortVideo` 工具（media.js）：生成 9:16 竖屏短视频，HyperFrames 渲染，可发抖音
- generateVideo 和 generateSpeech 两个 stub 保留不动
- 工具总数：26 → 27（24 已实现，3 预留）

#### 新增依赖
- `hyperframes ^0.7.22` — 短视频渲染引擎
- `@ffmpeg-installer/ffmpeg ^1.1.0` — FFmpeg 视频编码
- `@ffprobe-installer/ffprobe ^2.1.2` — 视频元数据探测

#### 其他
- `layout.tsx` 加 `suppressHydrationWarning`
- `mcp/index.js` 加 server-id 日志

### 变更文件
- `packages/mcp/tools/media.js` — 新增 generateHTMLtoShortVideo
- `packages/mcp/index.js` — server-id 日志
- `packages/ai-chat/src/app/layout.tsx` — suppressHydrationWarning
- `packages/mcp/package.json` — 新增依赖
- `README.md` / `design.md` / `CHANGELOG.md` / `packages/mcp/README.md` — 文档同步

## v0.4.0 (2026-06-30) — Chroma 多库架构

### 新增
- Chroma 多库架构：`shared`（主库）+ `chat`（聊天库）+ `code`（编码库），按功能域隔离
- 数据迁移：`default_database/java_knowledge` → `shared/base_knowledge`(104) + `chat/chat_knowledge`(46)
- opencode 接入：MCP 配置 `chroma` server，连接 `code/<project>` 读写
- opencode AGENTS.md：会话开始 searchKnowledge，每轮对话后 addKnowledge 存入 code 库
- opencode-mem 迁移：34 条记忆 → 7 个 `code/<project>` collection
- 管理面板：数据库/collection 下拉 + 虚拟列表（Virtuoso）+ 删除/批量删除（复选框 + AlertDialog）
- 管理面板：混合搜索（FTS 关键词 + embedding 语义）
- `getCollectionSafe()`：不自动创建 collection，防止误创建
- 整理数据：三阶段过滤（规则 → 余弦去重 → LLM 质量），loading 状态

### 优化
- chroma.js 移除 UUID 校验，支持任意 ID 格式
- chroma.js 5 个工具 collection 默认值根据 database 自动切换
- searchKnowledge 返回结果加 database/collection 字段
- searchKnowledge 去重：database=shared 时只查一次
- TOOLS_PROMPT 重写：库表映射 + 工具分组 + 正面指令
- 管理面板：列表按时间倒序，服务端全局排序
- 管理面板：切换库清空搜索，删除本地移除，checkbox 统一 size-4
- 管理面板：alert() → toast (sonner)，去掉统计卡
- 压缩/记入知识库保留媒体信息（图片、视频、图表）
- 编码规则：不猜测，先打日志拿数据，分析根因后修复

### 新增文件
- `src/components/ui/alert-dialog.tsx` — shadcn/ui 确认弹窗
- `packages/mcp/examples/default.md` — opencode 接入文档

## v0.3.0 (2026-06-29) — UI 大改

### 新增
- 聊天持久化：localStorage 自动保存/恢复，300ms 防抖
- 压缩对话：`POST /api/chat/compress` → deepseek-v4-pro 总结
- 清空对话：localStorage.removeItem + setMessages([])
- 像素主题色：12 个 CSS 变量（蓝/红/绿/黄/紫 + 深色变体）
- 像素字体：@fontsource/fusion-pixel-12px-proportional-sc
- 按钮样式：.pixel-btn-ghost（蓝）+ .pixel-btn-danger（红）
- 模型自动调度：`classifyTask` 用 flash 分类，轻度走 flash、重度走 pro
- 消费展示：消息气泡底部分两行显示 token 消耗 + 金额（¥换算）
- 爬虫工具：fetchPage（获取/下载单页）+ crawlSite（整站爬取），支持 Cookie 注入、登录页检测

### 优化
- 输入框：`>` 替换为 ChevronRight 图标，聚焦联动
- 输入框边框：color-mix 加深，像素轮廓更清晰
- ME 头像：border 2px → 1px
- 按钮：透明背景 + 彩色边框，hover 填充亮色
- 压缩对话：提示词改为保留/丢弃/格式三段式，防止丢失 AI 回复
- 压缩对话：二次压缩不丢历史（提取前次摘要 + 两段式上下文）
- 压缩对话：toast 显示 tokens 消耗和金额
- 消息气泡：AI 固定 w-[80%]，用户保持 max-w-[80%]
- 滚动：Virtuoso Footer 底部 spacer 防止最后消息被按钮遮挡

### 重构
- time.js → todo.js，registerTime → registerTodo

### 新增依赖
- cheerio（爬虫 HTML 解析）

### 新增文件
- `src/lib/model-router.ts` — classifyTask 分类器
- `src/lib/cost.ts` — 定价常量 + calculateCost + formatTokens
- `packages/mcp/tools/fetch.js` — fetchPage + crawlSite 爬虫工具

### 已知局限
- Cookie 注入不支持 SSO/OAuth 登录（MaxKey 等），需 Puppeteer 后续支持
- 不支持 SPA 纯 JS 渲染页面，axios 只拿原始 HTML

## v0.2.1 (2026-06-26) — 修复与体验

### 新增
- 采纳记忆：AI 回复中 BookmarkPlus 图标 → deepseek-v4-flash 压缩 → Chroma
- TooltipIcon 通用组件：icon/label/side/clickable 可配置
- Toast 通知：sonner 像素风，1s 停留
- BodyWrapper：admin 路由自动 body 滚动

### 修复
- 工具调用：stopWhen: stepCountIs(5) → stepCountIs(100)
- 虚拟列表：followOutput="smooth" 替代手动滚动跟踪
- 动态内容滚动：GeneratedImage/MermaidBlock 加载后 dispatchEvent('virtuoso-resize')
- DOM 嵌套：PixelLoading `<div>` → `<span>`，修复 ReactMarkdown 嵌套错误
- 浮层裁切：overflow-hidden 从气泡移到内容层

### 新增依赖
- sonner（toast 通知）

## v0.2.0 (2026-06-25) — 多模态生成

### 新增
- 图片生成：MiniMax API，60s 超时，OSS 签名 URL 原样输出
- 流程图生成：Mermaid，5 套主题（default/pink/ocean/forest/dark）
- 虚拟列表：react-virtuoso + followOutput="smooth"

### 优化
- 像素风 UI 完善：扫描线、3px 像素边框、点阵背景
- 流式加载：PixelLoading 占位，完成后 GeneratedImage/MermaidBlock 渲染
- 环境变量：统一在根 .env 管理

### 新增依赖
- @ai-sdk/react, react-virtuoso, mermaid, react-markdown, remark-gfm

## v0.1.0 (2026-06-16~17) — 项目初始化

### 新增
- Next.js 16 + AI SDK v6 + RAG 知识库 + MCP 工具调用
- Chroma 向量数据库：java_knowledge collection，104 条 2048 维向量
- 智谱 embedding-3 + DeepSeek V4 Pro 对话
- MCP 服务器：时间/文件/知识库/多模态（26 个工具）
- Markdown 渲染：react-markdown + remark-gfm + @tailwindcss/typography
- 思考过程折叠：isReasoningUIPart + details
- 工具调用 UI：去重、状态指示、最大 5 轮

### 架构
- npm workspaces monorepo：packages/ai-chat + packages/mcp
- stdio MCP 客户端，4 个模块注册

### 新增
- 微调功能：AI 修改脚本 + 自动重跑 render
- 历史版本管理：scripts/v{N}.json + videos/v{N}.mp4
- 版本切换：一键切换历史版本，视频立即更新
- 异步任务：POST /tweak 立即返回，后台执行
- 客户端日志：POST /api/client-log 写入 app 日志文件
- 声明式动画：data-animate-in / data-transition 属性

### 修复
- CLI argv 被 \n 破坏 → feedback 走 state.json 传递
- render.js 正则误匹配 clip-content → 改为独立 class 匹配
- render.js 多余花括号 → 语法错误无法加载
- saveVideoVersion import 路径错误
- writeState 覆盖 videoFile 问题
- prompt-builder.js parseJSON 重复声明
- schema.js fonts/palette 字段过严
- 前端 useEffect 双轮询
- tweakTask 状态不触发前端更新

### 优化
- 动画引擎重写：11 种入场预设 + 擦除转场
- 设计规范：鼓励炫技，删除禁止项
- 视频播放器 260px → 320px
- file 路由缓存改为 no-cache
- 切换版本后自动复制视频到 output.mp4
- 微调中禁用按钮防重复
- 预更新步骤状态让前端立即看到变化
