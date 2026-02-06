#!/bin/bash

# Kill any process on port 8000 before starting
kill_port() {
  if command -v lsof &> /dev/null; then
    PID=$(lsof -t -i:8000 2>/dev/null)
    if [ -n "$PID" ]; then
      echo "Killing process on port 8000 (PID: $PID)"
      kill -9 $PID 2>/dev/null || true
    fi
  fi
}

# Trap signals to cleanup
cleanup() {
  echo "Shutting down..."
  kill_port
  exit 0
}

trap cleanup SIGINT SIGTERM

# Kill any existing process on port 8000
kill_port

# Start NestJS in watch mode
exec pnpm nest start --watch
