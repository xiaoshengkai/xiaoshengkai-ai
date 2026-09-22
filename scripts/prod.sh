#!/bin/bash
set -e

export BUILD_DIR=.next-prod
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 读取网络配置（统一真相源 config/network.json）
read_config() { node -e "console.log(require('./config/network.json').$1)"; }
LOCAL=$(read_config "hosts.local")
PUBLIC=$(read_config "hosts.public")
PROD_DIRECT=$(read_config "ports.aiChat.prodDirect")
PROXY_PORT=$(read_config "ports.aiChat.prodProxy")
SEARCH_PORT=$(read_config "ports.searchService")

# ── 0. 前置体检（新机/更新通用；硬失败给可执行提示，软缺失仅警告） ──
command -v node >/dev/null 2>&1 || { echo "❌ 缺 node：先装 Node.js >= 20"; exit 1; }
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 20 ] || { echo "❌ 需 Node >= 20（Next 16），当前 $(node -v)"; exit 1; }

[ -f .env ] || { echo "❌ 缺 .env：cp .env.example .env 并填齐密钥（公网部署 AUTH_PASSWORD/AUTH_SECRET 必需）"; exit 1; }
grep -q "^AUTH_PASSWORD=.\{8,\}" .env || { echo "❌ .env 缺 AUTH_PASSWORD（≥8 位）"; exit 1; }
grep -q "^AUTH_SECRET=.\{16,\}" .env || { echo "❌ .env 缺 AUTH_SECRET（生成：openssl rand -hex 32）"; exit 1; }
if grep -q "AUTH_PASSWORD=change-me-before-deploy" .env; then
  echo "⚠️  AUTH_PASSWORD 仍是占位值，上线前务必更换"
fi
grep -Eq "^(DEEPSEEK|QWEN|GLM|MINIMAX)_API_KEY=..+" .env || echo "⚠️  .env 无任何 LLM key：站点可起但聊天不可用"

if [ ! -d node_modules ]; then
  echo "── 首装依赖（几分钟）──"
  npm install
fi

command -v xz >/dev/null 2>&1 || echo "⚠️  缺 xz：ffmpeg 静态包解压需要（Linux 自动下载可能失败）"
if [ ! -d "$HOME/.cache/puppeteer" ]; then
  echo "── 自动安装 Chrome（PDF/漫画渲染用）──"
  npx puppeteer browsers install chrome || echo "⚠️  Chrome 安装失败：手动 npx puppeteer browsers install chrome"
fi

# ── 1. 静态二进制自动下载（仅 linux-x64；进 data/bin 并加入 PATH，子服务自动可见） ──
mkdir -p "$ROOT/data/bin"
export PATH="$ROOT/data/bin:$PATH"
if [ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ]; then
  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "── 自动下载 ffmpeg 静态版（npmmirror 优先，BtbN 兜底）──"
    { curl -fsSL --connect-timeout 10 --max-time 300 -o /tmp/ff.gz https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.1.1/ffmpeg-linux-x64.gz \
      || curl -fsSL --connect-timeout 10 --max-time 600 -o /tmp/ff.gz https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64.gz; } \
      && gunzip -f /tmp/ff.gz && mv /tmp/ff "$ROOT/data/bin/ffmpeg" && chmod +x "$ROOT/data/bin/ffmpeg" \
      || echo "⚠️  ffmpeg 自动下载失败：手动装（或本机代下 scp 后放 data/bin/）"
    rm -f /tmp/ff.gz
  fi
  if ! command -v pandoc >/dev/null 2>&1 && [ ! -f "$ROOT/data/bin/.pandoc-failed" ]; then
    echo "── 自动下载 pandoc 静态版 ──"
    curl -fsSL --connect-timeout 10 --max-time 300 -o /tmp/pandoc.tar.gz https://github.com/jgm/pandoc/releases/download/3.6.4/pandoc-3.6.4-linux-amd64.tar.gz \
      && tar -xzf /tmp/pandoc.tar.gz -C /tmp \
      && cp /tmp/pandoc-3.6.4/bin/pandoc "$ROOT/data/bin/" && chmod +x "$ROOT/data/bin/pandoc" \
      || { echo "⚠️  pandoc 自动下载失败：文档转换功能降级（删 data/bin/.pandoc-failed 可重试）"; touch "$ROOT/data/bin/.pandoc-failed"; }
    rm -f /tmp/pandoc.tar.gz
  fi
