# 小盛开AI

Neo-Brutalism 糖果色 AI 对话助手，集成 RAG 知识库、MCP 工具调用、多模态生成。

## 功能

- 📸 图片理解：粘贴/上传图片 → MiniMax-M3 描述 → DeepSeek 间接理解
- 💬 流式 AI 对话（DeepSeek V4 Pro / MiniMax M3 / GLM / Qwen，策略模式路由）
- ⚙️ 设置系统：7 个模块独立选择（chat / media / vector / workflow / preprocess / tts / bgm）+ Provider 在线配置（providers.json 为真源）
- 🖥️ 服务监控面板：设置页可视化 `packages/services/*` 独立服务（`service.json` 清单发现），展示状态/端口/健康检查，支持启动/重启/关闭
- 📚 RAG 知识库检索（Chroma + 智谱 embedding-3，动态多表检索）
- 🧠 主题学习笔记（learn-* collection，按主题隔离）
- 📝 小红书笔记自动生成：对话内容 → 带封面/插画/标签的完整笔记，4 种模板 + 二级类目，聊天内嵌预览 + 独立页面，导出 HTML/MD/图片
- 🔧 33 个 MCP 工具（文件/知识库/图片/图表/小红书笔记/文档转换/联网搜索与抓取/Shell/skill 加载）
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

### 部署（云服务器）

生产拓扑：**云服务器 = 生产 + 博客唯一写入端；Mac = 开发 + 备份副本**。反向代理（`scripts/proxy.cjs`）统一处理 `/`（博客）和 `/ai/`（AI 工作台），仅 proxy 口对外（`PROXY_BIND=0.0.0.0`），其余服务恒回环。

```bash
npm run deploy          # Mac 侧发版：push → 服务器拉 master（github 不通自动 bundle 兜底）→ 门禁构建 → 重启 → 公网冒烟五连
npm run deploy:smoke    # 仅公网冒烟
npm run prod            # 服务器侧本机：体检 → 门禁 → stop → start → 自检（deploy.sh 内部调用）
npm run stop / log
```

换云服务器 = 改 `.env` 一行 `DEPLOY_TARGET=root@<新IP>`（`DEPLOY_PATH` 同理）；首次服务器准备见 DESIGN.md「生产部署」（node≥22、.env、防火墙放行 4321）。Mac 侧 `sync.sh`：`env`（.env 同步）/ `site`（博客 server→Mac 镜像）/ `backup`（data 备份，30min 定时）/ `harden` 等，详见 `scripts/sync.sh` 头注释。

| 服务 | 端口 | 公网地址 |
|------|---------|---------|
| AI 工作台 | 4567（通过 4321 代理） | `http://118.89.25.12:4321/ai/`（需登录） |
| 博客 | 4321（代理静态文件） | `http://118.89.25.12:4321` |
| ChromaDB / SearXNG / 搜索编排 | 8000 / 8080 / 8090 | 仅回环 |

> 架构性端口集中在 [`config/network.json`](config/README.md)；机器相关（服务器地址/密钥）全在 `.env`（gitignored）。

日志：`logs/`（app 应用日志 + tasks 任务日志 + workflows 工作流日志 + services 子服务日志，按日轮转）

## 技术栈

Next.js 16 / React 19 / AI SDK v6 / DeepSeek V4 Pro / MiniMax / Chroma / Tailwind CSS 4 / shadcn/ui

## 文档

- [ARCHITECTURE.md](ARCHITECTURE.md) — 代码实现说明（目录结构 / 模块职责 / 子系统实现）
- [DESIGN.md](DESIGN.md) — 设计决策 / 规范 / 部署
- [ai-chat](packages/ai-chat/README.md)
- [mcp](packages/mcp/README.md)
- [skills](packages/skills/README.md)
- [网络配置](config/README.md)
- [博客](http://118.89.25.12:4321)