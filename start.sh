#!/bin/bash

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   AI 图像生成网站 - 一键启动${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 清理旧进程（先按端口清理，再按进程名兜底）
echo -e "${YELLOW}[清理] 终止旧的 uvicorn/vite 进程...${NC}"
# 按端口清理 uvicorn
PORT_PID=$(lsof -ti :8002 2>/dev/null || fuser 8002/tcp 2>/dev/null || true)
if [ -n "$PORT_PID" ]; then
    echo "$PORT_PID" | xargs kill -9 2>/dev/null || true
    echo -e "  已清理端口 8002: $PORT_PID"
fi
# 按名称兜底清理
for PATTERN in "uvicorn backend.main" "vite"; do
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
echo -e "${YELLOW}[1/3] 检查后端依赖...${NC}"
python3 -m pip install -q -r "$PROJECT_DIR/backend/requirements.txt"

# 检查前端依赖
echo -e "${YELLOW}[2/3] 检查前端依赖...${NC}"
if [ ! -d "$PROJECT_DIR/frontend/node_modules" ]; then
    cd "$PROJECT_DIR/frontend" && npm install
fi

# 获取 Tailscale IP
TAILSCALE_IP=$(ip -4 addr show tailscale0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1 || echo "localhost")
LOCAL_IP="127.0.0.1"

echo ""
echo -e "${GREEN}[3/3] 启动服务...${NC}"
echo -e "  本地访问: ${YELLOW}http://${LOCAL_IP}:5173${NC}"
if [ -n "$TAILSCALE_IP" ] && [ "$TAILSCALE_IP" != "localhost" ]; then
    echo -e "  Tailscale 访问: ${YELLOW}http://${TAILSCALE_IP}:5173${NC}"
fi
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   按 Ctrl+C 停止所有服务${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 启动后端
cd "$PROJECT_DIR"
python3 -m uvicorn backend.main:app --host ${LOCAL_IP} --port 8002 --reload &
BACKEND_PID=$!

# 等待后端启动
sleep 2

# 启动前端
cd "$PROJECT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

# 捕获 Ctrl+C 停止所有进程
trap 'echo ""; echo -e "${YELLOW}正在停止服务...${NC}"; kill $BACKEND_PID 2>/dev/null; kill $FRONTEND_PID 2>/dev/null; wait 2>/dev/null; echo -e "${GREEN}已停止${NC}"; exit 0' INT TERM

wait
