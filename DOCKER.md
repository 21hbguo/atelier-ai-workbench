# Docker 部署指南

## 快速部署

```bash
# 克隆代码
git clone <repo> && cd app_v1

# 一键部署（自动安装 Docker、构建镜像、迁移数据）
chmod +x deploy.sh
./deploy.sh
```

访问 `http://服务器IP:5173`

## 手动部署

```bash
# 1. 配置环境变量
cp .env.example .env
vim .env  # 填写 API Key 等敏感配置

# 2. 构建并启动
docker compose up -d --build

# 3. 访问
# http://服务器IP:5173
```

## 常用命令

| 操作 | 命令 |
|------|------|
| 启动 | `docker compose up -d` |
| 停止 | `docker compose down` |
| 重启 | `docker compose restart` |
| 查看日志 | `docker compose logs -f` |
| 重建镜像 | `docker compose build` |
| 进入容器 | `docker compose exec app bash` |

## 更新版本

```bash
git pull
docker compose build
docker compose up -d
```

数据库结构变更会通过 alembic 自动迁移。

## 数据备份

### 导出数据库

```bash
docker compose exec -T db pg_dump -U app_user app_db > backup.sql
```

### 导入数据库

```bash
docker compose exec -T db psql -U app_user app_db < backup.sql
```

### 备份文件数据

```bash
docker cp $(docker compose ps -q app):/app/data ./data_backup
```

## 数据存储位置

| 数据类型 | Docker 内路径 | 持久化方式 |
|---------|--------------|-----------|
| PostgreSQL 数据库 | /var/lib/postgresql/data | volume `pgdata` |
| 用户上传文件 | /app/data/uploads | volume `appdata` |
| 生成的图片 | /app/data/images | volume `appdata` |
| 缩略图 | /app/data/thumbs | volume `appdata` |
| evo 图片 | /app/evo/images | 挂载宿主机目录（只读） |
| evo 缩略图 | /app/data/evo_thumbs | volume `appdata` |

Docker volume 独立于容器，删除容器不会丢失数据。

## evo 目录配置

evo 数据（提示词案例库）的图片存放在项目上级目录的 `evo/` 目录。

**部署时需要确保 evo 目录存在**：

```bash
# 克隆 evo 仓库
cd /path/to/generate_image
git clone <evo-repo> evo
```

**自定义 evo 目录位置**（修改 `.env`）：

```bash
EVO_DIR=/path/to/your/evo
```

## 端口配置

默认端口 `5173`，修改 `.env` 中的 `APP_PORT`：

```bash
APP_PORT=8080
```

或启动时指定：

```bash
APP_PORT=8080 docker compose up -d
```

## 迁移到新服务器

1. 在旧服务器导出数据：
   ```bash
   docker compose exec -T db pg_dump -U app_user app_db > backup.sql
   docker cp $(docker compose ps -q app):/app/data ./data_backup
   ```

2. 在新服务器部署：
   ```bash
   git clone <repo> && cd app_v1
   ./deploy.sh
   ```

3. 导入数据：
   ```bash
   docker compose exec -T db psql -U app_user app_db < backup.sql
   docker cp data_backup/uploads $(docker compose ps -q app):/app/data/
   docker cp data_backup/images $(docker compose ps -q app):/app/data/
   ```
