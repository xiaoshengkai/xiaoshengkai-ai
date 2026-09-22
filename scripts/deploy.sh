#!/bin/bash
# 云服务器发布编排（Mac 侧执行）——永远部署 master
#   1 前置：ssh 免密 / 并发锁
#   2 push origin master（失败仅警告，CN 网络不拦部署）
#   3 服务器：脏检查中止 / 分支=master 校验
#   4 timeout 90 git pull --ff-only origin master；失败 → Mac 打 bundle 兜底送达
#   5 ssh -f 分离启动 prod.sh（EXIT trap 写 /tmp/prod-last-status）
#   6 轮询状态 ≤25min；超时仍跑冒烟兜底判断
#   7 Mac 公网冒烟五连（login200 / 未登录API401 / 博客200 / 登录200 / 带Cookie API200）
# 回滚 = Mac 上 git revert <sha> 后重跑本脚本（服务器永远 ff 前进，无强 reset）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/deploy-common.sh"
resolve_deploy_env

LOCK=/tmp/xsk-deploy.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "❌ 已有 deploy 在跑（$LOCK）"; exit 1
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

PUB=$(public_url)
STATUS=/tmp/prod-last-status
DEPLOY_START_TS=$(date -u +%FT%TZ)
echo "══ deploy → $DEPLOY_HOST:$DEPLOY_PATH | 公网 $PUB ══"

# 1 前置
$SSH true </dev/null || { echo "❌ ssh 免密不通：$DEPLOY_HOST"; exit 1; }

# 2 push（非致命）
git push origin master 2>/dev/null && echo "── push origin ✓" || echo "⚠️  push origin 失败（CN？），bundle 兜底继续"

# 3 服务器状态检查
SERVER_SHA=$($SSH 'cd '"$DEPLOY_PATH"' && git rev-parse HEAD' </dev/null)
DIRTY=$($SSH 'cd '"$DEPLOY_PATH"' && git status --porcelain --untracked-files=no | head -5' </dev/null)
if [ -n "$DIRTY" ]; then
  echo "❌ 服务器工作区脏，中止（人工处理）："; echo "$DIRTY"; exit 1
fi
BRANCH=$($SSH 'cd '"$DEPLOY_PATH"' && git rev-parse --abbrev-ref HEAD' </dev/null)
[ "$BRANCH" = "master" ] || { echo "❌ 服务器分支=$BRANCH（非 master），中止"; exit 1; }

# 4 拉取 master：origin 优先，bundle 兜底；无新提交直接进 prod.sh
LOCAL_SHA=$(git rev-parse master)
if [ "$LOCAL_SHA" = "$SERVER_SHA" ]; then
  echo "── 无新提交（服务器已是 master 最新），直接重跑 prod.sh"
elif $SSH 'cd '"$DEPLOY_PATH"' && timeout 90 git pull --ff-only origin master' </dev/null; then
  echo "── 服务器 git pull origin ✓"
else
  echo "── origin pull 失败/超时 → bundle 兜底"
  BUNDLE=/tmp/deploy-auto.bundle
  rm -f "$BUNDLE"
  git bundle create "$BUNDLE" master "^$SERVER_SHA"
  scp -q -P "$DEPLOY_PORT" "$BUNDLE" "$DEPLOY_HOST:/tmp/deploy-auto.bundle"
  $SSH 'cd '"$DEPLOY_PATH"' && git pull --ff-only /tmp/deploy-auto.bundle master && rm -f /tmp/deploy-auto.bundle' </dev/null
  rm -f "$BUNDLE"
  echo "── bundle 送达 ✓"
fi

# 5 启动 prod.sh（分离，不吊 ssh）
$SSH 'cd '"$DEPLOY_PATH"' && rm -f '"$STATUS"'; setsid nohup env PROXY_BIND=0.0.0.0 npm_config_onnxruntime_node_install_cuda=skip bash scripts/prod.sh > /tmp/prod-server.log 2>&1 < /dev/null & exit 0' </dev/null
echo "── prod.sh 已在服务器启动，轮询 $STATUS（≤25min）"

# 6 轮询
DEADLINE=$(( $(date +%s) + 1500 ))
RESULT=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  sleep 30
  LINE=$($SSH 'cat '"$STATUS"' 2>/dev/null' </dev/null || true)
  if [ -n "$LINE" ]; then
    CODE=$(echo "$LINE" | awk '{print $1}'); TS=$(echo "$LINE" | awk '{print $2}')
    if [[ "$TS" > "$DEPLOY_START_TS" || "$TS" == "$DEPLOY_START_TS" ]]; then RESULT=$CODE; break; fi
  fi
done

# 7 冒烟（超时也跑，作兜底判断）
smoke() {
  local ok=1
  [ "$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$PUB/ai/login")" = "200" ] || { echo "  ❌ login页"; ok=0; }
  [ "$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$PUB/ai/api/conversations/getList")" = "401" ] || { echo "  ❌ 未登录API应401"; ok=0; }
  [ "$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$PUB/")" = "200" ] || { echo "  ❌ 博客"; ok=0; }
  local PW
  PW=$(awk '/^AUTH_PASSWORD=/{sub(/^AUTH_PASSWORD=/,""); print; exit}' "$ROOT/.env")
  local CJ=/tmp/deploy-smoke-cookies.txt
  rm -f "$CJ"
  [ "$(curl -s -m 20 -X POST "$PUB/ai/api/auth/login" -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" -c "$CJ" -o /dev/null -w '%{http_code}')" = "200" ] || { echo "  ❌ 登录"; ok=0; }
  [ "$(curl -s -o /dev/null -m 15 -b "$CJ" -w '%{http_code}' "$PUB/ai/api/conversations/getList")" = "200" ] || { echo "  ❌ 带Cookie API"; ok=0; }
  rm -f "$CJ"
  return $((1 - ok))
}
echo "── 公网冒烟 ──"
if smoke; then
  if [ -n "$RESULT" ] && [ "$RESULT" != "0" ]; then
    echo "⚠️  prod.sh exit=$RESULT 但冒烟全过——人工复查 /tmp/prod-server.log"
    exit 1
  fi
  if [ -z "$RESULT" ]; then
    echo "⚠️  状态文件缺失（prod.sh 被 kill -9？或仍在跑）但冒烟全过"
  fi
  echo "✅ deploy 完成：$PUB/ai/"
else
  echo "❌ 冒烟失败（prod exit=${RESULT:-timeout}）——ssh 上去看 /tmp/prod-server.log"
  exit 1
fi

# 单跑冒烟子命令（函数定义之后）
if [ "${1:-}" = "smoke" ]; then
  echo "── 公网冒烟（仅） $PUB ──"
  if smoke; then echo "✅ 冒烟全绿"; else echo "❌ 冒烟失败"; exit 1; fi
fi
