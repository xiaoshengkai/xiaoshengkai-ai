# 小盛开AI

基于 Next.js 16 + Vercel AI SDK v6 的 AI 对话应用，集成 RAG 知识库检索与 MCP 工具调用。

## 功能

- 流式对话（`useChat` + `streamText`）
- RAG 知识库检索（Chroma + 智谱 embedding-3）
- 知识库 CRUD（LLM 通过 MCP 工具自主增删改查）
- MCP 工具调用（文件/知识库/图片/图表/小红书/文档/抓取/Shell，30 tools）
- 视频预览：iframe 嵌入（`rehype-raw`）
- Chroma 自动启动（Next.js instrumentation）

## 技术栈

Next.js 16 / React 19 / AI SDK v6 / DeepSeek V4 Pro / 智谱 embedding-3 / Chroma / Tailwind CSS 4 / shadcn/ui

## UI 风格

**Neo-Brutalism 糖果色** — 后续所有 UI 开发均遵循此风格。多主题可切换（`data-theme` 作用域 + `UI_THEME` env 定默认）。

- 纯黑 2-4px 实线边框 + 零模糊纯黑硬阴影（`box-shadow: Npx Npx 0 #000`）
- 高饱和糖果色（电光黄主色 + 粉/蓝/紫/橙/深绿点缀），禁用渐变/模糊/毛玻璃
- 直角（`--radius: 0`），hover 位移 `translate(-2px,-2px)` + 阴影扩大，active 按压
- 用户气泡黑底白字 + 黄硬阴影，AI 气泡白底黑字
- 字体：Inter（正文）/ Plus Jakarta Sans（标题）/ JetBrains Mono（标签）
- 主题 token 定义在 `globals.css` 的 `[data-theme="*"]` 块，经 `@theme inline` 映射成 Tailwind 类

## 快速开始

```bash
# 1. 安装 Chroma（Python，一次性）
uv tool install chromadb

# 2. 安装依赖（根目录统一安装）
npm install

# 3. 配置环境变量
cp ../../.env.example ../../.env
# 编辑 ../../.env 填入 DEEPSEEK_API_KEY / GLM_API_KEY / MINIMAX_API_KEY

# 4. 一次性迁移（JSON → Chroma）
npx tsx scripts/generate-embeddings.ts --reset

# 5. 启动
npm run dev
# 浏览器打开 http://localhost:3000
```

## 工具

所有工具由 `packages/mcp` 统一提供，详见 [mcp README](../mcp/README.md)。

## 脚本

| 命令 | 用途 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 |
| `npm run lint` | ESLint 检查 |
| `npx tsx packages/ai-chat/scripts/generate-embeddings.ts --reset` | 迁移 JSON → Chroma |
| `npx tsx packages/ai-chat/scripts/verify-migration.ts` | 一致性校验 |

## 详细设计

见 [DESIGN.md](../../DESIGN.md) 与 [ARCHITECTURE.md](../../ARCHITECTURE.md)