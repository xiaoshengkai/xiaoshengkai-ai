#!/bin/bash
set -e

export BUILD_DIR=.next-prod

# 停止全部服务
npm run stop

# 重新构建
npm run build

# AI 工作台 (4567)
nohup env BUILD_DIR=.next-prod npm run start -w packages/ai-chat -- -p 4567 > /tmp/xiaosheng-ai.log 2>&1 &
echo 'AI 工作台已启动 → http://localhost:4567'

# 反向代理 (4321)
nohup node scripts/proxy.cjs > /tmp/proxy.log 2>&1 &
echo '代理已启动 → http://localhost:4321'

# 定时任务调度器
nohup node packages/tasks/scheduler.js > /tmp/scheduler.log 2>&1 &
echo '定时任务调度器已启动'

# Tailscale Funnel
tailscale funnel --bg --https=443 4321
echo '内网穿透已启动'
echo '  博客:      https://node.tailddce43.ts.net'
echo '  AI 工作台: https://node.tailddce43.ts.net/ai/'