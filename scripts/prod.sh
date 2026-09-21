#!/bin/bash
set -e

export BUILD_DIR=.next-prod

# 读取网络配置（统一真相源 config/network.json）
read_config() { node -e "console.log(require('./config/network.json').$1)"; }
LOCAL=$(read_config "hosts.local")
PUBLIC=$(read_config "hosts.public")
PROD_DIRECT=$(read_config "ports.aiChat.prodDirect")
PROXY_PORT=$(read_config "ports.aiChat.prodProxy")

# 停止全部服务
npm run stop

# 质量门禁：测试 + 类型检查必须通过才构建
npm run test
npm run typecheck

# 重新构建
npm run build

# AI 工作台 (prodDirect)——只绑回环，公网经 funnel→proxy.cjs 本机转发，局域网不可直连
nohup env BUILD_DIR=.next-prod npm run start -w packages/ai-chat -- -p $PROD_DIRECT -H $LOCAL > /tmp/xiaosheng-ai.log 2>&1 &
echo "AI 工作台已启动 → http://${LOCAL}:${PROD_DIRECT}"

# 反向代理 (proxyPort)
nohup node scripts/proxy.cjs > /tmp/proxy.log 2>&1 &
echo "代理已启动 → http://${LOCAL}:${PROXY_PORT}"

# 定时任务调度器
nohup node packages/tasks/scheduler.js > /tmp/scheduler.log 2>&1 &
echo '定时任务调度器已启动'

# 本地 SearXNG（首次自动 clone+install）
nohup node scripts/log-wrap.js searxng -- bash packages/services/search/searxng/start.sh &
echo '搜索服务 SearXNG 已启动'

# 搜索编排服务
nohup node scripts/log-wrap.js search-service -- node packages/services/search/server.js &
echo '搜索编排服务已启动'

# Tailscale Funnel
tailscale funnel --bg --https=443 $PROXY_PORT
echo '内网穿透已启动'
echo "  - 博客:      https://${PUBLIC}"
echo "  - AI 工作台: https://${PUBLIC}/ai/"