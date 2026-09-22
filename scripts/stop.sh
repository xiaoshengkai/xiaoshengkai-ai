#!/bin/bash
# 4568 (tasks scheduler) 暂不配置化（你说先不管）
PROD_DIRECT=$(node -e "console.log(require('./config/network.json').ports.aiChat.prodDirect)")
PROXY_PORT=$(node -e "console.log(require('./config/network.json').ports.aiChat.prodProxy)")
CHROMA_PORT=$(node -e "console.log(require('./config/network.json').ports.chroma)")
SEARXNG_PORT=$(node -e "console.log(require('./config/network.json').ports.searxng)")
SEARCH_SERVICE_PORT=$(node -e "console.log(require('./config/network.json').ports.searchService)")

# 按端口杀进程；lsof 与进程名匹配双保险都跑（幂等；部分环境 lsof 查询会漏）
if command -v lsof >/dev/null 2>&1; then
  kill -9 $(lsof -t -i:$PROD_DIRECT) 2>/dev/null
  kill -9 $(lsof -t -i:$CHROMA_PORT) 2>/dev/null
  kill -9 $(lsof -t -i:$PROXY_PORT) 2>/dev/null
  kill -9 $(lsof -t -i:$SEARXNG_PORT) 2>/dev/null
  kill -9 $(lsof -t -i:$SEARCH_SERVICE_PORT) 2>/dev/null
fi
pkill -f "next-server" 2>/dev/null
pkill -f "next start" 2>/dev/null
pkill -f "chroma run" 2>/dev/null
pkill -f "scripts/proxy.cjs" 2>/dev/null
pkill -f "searx.webapp" 2>/dev/null
pkill -f "packages/services/search/server.js" 2>/dev/null

pkill -f "packages/tasks/scheduler.js" 2>/dev/null
pkill -f "packages/services/search" 2>/dev/null
pkill -f "searx.webapp" 2>/dev/null
pkill -f "scripts/log-wrap.js" 2>/dev/null
tailscale funnel reset 2>/dev/null
echo '已停止全部服务'
