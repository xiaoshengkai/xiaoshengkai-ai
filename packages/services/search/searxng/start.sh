#!/bin/bash
# SearXNG 本地服务：clone → venv → install → run
# 端口从 config/network.json 读取（单一真相源）
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SEARXNG_DIR="$SCRIPT_DIR"
SRC_DIR="$SEARXNG_DIR/searxng-src"
VENV_DIR="$SEARXNG_DIR/venv"
SETTINGS="$SEARXNG_DIR/settings.yml"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PORT=$(node -e "console.log(require('$PROJECT_ROOT/config/network.json').ports.searxng)")
BIND_ADDRESS=$(node -e "console.log(require('$PROJECT_ROOT/config/network.json').hosts.local)")

echo "[searxng] port=$PORT"

# 1. clone 源码（首次）
if [ ! -d "$SRC_DIR/.git" ]; then
  echo "[searxng] clone searxng ..."
  git clone --depth 1 https://github.com/searxng/searxng "$SRC_DIR"
fi

# 2. venv（首次）
if [ ! -d "$VENV_DIR/bin" ]; then
  echo "[searxng] create venv ..."
  python3 -m venv "$VENV_DIR"
fi

PY="$VENV_DIR/bin/python"

# 3. 安装依赖（首次，用标记文件判断）
if [ ! -f "$VENV_DIR/.installed" ]; then
  echo "[searxng] install dependencies ..."
  "$PY" -m pip install -U pip wheel setuptools
  "$PY" -m pip install pyyaml msgspec typing-extensions pybind11
  (cd "$SRC_DIR" && "$PY" -m pip install --use-pep517 --no-build-isolation -e .)
  touch "$VENV_DIR/.installed"
fi

echo "[searxng] start webapp on $BIND_ADDRESS:$PORT"
cd "$SRC_DIR"
SEARXNG_SETTINGS_PATH="$SETTINGS" \
SEARXNG_PORT="$PORT" \
SEARXNG_BIND_ADDRESS="$BIND_ADDRESS" \
exec "$PY" -m searx.webapp
