#!/bin/bash
# 日志为追加写（时间正序），直接 tail 盯最新行
LOG="logs/app/app-$(date +%Y-%m-%d).log"
tail -n 40 -f "$LOG"