# Changelog

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