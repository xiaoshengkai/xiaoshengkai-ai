#!/bin/bash
DEV_PORT=$(node -e "console.log(require('./config/network.json').ports.aiChat.dev)")
node packages/tasks/scheduler.js &
SCHEDULER_PID=$!
trap "kill $SCHEDULER_PID 2>/dev/null" EXIT
npm run dev -w packages/ai-chat -- -p $DEV_PORT