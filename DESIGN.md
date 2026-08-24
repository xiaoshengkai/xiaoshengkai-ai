# 小盛开AI 设计文档

> 本文档记录**设计决策、规范与约定**。代码怎么组织（目录结构、模块职责、子系统实现）见 `ARCHITECTURE.md`，版本变更历史见 `CHANGELOG.md`。

## UI 风格

**Neo-Brutalism 糖果色** — 后续所有 UI 开发均遵循此风格，组件库使用 shadcn/ui。多主题可切换（`data-theme` 作用域覆盖 token）。

### 视觉规范

| 元素 | 规范 |
|------|------|
| 背景 | 纯白 `#FFFFFF`，次背景 `--muted #F5F5F5` |
| 边框 | 2-4px 纯黑实线 + 零模糊纯黑硬阴影（`Npx Npx 0 #000`） |
| 主色 | 电光黄 `#FFE135`（黑字），粉/蓝/紫/橙/深绿点缀 |
| 气泡 | 用户黑底白字 + 黄硬阴影（`bg-ink`）、AI 白底黑字（`bg-card`） |
| 头像 | AI 黄底黑字、ME 粉底白字，2px 黑边 |
| 按钮 | 黑边硬阴影，hover 位移 + 阴影扩大，active 按压 |
| 圆角 | 直角（`--radius: 0`） |
| 字体 | Inter（正文）/ Plus Jakarta Sans（标题）/ JetBrains Mono（标签） |
| 加载 | 黄色旋转环 + 滑块进度条 |
| 禁用 | 渐变 / 模糊 / 毛玻璃 / 荧光亮绿 |

### 组件规则

- 基础组件用 shadcn/ui（Button、Input 等），不手写
- 主题样式通过 CSS 变量 + `data-theme` 作用域，经 `@theme inline` 映射成 Tailwind 类
- 所有 token 定义在 `globals.css` 的 `[data-theme="*"]` 块，无额外依赖

## 架构流程

```mermaid
flowchart TD
  subgraph ON["⚡ 在线请求 — POST /api/chat"]
    direction TB
    U["浏览器 useChat"]
    R1["① 提取 userQuery"]
    R2["② retrieve.ts<br/>智谱 embed → queryVec"]
    R3["③ vector-store.ts<br/>Chroma cosine Top-5（动态多表）"]
    R4["④ knowledgeContext<br/>注入 system prompt"]
    R5["⑤ getMCPClient<br/>stdio spawn node ../mcp/index.js"]
    R6["MCP 工具<br/>知识库/文件/多模态/skill 加载"]
    R7["⑥ streamText<br/>策略模式(deepseek/minimax/glm/qwen)"]
    R8["⑦ SSE 流式返回 + iframe 预览"]
    U -->|"POST {messages}"| R1
    R1 --> R2 --> R3 --> R4
    R1 --> R5 --> R6
    R4 --> R7
    R6 --> R7
    R7 --> R8 --> U
  end

  subgraph PROC["📦 进程拓扑"]
    direction TB
    A1["ai-chat (Next.js)"]
    A2["chromadb (standalone)<br/>:8000, data/chroma/"]
    A4["mcp (stdio)<br/>33 tools: skill/exec/search/file/chroma/media/diagram/xiaohongshu/document"]
    A5["searxng (python venv)<br/>:8080, baidu/sogou/bing"]
    A6["search-service (node)<br/>:8090, SearXNG + Firecrawl"]
    A1 -->|"instrumentation spawn"| A2
    A1 -->|"HTTP :8000"| A2
    A1 -->|"stdio spawn"| A4
    A4 -->|"HTTP :8090"| A6
    A6 -->|"HTTP :8080"| A5
  end
```

## 环境与外部依赖

### 运行时

| 依赖 | 要求 | 验证 |
|---|---|---|
| Node.js | ≥ 20 | `node --version` |
| Python | ≥ 3.10(仅 Chroma 需要) | `python3 --version` |
| uv | latest(安装 Chroma 用) | `uv --version` |

### 外部 API

| 服务 | URL | 用途 |
|---|---|---|
| 智谱 AI | `https://open.bigmodel.cn/api/paas/v4` | Embedding(`embedding-3`) |
| DeepSeek V4 Pro | `https://api.deepseek.com/v1` | 对话生成 |
| MiniMax | `https://api.minimaxi.com/v1` | 图片生成、图片理解、TTS/BGM |
| MiniMax-M3 | `https://api.minimaxi.com/v1/chat/completions` | 对话/图片理解（OpenAI 兼容） |
| 阿里 Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 对话（qwen3.8-max，已接入，额度待配置） |
| Firecrawl Cloud | `https://api.firecrawl.dev` | 网页正文抓取（scrape/map/crawl/parse，key 在 `.env`） |

### 本地依赖

| 路径 | 是否必须 | 用途 |
|---|---|---|
| `data/chroma/` | 运行时持久化 | Chroma 数据 |
| `packages/mcp/` | 必选 | MCP 服务器集合 |

## API 约定

### POST /api/chat

**请求体**
```json
{
  "messages": [
    {
      "id": "msg_1",
      "role": "user",
      "parts": [{ "type": "text", "text": "记住 Java Stream 是惰性求值" }]
    }
  ]
}
```

