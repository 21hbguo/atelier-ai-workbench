#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   打包更新包${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_NAME=$(basename "$PROJECT_DIR")
PARENT_DIR=$(dirname "$PROJECT_DIR")
OUTPUT="$PARENT_DIR/${PROJECT_NAME}_update.tar.gz"

echo "正在打包..."
cd "$PARENT_DIR"
tar czf "$OUTPUT" \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='frontend/node_modules' \
    --exclude='data' \
    --exclude='.env' \
    --exclude='*.db' \
    --exclude='*.tar.gz' \
    "$PROJECT_NAME"

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo ""
echo -e "${GREEN}打包完成！${NC}"
echo ""
echo -e "  文件: ${YELLOW}${OUTPUT}${NC}"
echo -e "  大小: ${YELLOW}${SIZE}${NC}"
echo ""
echo -e "更新命令:"
echo -e "  ${YELLOW}# 上传到服务器${NC}"
echo -e "  ${YELLOW}scp ${OUTPUT} user@server:/path/${PROJECT_NAME}/../${NC}"
echo -e ""
echo -e "  ${YELLOW}# 在服务器上执行更新${NC}"
echo -e "  ${YELLOW}cd ${PROJECT_NAME}${NC}"
echo -e "  ${YELLOW}./update.sh${NC}"
echo ""
