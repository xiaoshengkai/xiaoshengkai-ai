#!/bin/bash
if lsof -ti:4321 > /dev/null 2>&1; then
  echo '博客已在运行 → http://localhost:4321'
else
  npx serve site -l 4321
fi