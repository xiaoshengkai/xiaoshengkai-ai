#!/bin/bash
# 部署同步工具（Mac ↔ 云服务器）
#   env            Mac→server 同步 .env（远端自动备份旧版 + chmod 600）
#   migrate-data   Mac→server 一次性全量迁移 data/（含 chroma；跑前两端停服）
#   backup         server→Mac 拉备份到 data-backup/（排除 chroma/bin；无 --delete）
#   install-cron   装定时备份（mac: LaunchDaemon 6h+wake 补跑+装即首跑；linux: 打印 cron 行）
#   uninstall-cron 卸定时备份
#   harden         服务器加固：sshd 关密码门（带回滚保险）+ fail2ban + 监听审计
# 目标解析：config/network.json deploy 块；DEPLOY_TARGET/DEPLOY_PATH 环境变量可覆盖
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

read_config() { node -e "console.log(require('./config/network.json').$1)"; }
DEPLOY_HOST=${DEPLOY_TARGET:-$(read_config deploy.host)}
DEPLOY_PATH=${DEPLOY_PATH:-$(read_config deploy.path)}
DEPLOY_PORT=$(read_config deploy.port)
SSH="ssh -o BatchMode=yes -p $DEPLOY_PORT $DEPLOY_HOST"
RSYNC_E="ssh -o BatchMode=yes -p $DEPLOY_PORT"
BACKUP_DIR="$ROOT/data-backup"
STATUS_FILE="$BACKUP_DIR/.backup-status.json"
LOCK_DIR="$BACKUP_DIR/.lock"
CRON_LABEL=com.xiaoshengkai.backup
# DRY_RUN=1 时 rsync 只演不传（验证参数/排除列表用）
DRY=${DRY_RUN:+--dry-run}

usage() {
  echo "用法: scripts/sync.sh <env|migrate-data|backup|install-cron|uninstall-cron|harden>"
  exit 1
}

preflight_local() {
  command -v rsync >/dev/null 2>&1 || { echo "❌ 缺 rsync"; exit 1; }
  $SSH true </dev/null 2>/dev/null || { echo "❌ ssh 免密不通: $DEPLOY_HOST（先 ssh-copy-id）"; exit 1; }
}

cmd_env() {
  preflight_local
  [ -f .env ] || { echo "❌ 本地缺 .env"; exit 1; }
  TS=$(date +%Y%m%d-%H%M%S)
  $SSH "cd $DEPLOY_PATH && { [ -f .env ] && cp .env .env.bak-$TS || true; }" </dev/null
  rsync -az $DRY -e "$RSYNC_E" .env "$DEPLOY_HOST:$DEPLOY_PATH/.env"
  $SSH "chmod 600 $DEPLOY_PATH/.env" </dev/null
  echo "✅ .env 已同步（远端旧版备份为 .env.bak-$TS）；远端需重启服务生效"
}

cmd_migrate_data() {
  preflight_local
  echo "⚠️  一次性迁移：本地 data/ 全量 → $DEPLOY_HOST:$DEPLOY_PATH/data/（含 chroma）"
  echo "    前提：两端服务均已停止（chroma 是活 sqlite，热拷会坏）"
  read -p "继续? [y/N] " ans
  [ "$ans" = "y" ] || { echo "已取消"; exit 0; }
  rsync -az $DRY --stats -e "$RSYNC_E" --exclude 'bin/' "$ROOT/data/" "$DEPLOY_HOST:$DEPLOY_PATH/data/"
  echo "✅ data/ 迁移完成"
}

cmd_backup() {
  preflight_local
  mkdir -p "$BACKUP_DIR"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "⚠️  已有备份在跑，本次退出"
    exit 0
  fi
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
  START=$(date +%s)
  set +e
  rsync -az $DRY -e "$RSYNC_E" \
    --exclude 'chroma/' --exclude 'bin/' --exclude '.lock/' --exclude '.backup-status.json' \
    "$DEPLOY_HOST:$DEPLOY_PATH/data/" "$BACKUP_DIR/"
  CODE=$?
  set -e
  DUR=$(( $(date +%s) - START ))
  printf '{ "ts": "%s", "exitCode": %d, "durationSec": %d, "target": "%s" }\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CODE" "$DUR" "$DEPLOY_HOST" > "$STATUS_FILE"
  if [ $CODE -eq 0 ]; then
    echo "✅ 备份完成（${DUR}s）→ data-backup/"
  else
    echo "❌ 备份失败 rsync exit=$CODE"
  fi
  exit $CODE
}

install_plist() { # $1 = plist 路径
  cat > "$1" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$CRON_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/sync.sh</string>
    <string>backup</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>0</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$ROOT/logs/backup.log</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/backup.log</string>
</dict>
</plist>
EOF
}

