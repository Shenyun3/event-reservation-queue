#!/usr/bin/env bash
# 本地开发一键启动脚本：将前后端日志分别落盘至 .logs/backend.log 与 .logs/frontend.log
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "${ROOT_DIR}/.logs"

: > "${ROOT_DIR}/.logs/backend.log"
: > "${ROOT_DIR}/.logs/frontend.log"

cleanup() {
  trap - INT TERM EXIT
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

pnpm --filter @queue-reservation/backend dev > >(tee -a "${ROOT_DIR}/.logs/backend.log") 2>&1 &
pnpm --filter @queue-reservation/frontend dev > >(tee -a "${ROOT_DIR}/.logs/frontend.log") 2>&1 &

wait
