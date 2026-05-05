#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

export TZ=Asia/Shanghai

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   打包完整包（首次部署用）${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 参数解析
INCLUDE_DATA=true
if [[ "$1" == "--no-data" ]]; then
    INCLUDE_DATA=false
    echo -e "${YELLOW}模式: 仅代码（不含数据）${NC}"
else
    echo -e "${YELLOW}模式: 代码+数据${NC}"
fi
echo ""

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_NAME=$(basename "$PROJECT_DIR")
PARENT_DIR=$(dirname "$PROJECT_DIR")

if [ "$INCLUDE_DATA" = true ]; then
    OUTPUT="$PARENT_DIR/${PROJECT_NAME}.tar.gz"
else
    OUTPUT="$PARENT_DIR/${PROJECT_NAME}_code.tar.gz"
fi

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
if [ "$INCLUDE_DATA" = true ]; then
    echo -e "${YELLOW}[1/2] 导出数据库...${NC}"
    cd "$PROJECT_DIR"
    if docker compose ps db 2>/dev/null | grep -q "Up"; then
        docker compose exec -T db pg_dump -U app_user --clean --if-exists app_db > data/db_snapshot.sql
        echo -e "  ${GREEN}数据库已导出到 data/db_snapshot.sql${NC}"
    else
        echo -e "  ${YELLOW}数据库未运行，跳过导出（将使用已有的快照）${NC}"
    fi
fi

# 记录打包时间
date +%s > "$PROJECT_DIR/.last_full_package"

echo -e "${YELLOW}[2/2] 正在打包...${NC}"
cd "$PARENT_DIR"

EXCLUDES=(
    --exclude='__pycache__'
    --exclude='*.pyc'
    --exclude='.git'
    --exclude='node_modules'
    --exclude='frontend/node_modules'
    --exclude='*.tar.gz'
    --exclude='.claude'
    --exclude='markdown'
)

if [ "$INCLUDE_DATA" = false ]; then
    EXCLUDES+=(--exclude='data')
fi

tar czf "$OUTPUT" "${EXCLUDES[@]}" "$PROJECT_NAME"

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
echo -e "  ${YELLOW}tar xzf $(basename "$OUTPUT")${NC}"
echo -e "  ${YELLOW}cd ${PROJECT_NAME}${NC}"
echo -e "  ${YELLOW}./deploy.sh${NC}"
echo ""