**响应** — SSE 流式返回，由 `@ai-sdk/react` 的 `useChat` 自动解析。

**处理流程**
1. 提取最后一条用户消息
2. 智谱 `embedding-3` 生成查询向量
3. Chroma cosine 检索 Top-5 知识片段（动态多表：shared + chat 全部 collection）
4. 注入 `knowledgeContext` + `SKILL_LIST` 到 system prompt
5. 启动/复用 1 个 MCP client（stdio spawn `node ../mcp/index.js`，33 tools）
6. `streamText` 按策略模式路由（deepseek / minimax / glm / qwen，DeepSeek 经 classifyTask 分 pro/flash）
7. SSE 流式返回，图表/视频通过 iframe 预览

## 环境变量

API Key 统一在项目根目录 `.env` 配置：

```bash
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_PRO_MODEL=deepseek-v4-pro
DEEPSEEK_FLASH_MODEL=deepseek-v4-flash
GLM_API_KEY=xxx
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_EMBEDDING_MODEL=embedding-3
MINIMAX_API_KEY=xxx
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_IMAGE_MODEL=image-01
MINIMAX_CHAT_MODEL=MiniMax-M3
QWEN_API_KEY=xxx
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_CHAT_MODEL=qwen3.8-max

# Chroma 多库名（默认值，可不配）
CHROMA_SHARED_DB=shared
CHROMA_CHAT_DB=chat
CHROMA_CODE_DB=code
```

`CHROMA_URL` 从 `config/network.json` 读（hosts.local + ports.chroma），`CHROMA_AUTO_START` 默认开启、无需配置。

## 网络配置

端口 / host 单一真相源，集中在 `config/network.json`（详见 config/README.md）。

```jsonc
{
  "hosts": {
    "local": "localhost",                 // 本机地址
    "public": "node.tailddce43.ts.net"   // 公网域名（tailscale funnel）
  },
  "ports": {
    "aiChat": { "dev": 3000, "prodDirect": 4567, "prodProxy": 4321 },
    "chroma": 8000
  }
}
```

读取方式（三类消费者）：

| 消费者类型 | 方式 | 示例 |
|---|---|---|
| CJS | `require('../config/network.json')` | `proxy.cjs` |
| bash | `node -e "require('./config/network.json').X"` | `prod.sh` / `dev.sh` / `stop.sh` |
| ESM | `loadNetworkConfig()` | mcp 各模块、ai-chat 服务端 / scripts |

`loadNetworkConfig()` 定义在 `packages/shared/network.js`：从 `process.cwd()` 向上遍历找 `config/network.json`（最多 5 层），找到返回解析对象，找不到抛错（带 cwd 信息），调用方无需关心 cwd/项目根在哪。

明确不在 config 里：API key、LLM endpoint、`BASE_PATH`、Chroma DB 名。

## 图片生成经验

### OSS 签名 URL 规则

MiniMax 返回的图片链接包含三个绑定校验的参数：

| 参数 | 说明 |
|------|------|
| `Expires` | OSS 签名的过期时间（Unix 时间戳） |
| `OSSAccessKeyId` | 访问密钥 ID |
| `Signature` | 基于 Expires 等参数计算出的签名 |

**关键原则：URL 中任何一个字符都不能修改，必须原样透传。** 修改任意参数（如 Expires）会导致签名不匹配，OSS 返回 `SignatureDoesNotMatch`。

### 防护措施

- system prompt 已明确规则：URL 必须原样输出，不得修改
- `generateImage` 工具描述已强调"必须原样使用不得修改任何字符"
- 遇到 `SignatureDoesNotMatch` 错误，重新生成比尝试修复链接更高效

## 已知问题

| # | 问题 | 影响 | 解决方案 |
|---|---|---|---|
| 1 | Chroma Python 包需 `uv tool install` | 一次性配置 | 已在快速开始文档化 |
| 2 | Chroma v3 where 不支持 `$exists` | 软删改用 `deleted` 字段 + `$ne: true` | 已处理 |
| 3 | Chroma 启动需 Python 进程 | 多了 ~50MB 内存 | standalone server 比 embedded 更稳 |
| 4 | `next/font/google` 构建时下载字体被墙 | 国内构建超时 | 改用本地 `@fontsource` 字体，移除 `Geist` 导入 |
| 5 | `getOrCreateCollection` 误创建大量空 collection | 管理面板有大量垃圾表 | 已清理，后续 `getCollectionSafe` 不自动创建 |

## 生产部署

```bash
npm run prod   # 构建 + 启动全部服务（AI 工作台 :4567 + 博客 :4321 + Tailscale Funnel）
npm run stop   # 停止全部服务 + 关闭内网穿透
npm run log    # 查看实时日志
```

服务端口：

| 服务 | 本地端口 | 公网地址 |
|------|---------|---------|
| AI 工作台 | 4567 | `https://node.tailddce43.ts.net:8443` |
| 博客 | 4321 | `https://node.tailddce43.ts.net` |
| ChromaDB | 8000 | 仅本地 |

端口 / host 集中在 `config/network.json`，改这里全局同步。

- 日志文件：`logs/app-YYYY-MM-DD.log`（按日轮转）
- 博客静态文件：`site/`，由 `proxy.cjs` 直接 serve
- Tailscale Funnel 提供内网穿透，无需公网 IP
