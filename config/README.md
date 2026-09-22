# config/network.json

项目级网络配置 — **端口 + host 单一真相源**。

改这里 → 所有消费者（scripts/、packages/mcp/、packages/ai-chat/）自动同步。

## 读取方式

| 消费者类型 | 方式 | 示例 |
|---|---|---|
| CJS (proxy.cjs) | `require('../config/network.json')` | `config.ports.aiChat.prodProxy` |
| bash (prod.sh/dev.sh/stop.sh) | `node -e "console.log(require('./config/network.json').X)"` | `node -e "console.log(require('./config/network.json').ports.aiChat.dev)"` |
| ESM (mcp / ai-chat) | `loadNetworkConfig()`（`packages/shared/network.js`） | 从 `process.cwd()` 向上找 `config/network.json`（最多 5 层） |

## 字段

```jsonc
{
  "hosts": {
    "local": "127.0.0.1",                 // 本机地址，dev/prod 都用它
    // 公网地址不再存这里：见 .env 的 DEPLOY_TARGET/PUBLIC_BASE（publicBase() 推导）
  },
  "ports": {
    "aiChat": {
      "dev": 3000,            // next dev 默认端口
      "prodDirect": 4567,     // next start 端口（proxy 反代目标）
      "prodProxy": 4321       // proxy.cjs 监听端口（MCP 工具访问入口）
    },
    "chroma": 8000            // chroma-server 端口
    "searxng": 8080           // 本地 SearXNG 搜索服务端口
    "searchService": 8090     // 搜索编排服务（Node）端口
  },
}
```