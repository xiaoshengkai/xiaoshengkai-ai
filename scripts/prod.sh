#!/bin/bash
set -e

export BUILD_DIR=.next-prod

# 构建
test -d packages/ai-chat/.next-prod || npm run build

# AI 工作台 (4567)
kill $(lsof -t -i:4567) 2>/dev/null || true
sleep 1
nohup env BUILD_DIR=.next-prod npm run start -w packages/ai-chat -- -p 4567 > /tmp/xiaosheng-ai.log 2>&1 &
echo 'AI 工作台已启动 → http://localhost:4567'

# 反向代理 (4321): AI 工作台 + 博客
kill $(lsof -t -i:4321) 2>/dev/null || true
sleep 1
nohup node scripts/proxy.cjs > /tmp/proxy.log 2>&1 &
echo '代理已启动 → http://localhost:4321'

# Tailscale Funnel
tailscale funnel --bg --https=443 4321
echo '内网穿透已启动'
echo '  AI 工作台: https://node.tailddce43.ts.net'
echo '  博客:      https://node.tailddce43.ts.net/blog/'