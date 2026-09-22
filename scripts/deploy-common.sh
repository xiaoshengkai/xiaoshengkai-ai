#!/bin/bash
# 部署共享解析：sync.sh / deploy.sh 共用（source 引入）
# 目标解析优先级：环境变量/CLI > 仓库根 .env 文件 > 报错
# 换云服务器 = 改 .env 的 DEPLOY_TARGET/DEPLOY_PATH 一行

resolve_deploy_env() {
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  read_env() {
    [ -n "${!1:-}" ] && { echo "${!1}"; return; }
    awk -F= -v k="$1" '$1==k {v=$2; sub(/^"/,"",v); sub(/"$/,"",v); print v; exit}' "$ROOT/.env" 2>/dev/null
  }
  DEPLOY_HOST=$(read_env DEPLOY_TARGET)
  DEPLOY_PATH=$(read_env DEPLOY_PATH)
  DEPLOY_PORT=$(read_env DEPLOY_PORT)
  DEPLOY_PORT=${DEPLOY_PORT:-22}
  DEPLOY_PATH=${DEPLOY_PATH:-/root/xiaoshengkai-ai}
  if [ -z "$DEPLOY_HOST" ]; then
    echo "❌ 未配置 DEPLOY_TARGET（.env 或环境变量，格式 user@host）"
    exit 1
  fi
  SSH="ssh -o BatchMode=yes -p $DEPLOY_PORT $DEPLOY_HOST"
  RSYNC_E="ssh -o BatchMode=yes -p $DEPLOY_PORT"
}

# 公网基址（与 @app/shared/public-base.js 同规则，单源调用避免 bash 重复推导）
public_url() {
  (cd "$ROOT" && DEPLOY_TARGET="$(read_env DEPLOY_TARGET)" PUBLIC_BASE="$(read_env PUBLIC_BASE)" PUBLIC_PORT="$(read_env PUBLIC_PORT)" \
    node --input-type=module -e "import { publicBase } from './packages/shared/public-base.js'; console.log(publicBase())")
}
