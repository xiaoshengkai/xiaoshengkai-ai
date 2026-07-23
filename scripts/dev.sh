#!/bin/bash
node packages/tasks/scheduler.js &
SCHEDULER_PID=$!
trap "kill $SCHEDULER_PID 2>/dev/null" EXIT
npm run dev -w packages/ai-chat