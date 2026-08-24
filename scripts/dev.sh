#!/bin/bash
DEV_PORT=$(node -e "console.log(require('./config/network.json').ports.aiChat.dev)")

# 本地 SearXNG（首次自动 clone+install，后台运行）
nohup bash packages/services/search/searxng/start.sh > logs/app/searxng.log 2>&1 &
SEARXNG_PID=$!

# 搜索编排服务
nohup node packages/services/search/server.js > logs/app/search-service.log 2>&1 &
SEARCH_PID=$!

# 定时任务调度器
node packages/tasks/scheduler.js &
SCHEDULER_PID=$!

trap "kill $SCHEDULER_PID $SEARXNG_PID $SEARCH_PID 2>/dev/null" EXIT
npm run dev -w packages/ai-chat -- -p $DEV_PORT
