# 小盛开AI

像素风 AI 对话助手，集成 RAG 知识库、MCP 工具调用、多模态生成。

## 功能

- 📸 图片理解：粘贴/上传图片 → MiniMax-M3 描述 → DeepSeek 间接理解
- 💬 流式 AI 对话（DeepSeek V4 Pro）
- 📚 RAG 知识库检索（Chroma + 智谱 embedding-3，动态多表检索）
- 🧠 主题学习笔记（learn-* collection，按主题隔离）
- 📝 小红书笔记自动生成：对话内容 → 带封面/插画/标签的完整笔记，4 种模板 + 二级类目，聊天内嵌预览 + 独立页面，导出 HTML/MD/图片
- 🔧 38 个 MCP 工具（时间/文件/知识库/图片/图表/短视频/小红书笔记/日志）
- 🎨 像素复古风 UI（shadcn/ui + 自定义 CSS）
- 📝 个人博客（GitHub Pages，新粗野主义像素风，笔记自动同步）
- 🖼️ 文生图 + 图生图（MiniMax），异步模式，73 种视觉风格可选
- 📊 图表生成：Mermaid + D2 双引擎，异步模式，支持 10 种图表类型（流程图/时序图/类图/状态图/ER图/甘特图/饼图/象限图/架构图/网络拓扑）
- 🎬 短视频生成（MD 风格描述 + GSAP 动画 + HyperFrames 渲染，可发抖音）
- 📦 npm workspaces monorepo

## 快速开始

### 开发模式

```bash
git clone <repo-url>
cd ai-engineer-journey

# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 DEEPSEEK_API_KEY / GLM_API_KEY / MINIMAX_API_KEY 等

# 3. 安装 Chroma（一次性）
uv tool install chromadb

# 4. 启动开发服务器
npm run dev
```

### 生产模式

```bash
npm run prod   # 构建 + 后台启动（端口 4567）
npm run stop   # 停掉所有服务
npm run log    # 查看实时日志
```

服务地址：`http://localhost:4567`，日志文件：`logs/app-YYYY-MM-DD.log`（按日轮转）

## 技术栈

Next.js 16 / React 19 / AI SDK v6 / DeepSeek V4 Pro / MiniMax / Chroma / Tailwind CSS 4 / shadcn/ui

## 文档

- [ai-chat](packages/ai-chat/README.md)
- [mcp](packages/mcp/README.md)
- [skills](packages/skills/README.md)
- [设计文档](design.md)
- [博客](https://xiaoshengkai.github.io/xiaoshengkai-ai/)