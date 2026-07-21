#!/bin/bash
set -e

export BUILD_DIR=.next-prod

# 构建
test -d packages/ai-chat/.next-prod || npm run build

# Chroma (8000)
lsof -ti:8000 > /dev/null 2>&1 || chroma run --path data/chroma --port 8000 &

# AI 工作台 (4567)
if lsof -ti:4567 > /dev/null 2>&1; then
  echo 'AI 工作台已在运行 → http://localhost:4567'
else
  nohup env BUILD_DIR=.next-prod npm run start -w packages/ai-chat -- -p 4567 > /tmp/xiaosheng-ai.log 2>&1 &
  echo 'AI 工作台已启动 → http://localhost:4567'
fi

# 反向代理 (4321): AI 工作台 + 博客
if lsof -ti:4321 > /dev/null 2>&1; then
  echo '代理已在运行 → http://localhost:4321'
else
  nohup node scripts/proxy.js > /tmp/proxy.log 2>&1 &
  echo '代理已启动 → http://localhost:4321'
fi

# Tailscale Funnel (仅 443)
tailscale funnel --bg --https=443 4321
echo '内网穿透已启动'
echo '  AI 工作台: https://node.tailddce43.ts.net'
echo '  博客:      https://node.tailddce43.ts.net/blog/'