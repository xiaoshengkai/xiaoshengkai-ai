# 小盛开AI

Neo-Brutalism 糖果色 AI 对话助手，集成 RAG 知识库、MCP 工具调用、多模态生成。

## 功能

- 📸 图片理解：粘贴/上传图片 → MiniMax-M3 描述 → DeepSeek 间接理解
- 💬 流式 AI 对话（DeepSeek V4 Pro / MiniMax M3 / GLM / Qwen，策略模式路由）
- ⚙️ 设置系统：7 个模块独立选择（chat / media / vector / workflow / preprocess / tts / bgm）+ Provider 在线配置（providers.json 为真源）
- 📚 RAG 知识库检索（Chroma + 智谱 embedding-3，动态多表检索）
- 🧠 主题学习笔记（learn-* collection，按主题隔离）
- 📝 小红书笔记自动生成：对话内容 → 带封面/插画/标签的完整笔记，4 种模板 + 二级类目，聊天内嵌预览 + 独立页面，导出 HTML/MD/图片
- 🔧 30 个 MCP 工具（文件/知识库/图片/图表/小红书笔记/文档转换/网页抓取/Shell/skill 加载）
- 🎨 Neo-Brutalism 糖果色 UI（shadcn/ui + 自定义 CSS，多主题可切换）
- 📝 个人博客（Neo-Brutalism 糖果屋风，笔记自动同步，Tailscale Funnel 内网穿透）
- 🖼️ 文生图 + 图生图（MiniMax），异步模式，73 种视觉风格可选
- 🎙️ TTS 语音合成（MiniMax speech-2.8-hd）+ BGM 音乐生成（music-2.6）
- 📊 图表生成：Mermaid + D2 双引擎，异步模式，支持 10 种图表类型
- 🎬 工作流引擎（@app/workflows，声明式 actions.json + 模板驱动）：短视频生成（MD 风格描述 + GSAP 动画 + HyperFrames 渲染）、逐步执行/重试/微调/版本切换
- ⏰ 定时任务系统（@app/tasks，node-cron 调度，独立进程，日志隔离，仪表盘预览）
- 📦 npm workspaces monorepo（@app/shared 公共包，能力包自包含 + ai-chat 声明式注册）

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

### 部署

```bash
npm run prod   # 构建 + 启动全部服务（AI 工作台 :4567 + 反向代理 :4321 + Tailscale Funnel）
npm run stop   # 停止全部服务 + 关闭内网穿透
npm run log    # 查看实时日志

# 定时任务
npm run tasks:start   # 启动定时任务调度器
npm run tasks:stop    # 停止调度器
npm run tasks:run     # 手动执行某个任务（TASK=name）
```

| 服务 | 本地端口 | 公网地址 |
|------|---------|---------|
| AI 工作台 | 4567（通过 4321 代理） | `https://node.tailddce43.ts.net/ai/` |
| 博客 | 4321（代理静态文件） | `https://node.tailddce43.ts.net` |
| ChromaDB | 8000 | 仅本地 |

> 端口 / host 集中在 [`config/network.json`](config/README.md)，改这里全局同步。

本机部署，通过 [Tailscale](https://tailscale.com/) Funnel 将本地服务暴露到公网，无需公网 IP 或云服务器。反向代理（`scripts/proxy.cjs`）统一处理 `/`（AI 工作台）和 `/blog/`（博客）。

```bash
# 启动时自动执行，也可手动控制
tailscale funnel --bg --https=443 4321
tailscale funnel reset                   # 关闭穿透
```

日志：`logs/`（app 应用日志 + tasks 任务日志 + workflows 工作流日志，按日轮转）

## 技术栈

Next.js 16 / React 19 / AI SDK v6 / DeepSeek V4 Pro / MiniMax / Chroma / Tailwind CSS 4 / shadcn/ui

## 文档

- [ARCHITECTURE.md](ARCHITECTURE.md) — 代码实现说明（目录结构 / 模块职责 / 子系统实现）
- [DESIGN.md](DESIGN.md) — 设计决策 / 规范 / 部署
- [ai-chat](packages/ai-chat/README.md)
- [mcp](packages/mcp/README.md)
- [skills](packages/skills/README.md)
- [网络配置](config/README.md)
- [博客](https://node.tailddce43.ts.net)