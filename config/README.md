# config/network.json

项目级网络配置 — **端口 + host 单一真相源**。

改这里 → 所有消费者（scripts/、packages/mcp/、packages/ai-chat/）自动同步。

## 读取方式

| 消费者类型 | 方式 | 示例 |
|---|---|---|
| CJS (proxy.cjs) | `require('../config/network.json')` | `config.ports.aiChat.prodProxy` |
| bash (prod.sh/dev.sh/stop.sh) | `node -e "console.log(require('./config/network.json').X)"` | `node -e "console.log(require('./config/network.json').ports.aiChat.dev)"` |
| ESM (mcp/tools/document, mcp/lib/chroma, ai-chat/lib/utils/env, ai-chat/lib/rag/chroma-server, ai-chat/scripts/*) | `fs.readFileSync(path.resolve(process.cwd(), "..", "..", "config/network.json"))` + `JSON.parse` | 同上 |

## 字段

```jsonc
{
  "hosts": {
    "local": "localhost",                 // 本机地址，dev/prod 都用它
    "public": "node.tailddce43.ts.net"   // 公网域名（tailscale funnel 暴露）
  },
  "ports": {
    "aiChat": {
      "dev": 3000,            // next dev 默认端口
      "prodDirect": 4567,     // next start 端口（proxy 反代目标）
      "prodProxy": 4321       // proxy.cjs 监听端口（MCP 工具访问入口）
    },
    "chroma": 8000            // chroma-server 端口
  }
}
```

## 消费者清单

| 文件 | 读什么 | 用途 |
|---|---|---|
| `scripts/proxy.cjs` | `hosts.local`、`ports.aiChat.prodDirect/prodProxy` | proxy 监听 + target |
| `scripts/prod.sh` | `hosts.local/public`、`ports.aiChat.prodDirect/prodProxy` | 起服务 + tailscale |
| `scripts/dev.sh` | `ports.aiChat.dev` | next dev 端口 |
| `scripts/stop.sh` | `ports.aiChat.prodDirect/prodProxy`、`ports.chroma` | 停服务（4568 暂未配置化） |
| `packages/mcp/tools/document/index.js` | `hosts.local`、`ports.aiChat.prodProxy/dev` | 字体 URL 惰性探测 |
| `packages/mcp/lib/chroma.js` | `hosts.local`、`ports.chroma` | chroma 客户端连接 |
| `packages/ai-chat/src/lib/utils/env.ts` | `hosts.local`、`ports.chroma` | `env.CHROMA_URL` |
| `packages/ai-chat/src/lib/rag/chroma-server.ts` | `hosts.local`、`ports.chroma` | chroma spawn --host/--port |
| `packages/ai-chat/src/lib/rag/vector-store.ts` | (间接通过 env.CHROMA_URL) | chroma HTTP 请求 |
| `packages/ai-chat/src/app/api/admin/chroma/route.ts` | (间接通过 env.CHROMA_URL) | chroma HTTP 请求 |
| `packages/ai-chat/scripts/verify-migration.ts` | `hosts.local`、`ports.chroma` | chroma 客户端连接 |
| `packages/ai-chat/scripts/generate-embeddings.ts` | `hosts.local`、`ports.chroma` | chroma 客户端连接 |

## 不在 config 里的（明确）

- ❌ `.env` 里的 API keys（个人/部署配置）
- ❌ LLM endpoint（OpenAI/ /GLM_BASE_URL 等）（同上）
- ❌ `BASE_PATH=/ai`（next.config.ts，不是端口）
- ❌ Chroma DB 名（`SHARED_DB`/`CHAT_DB`）（不是 host/port）
- ❌ todo (8080) / tasksScheduler (4568)（暂未迁移，等指示）