# Search Service

联网搜索 + 网页抓取服务：Firecrawl Cloud 主搜/抓取 + 本地 SearXNG 兜底。MCP 的 search 模块（5 个工具）薄适配调用本服务。

## 架构

```
MCP (search 模块)
  ├── searchWeb       → /search   → Firecrawl /v2/search(general/news/images) + Firecrawl(前 3 条正文)
  │                                  └ 失败/0 结果/videos/wechat/page>1 → SearXNG(baidu/sogou/bing 系列)
  ├── scrapeWebPage   → /scrape   → Firecrawl /v2/scrape
  ├── mapWebsite      → /map      → Firecrawl /v2/map
  ├── crawlWebsite    → /crawl    → Firecrawl /v2/crawl（内部轮询，≤20 页）
  └── parseDocument   → /parse    → Firecrawl /v2/scrape + parsers:["pdf"]
```

## 启动

```bash
# 1. 启动 SearXNG（首次自动 clone + venv + install，耗时较长）
bash packages/services/search/searxng/start.sh

# 2. 启动本服务
node packages/services/search/server.js
```

由 `scripts/dev.sh` / `scripts/prod.sh` 统一管理；也可在设置页「独立服务」面板启动/重启/关闭（清单见本目录 `service.json`）。

## 接口

- `GET /health` — 进程存活
- `GET /ready` — SearXNG 可访问 + Firecrawl key 已配置 + 分类列表
- `GET /search?query=&category=&language=&timeRange=&page=&maxResults=&fetchContent=` — 搜索
- `GET /scrape?url=` — 抓指定 URL 正文
- `GET /map?url=` — 发现站内 URL
- `GET /crawl?url=&limit=` — 抓网站多页（≤20 页）
- `GET /parse?url=` — 解析在线 PDF

## searchWeb 分类

| category | 主搜 | 兜底(SearXNG) | 抓正文 |
|---|---|---|---|
| general | Firecrawl web | baidu / sogou / bing | ✅ 前 3 条 |
| images | Firecrawl images | baidu/sogou/bing images | ❌ |
| videos | —（无 Firecrawl 对应） | sogou/bing videos | ❌ |
| news | Firecrawl news | bing news | ✅ 前 3 条 |
| wechat | —（无 Firecrawl 对应） | sogou wechat | ❌ |

- Firecrawl 主搜 2 credits/次；`timeRange` 映射为 tbs（qdr:d/m/y），`language` 忽略，`page>1` 直接走 SearXNG
- 响应含 `provider`（firecrawl/searxng）与 `degraded`（主搜失败已兜底）

## 配置

- host/port：`config/network.json` 的 `hosts.local` + `ports.searxng`(8080) / `ports.searchService`(8090)
- Firecrawl key：根 `.env` 的 `FIRECRAWL_API_KEY`（不写入任何源码/文档）

## 测试

- `npm run test:search` — 单元测试（结果规范化、类别映射）
- `npm run test:search:live` — 真实 Firecrawl 集成测试（scrape/map/crawl/parse）
