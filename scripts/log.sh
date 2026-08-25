#!/bin/bash
# 日志为倒序（新日志写文件顶部），tail -f 盯底部看不到新行，改为轮询头部
LOG="logs/app/app-$(date +%Y-%m-%d).log"
while true; do
  clear 2>/dev/null
  head -40 "$LOG"
  sleep 2
done
