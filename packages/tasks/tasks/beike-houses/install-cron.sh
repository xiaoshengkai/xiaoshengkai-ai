#!/usr/bin/env bash
# beike-houses Mac 侧定时触发安装（LaunchAgent，仿 sync.sh install-cron 惯例）
#
# 用法：bash packages/tasks/tasks/beike-houses/install-cron.sh [install|uninstall]
#
# 为什么不用 scheduler.js：Mac 上没有常驻 scheduler（任务跑在服务器），beike-houses
# 只能 Mac 跑（云 IP 被贝壳 CAPTCHA 限制 ~30 请求）；LaunchAgent 直接调 index.js。
# launchd 优势：开机登录自启 + 睡眠错过的日历点唤醒后自动补跑。
set -euo pipefail

LABEL="com.xiaoshengkai.beike-houses"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
NODE_BIN="$(command -v node || echo /usr/local/bin/node)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$ROOT/logs/tasks/beike-houses-cron.log"
ACTION="${1:-install}"

if [ "$(uname -s)" != "Darwin" ]; then echo "仅 macOS（本任务只在 Mac 侧运行）"; exit 1; fi
# root 防呆：root 的 launchctl load 会把用户 agent 装进 system 域 → 与 gui 域双注册双跑
if [ "$(id -u)" = "0" ]; then
  echo "✗ 请以普通用户（zcy）运行本脚本；root 会把 LaunchAgent 装进 system 域导致双跑"
  exit 1
fi

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✅ $LABEL 已卸载"
}

install_agent() {
  mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/logs/tasks"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>cd $ROOT && "$NODE_BIN" --env-file=.env packages/tasks/tasks/beike-houses/index.js</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>20</integer><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "✅ ${LABEL} 已装载（每日 7:30 + 12:30 + 20:30，日志 ${LOG}）"
  echo "   手动触发验证：launchctl kickstart gui/$(id -u)/$LABEL"
}

case "$ACTION" in
  install) install_agent ;;
  uninstall) uninstall ;;
  *) echo "用法: $0 [install|uninstall]"; exit 1 ;;
esac
