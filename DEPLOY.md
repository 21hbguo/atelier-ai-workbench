# 部署与更新流程
## 结论
- 首次部署服务器：用 `./deploy-first-time.sh`
- 日常更新服务器：用 `bash scripts/safe_remote_update.sh`
- 服务器收到更新包后执行更新：用 `./deploy-update.sh`
- `deploy_code_only.sh` 已移除
## 首次部署
适用场景：
- 新机器
- 服务器上还没有 `PROJECT_ROOT`
- 需要完整初始化 Docker、数据库、服务
标准步骤：
```bash
scp -r app_v1 root@proxy.example.test:/home/
ssh root@proxy.example.test
cd PROJECT_ROOT
chmod +x deploy-first-time.sh
./deploy-first-time.sh
```
`deploy-first-time.sh` 的职责：
- 检查当前目录
- 安装 Docker
- 准备 `.env`
- 构建镜像
- 启动 `db`
- 如存在 `data/db_snapshot.sql` 则导入
- 启动全部服务
## 标准更新
适用场景：
- 服务器已经正常运行
- 只想更新代码
- 不想覆盖配置和业务数据
固定入口：
```bash
cd PROJECT_ROOT
bash scripts/safe_remote_update.sh
```
这个脚本会做：
1. 本地尝试备份
2. 本地执行 `package-update.sh --no-data`
3. 如果没有代码变化则退出
4. 上传 `app_v1_update.tar.gz` 到服务器
5. 服务器更新前执行 `scripts/server_backup.sh`
6. 服务器执行 `./deploy-update.sh`
## 服务器更新脚本
服务器上的 `./deploy-update.sh` 当前只负责：
1. 解压更新包
2. 重建镜像
3. 等待数据库就绪
4. 执行 `alembic upgrade head`
5. 重启容器
为避免误覆盖，`deploy-update.sh` 解压时明确排除：
- `.env`
- `.env.*`
- `data/config.json`
- `data/.jwt_secret`
- `data/uploads`
- `data/images`
- `data/thumbs`
- `data/evo_images`
- `data/evo_thumbs`
- `data/backups`
- `data/*.db`
- `data/*.sqlite`
- `data/*.sqlite3`
## 备份
服务器每日备份：
- 脚本：`scripts/server_backup.sh`
- 安装：`scripts/install_server_backup_cron.sh`
- 目录：`PROJECT_ROOT/data/backups/backup_YYYYMMDD_HHMMSS/`
本地补拉：
- 脚本：`scripts/local_pull_backup.sh`
- 安装：`scripts/install_local_pull_cron.sh`
- 目录：`local_backup/backup_YYYYMMDD_HHMMSS/`
## 已移除脚本
`deploy_code_only.sh` 已移除，原因是它带 `rsync --delete`，不应作为标准更新入口。
`backup_db.sh`、`backup_pg.sh`、`export_db.sh` 都不是现在的标准灾备方案。
## 手动运维
`quick.sh` 可用于手动查看容器状态、日志、启动、停止、重启。
它不是标准发布入口，不用于正式更新服务器代码。
## 推荐给 AI 的提示词
```text
按仓库标准流程更新服务器，只允许执行 `bash scripts/safe_remote_update.sh`，禁止自创部署方式，禁止 rsync --delete，禁止覆盖 `.env`、`data/config.json`、`data/.jwt_secret` 和 data 下业务数据。更新后汇报备份目录、构建结果、容器状态和 health 检查结果。
```
