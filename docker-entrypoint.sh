#!/bin/bash
set -e

cd /app
alembic upgrade head 2>/dev/null || echo "alembic skipped (no migrations or DB not ready)"
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8002 --proxy-headers --forwarded-allow-ips=127.0.0.1 &
BACKEND_PID=$!
for i in $(seq 1 30); do
    if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
        wait "$BACKEND_PID"
    fi
    if curl -fsS http://127.0.0.1:8002/api/health >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
if ! curl -fsS http://127.0.0.1:8002/api/health >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
    wait "$BACKEND_PID" >/dev/null 2>&1 || true
    exit 1
fi
nginx -g 'daemon off;' &
NGINX_PID=$!
wait -n "$BACKEND_PID" "$NGINX_PID"
STATUS=$?
kill "$BACKEND_PID" "$NGINX_PID" >/dev/null 2>&1 || true
wait "$BACKEND_PID" "$NGINX_PID" >/dev/null 2>&1 || true
exit "$STATUS"
