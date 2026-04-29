#!/usr/bin/env bash
# ClippingHub launcher (macOS / Linux mirror of START.bat)
# Run from anywhere — script always cds to its own directory first.

set -e
cd "$(dirname "$0")"

# Detect open-browser command per OS
open_browser() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
  fi
}

# Run server in background, capture its PID, ensure it's killed on exit.
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo
    echo "  Stopping server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

run_both() {
  echo
  echo "  Starting server in background..."
  ( cd server && npm run dev ) &
  SERVER_PID=$!
  echo "  Waiting for server to come up..."
  sleep 3
  echo "  Opening admin in default browser..."
  open_browser "http://localhost:3535/admin"
  echo "  Starting app..."
  echo
  npm start
}

run_server_only() {
  echo
  echo "  Starting server (Ctrl+C to stop)..."
  echo
  cd server && npm run dev
}

run_app_only() {
  echo
  echo "  Starting app (Ctrl+C to stop)..."
  echo
  npm start
}

# Allow flag-based invocation for CI / scripting.
case "${1:-}" in
  --server-only) run_server_only; exit 0 ;;
  --app-only)    run_app_only;    exit 0 ;;
  --both)        run_both;        exit 0 ;;
esac

while true; do
  clear || true
  echo
  echo "  ============================================"
  echo "           ClippingHub Launcher"
  echo "  ============================================"
  echo
  echo "    [1]  Run server + app"
  echo "    [2]  Run server only"
  echo "    [3]  Run app only"
  echo "    [4]  Quit"
  echo
  echo "  ============================================"
  read -rp "   Choose an option [1-4]: " choice
  case "$choice" in
    1) run_both;        break ;;
    2) run_server_only; break ;;
    3) run_app_only;    break ;;
    4) exit 0 ;;
    *) echo "  Invalid choice."; sleep 1 ;;
  esac
done