cmd_install_cron() {
  mkdir -p "$ROOT/logs"
  if [ "$(uname -s)" = "Darwin" ]; then
    if [ "$(id -u)" = "0" ]; then
      PLIST="/Library/LaunchDaemons/$CRON_LABEL.plist"
      DOMAIN="system"
    else
      mkdir -p "$HOME/Library/LaunchAgents"
      PLIST="$HOME/Library/LaunchAgents/$CRON_LABEL.plist"
      DOMAIN="gui/$(id -u)"
    fi
    install_plist "$PLIST"
    launchctl bootout "$DOMAIN/$CRON_LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "✅ 定时备份已装（每 6h + 装即首跑 + 睡眠错过 wake 补跑）→ $PLIST"
  else
    echo "Linux 请自行挂 cron："
    echo "  0 */6 * * * cd $ROOT && scripts/sync.sh backup >> logs/backup.log 2>&1"
  fi
}

cmd_uninstall_cron() {
  if [ "$(uname -s)" != "Darwin" ]; then echo "Linux：手动删 crontab 行"; exit 0; fi
  if [ -f "/Library/LaunchDaemons/$CRON_LABEL.plist" ]; then
    launchctl bootout "system/$CRON_LABEL" 2>/dev/null || true
    rm -f "/Library/LaunchDaemons/$CRON_LABEL.plist"
  fi
  if [ -f "$HOME/Library/LaunchAgents/$CRON_LABEL.plist" ]; then
    launchctl bootout "gui/$(id -u)/$CRON_LABEL" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/$CRON_LABEL.plist"
  fi
  echo "✅ 定时备份已卸"
}

cmd_harden() {
  preflight_local
  echo "── 服务器加固：sshd 关密码门 + fail2ban + 监听审计 ──"
  $SSH 'bash -s' <<'REMOTE'
set -e
CFG=/etc/ssh/sshd_config
BAK=/etc/ssh/sshd_config.bak-prehardened
[ -f "$BAK" ] || cp "$CFG" "$BAK"
if grep -q "^PasswordAuthentication no" "$CFG" && grep -q "^PermitRootLogin prohibit-password" "$CFG"; then
  echo "sshd 已加固，跳过配置改动"
else
  sed -i -e 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
       -e 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' "$CFG"
  # 回滚保险：90s 内未见 /root/.sshd-ok 标记则自动还原配置并重启（防锁死）
  nohup sh -c 'sleep 90; [ -f /root/.sshd-ok ] || { cp /etc/ssh/sshd_config.bak-prehardened /etc/ssh/sshd_config; systemctl restart sshd; echo "sshd 自动回滚" >> /var/log/sshd-rollback.log; }' >/dev/null 2>&1 &
  sshd -t
  systemctl restart sshd
  echo "sshd 已关密码登录（90s 回滚保险已挂）"
fi
if ! command -v fail2ban-client >/dev/null 2>&1; then
  (command -v dnf >/dev/null && dnf install -y fail2ban fail2ban-sshd) \
    || (command -v yum >/dev/null && yum install -y fail2ban fail2ban-sshd) \
    || (command -v apt-get >/dev/null && apt-get install -y fail2ban) \
    || echo "⚠️  fail2ban 自动安装失败（源缺失？），手动装"
fi
if command -v fail2ban-client >/dev/null 2>&1; then
  mkdir -p /etc/fail2ban/jail.d
  printf '[sshd]\nenabled = true\nmaxretry = 3\nbantime = 1h\n' > /etc/fail2ban/jail.d/sshd.local
  systemctl enable --now fail2ban >/dev/null 2>&1 || true
  fail2ban-client reload >/dev/null 2>&1 || true
  echo "fail2ban 已启用（sshd 3 次失败 ban 1h）"
fi
echo "--- 监听端口审计 ---"
ss -tlnp | grep LISTEN | awk '{print $4, $6}'
REMOTE
  sleep 2
  if $SSH 'touch /root/.sshd-ok; echo REVERIFY_OK' </dev/null; then
    echo "✅ harden 完成（密钥复验通过，回滚保险已取消）"
  else
    echo "❌ 密钥复验失败！90s 内服务器将自动回滚 sshd 配置"
    exit 1
  fi
}

case "${1:-}" in
  env) cmd_env ;;
  migrate-data) cmd_migrate_data ;;
  backup) cmd_backup ;;
  install-cron) cmd_install_cron ;;
  uninstall-cron) cmd_uninstall_cron ;;
  harden) cmd_harden ;;
  *) usage ;;
esac
