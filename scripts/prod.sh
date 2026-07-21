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

# 博客 (4321)
if lsof -ti:4321 > /dev/null 2>&1; then
  echo '博客已在运行 → http://localhost:4321'
else
  nohup npx serve site -l 4321 --no-clipboard > /tmp/blog.log 2>&1 &
  echo '博客已启动 → http://localhost:4321'
fi

# Tailscale Funnel
tailscale funnel --bg --https=443 4321
tailscale funnel --bg --https=8443 4567
echo '内网穿透已启动'
echo '  博客: https://node.tailddce43.ts.net'
echo '  AI:   https://node.tailddce43.ts.net:8443'