#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   打包增量包（更新用）${NC}"
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
OUTPUT="$PARENT_DIR/${PROJECT_NAME}_incremental.tar.gz"

# 检查上次打包时间
if [ ! -f "$PROJECT_DIR/.last_full_package" ] && [ ! -f "$PROJECT_DIR/.last_incremental_package" ]; then
    echo -e "${YELLOW}[警告] 未找到上次打包时间，将使用完整包${NC}"
    echo -e "${YELLOW}请先运行 package-full.sh${NC}"
    exit 1
fi

# 获取上次打包时间
if [ -f "$PROJECT_DIR/.last_incremental_package" ]; then
    LAST_PACKAGE=$(cat "$PROJECT_DIR/.last_incremental_package")
    LAST_PACKAGE_FILE="$PROJECT_DIR/.last_incremental_package"
else
    LAST_PACKAGE=$(cat "$PROJECT_DIR/.last_full_package")
    LAST_PACKAGE_FILE="$PROJECT_DIR/.last_full_package"
fi

echo -e "${YELLOW}上次打包时间: $(date -d @$LAST_PACKAGE '+%Y-%m-%d %H:%M:%S')${NC}"
echo ""

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

echo -e "${YELLOW}[2/2] 正在打包增量文件...${NC}"
cd "$PROJECT_DIR"

# 查找有变化的文件
CHANGED_FILES=$(find . -type f -newer "$LAST_PACKAGE_FILE" \
    ! -path './.git/*' \
    ! -path './node_modules/*' \
    ! -path './frontend/node_modules/*' \
    ! -path './__pycache__/*' \
    ! -path './.claude/*' \
    ! -name '*.pyc' \
    ! -name '*.tar.gz' \
    ! -name '.last_*_package' \
    2>/dev/null || true)

if [ -z "$CHANGED_FILES" ]; then
    echo -e "  ${YELLOW}没有发现变化的文件${NC}"
    rm -f "$OUTPUT"
    exit 0
fi

# 打包增量文件
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
    --newer-mtime="$LAST_PACKAGE_FILE"
)

if [ "$INCLUDE_DATA" = false ]; then
    EXCLUDES+=(--exclude='data')
fi

tar czf "$OUTPUT" "${EXCLUDES[@]}" "$PROJECT_NAME"

SIZE=$(du -h "$OUTPUT" | cut -f1)
FILE_COUNT=$(tar tzf "$OUTPUT" | wc -l)

# 记录打包时间
date +%s > "$PROJECT_DIR/.last_incremental_package"

echo ""
echo -e "${GREEN}打包完成！${NC}"
echo ""
echo -e "  文件: ${YELLOW}${OUTPUT}${NC}"
echo -e "  大小: ${YELLOW}${SIZE}${NC}"
echo -e "  变化文件数: ${YELLOW}${FILE_COUNT}${NC}"
echo ""
echo -e "更新命令:"
echo -e "  ${YELLOW}# 上传到服务器${NC}"
echo -e "  ${YELLOW}scp ${OUTPUT} user@server:/path/${PROJECT_NAME}/../${NC}"
echo -e ""
echo -e "  ${YELLOW}# 在服务器上执行更新${NC}"
echo -e "  ${YELLOW}cd ${PROJECT_NAME}${NC}"
echo -e "  ${YELLOW}./update.sh${NC}"
echo ""