else
  command -v ffmpeg >/dev/null 2>&1 || echo "⚠️  缺 ffmpeg：brew install ffmpeg（视频工作流依赖）"
  command -v pandoc >/dev/null 2>&1 || echo "⚠️  缺 pandoc：brew install pandoc（文档转换依赖）"
fi
[ -d packages/services/search/searxng/searxng-src ] || echo "ℹ️  首次运行将自动 clone+install SearXNG（几分钟）"

# ── 2. 质量门禁（先于 stop：更新失败时旧版本继续服务） ──
npm run test
npm run typecheck
npm run build

# ── 3. 停旧服务 ──
npm run stop

# ── 4. 启动 ──
# 系统 chroma CLI 显式导出：遮蔽 node_modules/.bin 里的 node 版（老 glibc 服务器 dlopen 失败）
export CHROMA_CLI=$(command -v chroma || echo chroma)
# AI 工作台 (prodDirect，仅回环；公网流量经 proxy 进入)
nohup env BUILD_DIR=.next-prod npm run start -w packages/ai-chat -- -p $PROD_DIRECT -H $LOCAL > /tmp/xiaosheng-ai.log 2>&1 &
echo "AI 工作台已启动 → http://${LOCAL}:${PROD_DIRECT}"

# 反向代理 (proxyPort)；直连公网部署：PROXY_BIND=0.0.0.0 npm run prod
nohup node scripts/proxy.cjs > /tmp/proxy.log 2>&1 &
echo "代理已启动 → http://${PROXY_BIND:-$LOCAL}:${PROXY_PORT}（绑定：${PROXY_BIND:-仅回环}）"

# 定时任务调度器
nohup node packages/tasks/scheduler.js > /tmp/scheduler.log 2>&1 &
echo '定时任务调度器已启动'

# 本地 SearXNG（首次自动 clone+install）
nohup node scripts/log-wrap.js searxng -- bash packages/services/search/searxng/start.sh >/dev/null 2>&1 &
echo '搜索服务 SearXNG 已启动'

# 搜索编排服务
nohup node scripts/log-wrap.js search-service -- node packages/services/search/server.js >/dev/null 2>&1 &
echo '搜索编排服务已启动'

# ── 5. 公网暴露：tailscale 在跑走 funnel，否则直连部署 ──
# 公网基址推导（与 @app/shared/public-base.js 同规则）：IP→http://IP:PROXY_PORT，域名→https://
if [[ "$PUBLIC" =~ ^[0-9]+\.[0-9]+ ]]; then PUBLIC_URL="http://${PUBLIC}:${PROXY_PORT}"; else PUBLIC_URL="https://${PUBLIC}"; fi
if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
  tailscale funnel --bg --https=443 $PROXY_PORT
  echo '内网穿透已启动'
  echo "  - 博客:      ${PUBLIC_URL}"
  echo "  - AI 工作台: ${PUBLIC_URL}/ai/"
else
  echo 'tailscale 未运行或未安装，跳过 funnel（直连部署）'
  echo "  - 请自行在防火墙/安全组放行 ${PROXY_PORT}"
  echo "  - 博客:      ${PUBLIC_URL}"
  echo "  - AI 工作台: ${PUBLIC_URL}/ai/（需登录）"
fi

# ── 6. 启动后自检 ──
sleep 3
echo '── 启动后自检 ──'
check() {
  if curl -fs -o /dev/null -m 8 "$1"; then echo "  ✅ $2"; else echo "  ❌ $2 不可达: $1"; fi
}
check "http://${LOCAL}:${PROD_DIRECT}/ai/login" "AI 工作台登录页"
check "http://${LOCAL}:${PROXY_PORT}/" "博客代理"
check "http://${LOCAL}:${SEARCH_PORT}/health" "搜索编排服务"
