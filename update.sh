#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   更新应用${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 检测是否在项目目录
if [ ! -f "Dockerfile" ] || [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}[错误] 请在项目根目录运行此脚本${NC}"
    exit 1
fi

# 检查是否有新版本包
if [ -f "../app_v1_incremental.tar.gz" ]; then
    echo -e "${YELLOW}[1/4] 发现增量包，正在解压...${NC}"
    tar xzf ../app_v1_incremental.tar.gz --strip-components=1
    rm ../app_v1_incremental.tar.gz
    echo -e "  ${GREEN}增量更新完成${NC}"
elif [ -f "../app_v1_update.tar.gz" ]; then
    echo -e "${YELLOW}[1/4] 发现更新包，正在解压...${NC}"
    tar xzf ../app_v1_update.tar.gz --strip-components=1 --exclude='data' --exclude='.env' --exclude='*.db'
    rm ../app_v1_update.tar.gz
    echo -e "  ${GREEN}代码更新完成${NC}"
else
    echo -e "${YELLOW}[1/4] 未发现更新包，跳过代码更新${NC}"
fi

# 重新构建镜像
echo ""
echo -e "${YELLOW}[2/4] 重新构建 Docker 镜像...${NC}"
docker compose build --progress=plain

# 运行数据库迁移
echo ""
echo -e "${YELLOW}[3/4] 运行数据库迁移...${NC}"
docker compose up -d db
sleep 3
for i in $(seq 1 30); do
    if docker compose exec -T db pg_isready -U app_user >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
docker compose run --rm app alembic upgrade head 2>/dev/null || echo -e "  ${YELLOW}数据库迁移跳过${NC}"

# 重启服务
echo ""
echo -e "${YELLOW}[4/4] 重启服务...${NC}"
docker compose up -d

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   更新完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
