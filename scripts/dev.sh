#!/bin/bash
DEV_PORT=$(node -e "console.log(require('./config/network.json').ports.aiChat.dev)")

# 本地 SearXNG（首次自动 clone+install，后台运行）
nohup node scripts/log-wrap.js searxng -- bash packages/services/search/searxng/start.sh &
SEARXNG_PID=$!

# 搜索编排服务
nohup node scripts/log-wrap.js search-service -- node packages/services/search/server.js &
SEARCH_PID=$!

# 定时任务调度器
node packages/tasks/scheduler.js &
SCHEDULER_PID=$!

trap "kill $SCHEDULER_PID $SEARXNG_PID $SEARCH_PID 2>/dev/null" EXIT
# 只绑回环：dev 未配置 AUTH_PASSWORD 时鉴权放行，不能暴露给局域网
npm run dev -w packages/ai-chat -- -p $DEV_PORT -H 127.0.0.1
