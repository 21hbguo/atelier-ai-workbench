#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   打包项目用于部署${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_NAME=$(basename "$PROJECT_DIR")
PARENT_DIR=$(dirname "$PROJECT_DIR")
OUTPUT="$PARENT_DIR/${PROJECT_NAME}.tar.gz"

# 检查 .env
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${YELLOW}[警告] 未找到 .env 文件${NC}"
    if [ -f "$PROJECT_DIR/.env.example" ]; then
        cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
        echo -e "${YELLOW}已从 .env.example 创建 .env，请编辑填写配置${NC}"
        echo -e "${YELLOW}填写完成后按回车继续...${NC}"
        read -r
    fi
fi

# 导出数据库
echo -e "${YELLOW}[1/2] 导出数据库...${NC}"
cd "$PROJECT_DIR"
if docker compose ps db 2>/dev/null | grep -q "Up"; then
    docker compose exec -T db pg_dump -U app_user --clean --if-exists app_db > data/db_snapshot.sql
    echo -e "  ${GREEN}数据库已导出到 data/db_snapshot.sql${NC}"
else
    echo -e "  ${YELLOW}数据库未运行，跳过导出（将使用已有的快照）${NC}"
fi

echo -e "${YELLOW}[2/2] 正在打包...${NC}"
cd "$PARENT_DIR"
tar czf "$OUTPUT" \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='frontend/node_modules' \
    --exclude='*.tar.gz' \
    "$PROJECT_NAME"

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo ""
echo -e "${GREEN}打包完成！${NC}"
echo ""
echo -e "  文件: ${YELLOW}${OUTPUT}${NC}"
echo -e "  大小: ${YELLOW}${SIZE}${NC}"
echo ""
echo -e "部署命令:"
echo -e "  ${YELLOW}# 上传到服务器${NC}"
echo -e "  ${YELLOW}scp ${OUTPUT} user@server:/path/${NC}"
echo -e ""
echo -e "  ${YELLOW}# 在服务器上解压并部署${NC}"
echo -e "  ${YELLOW}tar xzf ${PROJECT_NAME}.tar.gz${NC}"
echo -e "  ${YELLOW}cd ${PROJECT_NAME}${NC}"
echo -e "  ${YELLOW}./deploy.sh${NC}"
echo ""
