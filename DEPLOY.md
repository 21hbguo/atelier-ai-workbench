# 部署说明

项目提供 Docker Compose 部署方式。请先准备一台安装 Docker Compose 的 Linux 服务器，并将项目复制到服务器目录。

## 首次部署

```bash
cp .env.example .env
编辑 .env，填写数据库密码、AI 服务 API Key 和其他配置
chmod +x deploy-first-time.sh
./deploy-first-time.sh
```

首次部署脚本会检查 Docker、构建应用镜像、启动 PostgreSQL 和 SearXNG，并执行数据库迁移。生产环境必须设置 `PG_PASSWORD`，不要使用默认密码。

## 日常更新

```bash
bash scripts/safe_remote_update.sh <user@host> /opt/atelier-ai
```

服务器上的更新脚本会保留 `.env` 和 `data/` 下的运行数据，执行数据库迁移后重启应用容器。

## 常用命令

```bash
docker compose up -d
docker compose ps
docker compose logs -f app
docker compose down
```

## 数据与凭据

- `.env` 只保存在本地或服务器，不要提交到 Git。
- `data/` 用于数据库、上传文件、模型缓存和运行时配置，默认不纳入版本控制。
- 部署前必须设置高强度 `PG_PASSWORD` 和 `JWT_SECRET`。
- 如需迁移已有数据，请使用数据库备份工具，不要把生产数据库快照提交到公开仓库。
