#!/bin/bash
kill -9 $(lsof -t -i:4567) 2>/dev/null
kill -9 $(lsof -t -i:8000) 2>/dev/null
kill -9 $(lsof -t -i:4321) 2>/dev/null
tailscale funnel reset 2>/dev/null
echo '已停止全部服务'