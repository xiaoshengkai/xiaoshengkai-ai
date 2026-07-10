# 小盛开AI

基于 Next.js 16 + Vercel AI SDK v6 的 AI 对话应用，集成 RAG 知识库检索与 MCP 工具调用。

## 功能

- 流式对话（`useChat` + `streamText`）
- RAG 知识库检索（Chroma + 智谱 embedding-3）
- 知识库 CRUD（LLM 通过 MCP 工具自主增删改查）
- MCP 工具调用（时间/文件/知识库/多模态生成）
- 视频预览：iframe 嵌入（`rehype-raw`）
- Chroma 自动启动（Next.js instrumentation）

## 技术栈

Next.js 16 / React 19 / AI SDK v6 / DeepSeek V4 Pro / 智谱 embedding-3 / Chroma / Tailwind CSS 4 / shadcn/ui

## UI 风格

**像素复古风** — 后续所有 UI 开发均遵循此风格。

- 扫描线叠加层（CRT 效果）
- 3px 像素边框（box-shadow 8 方向）
- 12px 点阵背景
- 像素按钮（按下位移反馈）
- 终端风格输入框（`>` 提示符）
- 像素风加载动效（方块跳动）
- 消息入场动画（淡入上移）
- 纯 CSS 实现，无额外依赖

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

见 [design.md](../../design.md)