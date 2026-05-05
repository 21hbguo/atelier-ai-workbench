#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

export TZ=Asia/Shanghai

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   AI 图像生成网站 - 一键部署${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 检测是否在项目目录
if [ ! -f "Dockerfile" ] || [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}[错误] 请在项目根目录运行此脚本${NC}"
    exit 1
fi

# Step 0: 确保系统时区为北京时间
EXPECTED_TZ="Asia/Shanghai"
CURRENT_TZ=$(readlink /etc/localtime 2>/dev/null | grep -oP '[^/]+/[^/]+$' || timedatectl show -p Timezone --value 2>/dev/null || echo "")
if [ "$CURRENT_TZ" != "$EXPECTED_TZ" ]; then
    echo -e "${YELLOW}检测到系统时区为 $CURRENT_TZ，正在切换为北京时间...${NC}"
    sudo timedatectl set-timezone $EXPECTED_TZ
    echo -e "${GREEN}时区已切换为 $EXPECTED_TZ${NC}"
    echo ""
fi

# Step 1: 安装 Docker
echo -e "${YELLOW}[1/5] 检查 Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo "  Docker 未安装，正在安装..."
    curl -fsSL https://get.docker.com | sh
    echo -e "  ${GREEN}Docker 安装完成${NC}"
else
    echo -e "  ${GREEN}Docker 已安装: $(docker --version)${NC}"
fi

if ! docker compose version &> /dev/null; then
    echo -e "  ${RED}docker compose 不可用，请升级 Docker${NC}"
    exit 1
fi

# Step 2: 配置 .env
echo ""
echo -e "${YELLOW}[2/5] 配置环境变量...${NC}"
if [ -f ".env" ]; then
    echo -e "  ${GREEN}.env 已存在，跳过${NC}"
else
    cp .env.example .env
    echo -e "  已从 .env.example 创建 .env"
    echo -e "  ${YELLOW}请编辑 .env 填写 API Key 等敏感配置${NC}"
    echo -e "  ${YELLOW}填写完成后按回车继续...${NC}"
    read -r
fi

# Step 3: 构建镜像
echo ""
echo -e "${YELLOW}[3/5] 构建 Docker 镜像...${NC}"
docker compose build --progress=plain

# Step 4: 迁移现有数据
echo ""
echo -e "${YELLOW}[4/5] 迁移现有数据...${NC}"

# 停止旧容器
docker compose down 2>/dev/null || true

# 启动数据库容器
docker compose up -d db
sleep 3

# 等待数据库就绪
for i in $(seq 1 30); do
    if docker compose exec -T db pg_isready -U app_user >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

# 迁移 PostgreSQL 数据
if [ -f "data/db_snapshot.sql" ]; then
    echo "  发现数据库快照，正在导入..."
    docker compose exec -T db psql -U app_user -d app_db < data/db_snapshot.sql 2>&1 | tail -5 || \
    echo -e "  ${YELLOW}数据库导入完成（可能有部分警告）${NC}"
elif [ -f "data/app.db" ]; then
    echo "  发现 SQLite 数据库，正在迁移..."
    # SQLite 迁移需要额外处理，这里先跳过
    echo -e "  ${YELLOW}SQLite 迁移暂不支持，请手动导出数据${NC}"
else
    echo "  未发现现有数据库，将使用空数据库"
fi

# Step 5: 启动所有服务
echo ""
echo -e "${YELLOW}[5/5] 启动服务...${NC}"
docker compose up -d

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 获取本机 IP
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
echo -e "  访问地址: ${YELLOW}http://${LOCAL_IP}:5173${NC}"
echo ""
echo -e "  常用命令:"
echo -e "    启动: ${YELLOW}docker compose up -d${NC}"
echo -e "    停止: ${YELLOW}docker compose down${NC}"
echo -e "    日志: ${YELLOW}docker compose logs -f${NC}"
echo -e "    重启: ${YELLOW}docker compose restart${NC}"
echo ""
