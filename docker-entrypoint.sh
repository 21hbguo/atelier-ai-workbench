#!/bin/bash
set -e

# Run database migrations
cd /app
alembic upgrade head 2>/dev/null || echo "alembic skipped (no migrations or DB not ready)"

# Start backend in background
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8002 &
BACKEND_PID=$!

# Wait for backend
for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8002/api/health >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

# Start nginx in foreground
nginx -g 'daemon off;'
