#!/bin/bash

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCK_FILE="/tmp/app_v1_start.lock"
BACKEND_LOG="/tmp/app_v1_backend.log"
FRONTEND_LOG="/tmp/app_v1_frontend.log"
MAX_LOG_LINES=2000
LOG_TRIM_INTERVAL=2

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "已有一个 start.sh 实例在运行，请先停止后再启动。"
    exit 1
fi

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
trim_log(){ local f="$1"; [ -f "$f" ] || return 0; local n; n=$(wc -l <"$f" 2>/dev/null || echo 0); [ "$n" -le "$MAX_LOG_LINES" ] && return 0; tail -n "$MAX_LOG_LINES" "$f" >"${f}.tmp" 2>/dev/null && mv "${f}.tmp" "$f"; }
log_window_loop(){ while true; do trim_log "$BACKEND_LOG"; trim_log "$FRONTEND_LOG"; sleep "$LOG_TRIM_INTERVAL"; done; }

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   AI 图像生成网站 - 一键启动${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 清理旧进程（先按端口清理，再按进程名兜底）
echo -e "${YELLOW}[清理] 终止旧的 uvicorn/vite-preview 进程...${NC}"
# 按端口清理 uvicorn
PORT_PID=$(lsof -ti :8002 2>/dev/null || fuser 8002/tcp 2>/dev/null || true)
if [ -n "$PORT_PID" ]; then
    echo "$PORT_PID" | xargs kill -9 2>/dev/null || true
    echo -e "  已清理端口 8002: $PORT_PID"
fi
# 按端口清理 preview
PREVIEW_PID=$(lsof -ti :5174 2>/dev/null || fuser 5174/tcp 2>/dev/null || true)
if [ -n "$PREVIEW_PID" ]; then
    echo "$PREVIEW_PID" | xargs kill -9 2>/dev/null || true
    echo -e "  已清理端口 5174: $PREVIEW_PID"
fi
# 按名称兜底清理
for PATTERN in "uvicorn backend.main" "vite preview" "vite"; do
    PIDS=$(pgrep -f "$PATTERN" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        echo "$PIDS" | xargs kill -9 2>/dev/null || true
        echo -e "  已清理 $PATTERN: $PIDS"
    fi
done
echo ""

# 检查 .env 是否存在
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${RED}[错误] 未找到 .env 文件，请先复制 .env.example 为 .env 并填写配置${NC}"
    echo "    cp .env.example .env"
    exit 1
fi

# 检查后端依赖
echo -e "${YELLOW}[1/4] 检查后端依赖...${NC}"
python3 -m pip install -q -r "$PROJECT_DIR/backend/requirements.txt"

# 检查前端依赖
echo -e "${YELLOW}[2/4] 检查前端依赖...${NC}"
if [ ! -d "$PROJECT_DIR/frontend/node_modules" ]; then
    cd "$PROJECT_DIR/frontend" && npm install
fi

# 构建前端静态文件，保证 5173 与 5174 同源
echo -e "${YELLOW}[3/4] 构建前端静态文件...${NC}"
cd "$PROJECT_DIR/frontend" && npm run build

# 获取 Tailscale IP
TAILSCALE_IP=$(ip -4 addr show tailscale0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1 || echo "localhost")
LOCAL_IP="127.0.0.1"

echo ""
echo -e "${GREEN}[4/4] 启动服务...${NC}"
echo -e "  本地访问(静态): ${YELLOW}http://${LOCAL_IP}:5173${NC}"
echo -e "  本地访问(预览): ${YELLOW}http://${LOCAL_IP}:5174${NC}"
if [ -n "$TAILSCALE_IP" ] && [ "$TAILSCALE_IP" != "localhost" ]; then
    echo -e "  Tailscale 访问(静态): ${YELLOW}http://${TAILSCALE_IP}:5173${NC}"
    echo -e "  Tailscale 访问(预览): ${YELLOW}http://${TAILSCALE_IP}:5174${NC}"
fi
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   按 Ctrl+C 停止所有服务${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  后端日志: ${YELLOW}${BACKEND_LOG}${NC}"
echo -e "  前端日志: ${YELLOW}${FRONTEND_LOG}${NC}"
echo ""

# 启动后端（稳定模式，不使用 --reload）
cd "$PROJECT_DIR"
python3 -u -m uvicorn backend.main:app --host ${LOCAL_IP} --port 8002 >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

# 等待后端启动
for i in {1..20}; do
    if curl -fsS "http://${LOCAL_IP}:8002/api/health" >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done

# 启动前端预览（读取同一份 dist，与 5173 一致）
cd "$PROJECT_DIR/frontend"
npm run preview -- --host 0.0.0.0 --port 5174 --strictPort >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
log_window_loop &
LOG_WINDOW_PID=$!

# 捕获 Ctrl+C 停止所有进程
trap 'echo ""; echo -e "${YELLOW}正在停止服务...${NC}"; kill $BACKEND_PID 2>/dev/null; kill $FRONTEND_PID 2>/dev/null; kill $LOG_WINDOW_PID 2>/dev/null; wait 2>/dev/null; echo -e "${GREEN}已停止${NC}"; exit 0' INT TERM

wait
