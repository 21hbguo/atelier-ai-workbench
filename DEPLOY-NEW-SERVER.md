# 新服务器傻瓜式部署（含 SearXNG 联网搜索）

> 适用于：全新服务器（Ubuntu/Debian/CentOS 均可），把整个项目部署上去并自动带上 SearXNG 联网搜索服务。

## 一、准备

1. 把项目目录打包上传到服务器（任选其一）：
   ```bash
   # 本机（开发机）执行：生成更新包
   ./package-update.sh        # 生成 ../app_v1_update.tar.gz
   # 上传到服务器后解压
   tar xzf app_v1_update.tar.gz
   ```
2. 上传 .env（含 API Key 等敏感配置；没有就按下面第 3 步编辑）

## 二、部署（就 1 条命令）

```bash
cd app_v1
./deploy-first-time.sh
```

脚本会自动完成：

| 步骤 | 内容 |
|---|---|
| 1/5 | 检查/安装 Docker（未安装自动装） |
| 1.5/5 | **自动配置 Docker 国内镜像加速**（新服务器拉镜像快，避免超时失败） |
| 2/5 | 首次运行生成 `.env`（需要编辑时按提示填 API Key） |
| 3/5 | 构建应用镜像（前端+后端） |
| 4/5 | 迁移已有数据库（无则空库启动） |
| 5/5 | **docker compose up -d 一键拉起全部服务**：db + app + searxng |
| 结尾 | **自动健康检查 searxng**，提示联网搜索是否就绪 |

部署完成后访问 `http://<服务器IP>:5173`。

## 三、验证联网搜索

```bash
# 1. 查看三个服务状态（应全部 Up）
docker compose ps

# 2. 直接测 searxng（返回 JSON 结果即正常）
curl "http://127.0.0.1:8082/search?q=测试&format=json"

# 3. 站内验证：聊天页 → 输入框左下角「联网搜索」按钮点亮 → 提问实时信息
```

## 四、日常运维（分层操作，避免全量）

```bash
./quick.sh start                  # 启动全部（首次部署用：db+app+searxng 一起拉起）
./quick.sh stop                   # 停止全部
./quick.sh restart                # 重启全部
./quick.sh logs                   # 看全部日志
./quick.sh status                 # 看全部状态

./quick.sh update                 # 【日常更新】只重建 app，searxng/db 不中断
./deploy-update.sh                # 正式更新（解压更新包 + 重建 app + 数据库迁移）

./quick.sh search status          # 单独看 searxng 状态
./quick.sh search restart         # 单独重启 searxng（搜索异常/更新引擎配置后）
./quick.sh search logs            # 单独看 searxng 日志
./quick.sh search stop            # 单独停 searxng（不想用联网搜索时省资源）
./quick.sh app restart            # 单独重启 app
./quick.sh db restart             # 单独重启数据库
```

> 场景对照：**新服务器** → `./deploy-first-time.sh`（全量含 searxng）；**日常改代码** → `./quick.sh update` 或 `./deploy-update.sh`（只动 app）；**searxng 有问题/调配置** → `./quick.sh search restart`。

## 五、联网搜索配置说明（默认即可用，无需手动设置）

| 配置 | 默认值 | 说明 |
|---|---|---|
| `SEARXNG_URL` | `http://searxng:8080`（compose 自动注入） | 后端访问 searxng 的地址，容器内服务名解析，**无需修改** |
| `SEARXNG_PORT` | `8082` | searxng 对外端口（宿主机访问用；与 8081 等常见端口不冲突） |
| `SEARCH_PROVIDERS` | `searxng,tavily,exa,serper,brave` | searxng 免费无限量优先，云搜索自动故障转移兜底 |
| `SEARCH_RATE_PER_MINUTE` | `3` | 每用户每分钟最多搜索 3 次（防滥用） |
| `SEARCH_CACHE_TTL` | `300` | 相同关键词 5 分钟内复用结果（不重复搜） |
| `SEARCH_MAX_PER_RUN` | `2` | 单次对话最多搜索 2 次 |

> 若服务器上已有独立的 SearXNG 实例，可把 `.env` 里的 `SEARXNG_URL` 改为该实例地址即可复用，项目自带实例停用（`docker compose stop searxng`）。

## 六、常见问题

- **拉镜像慢/失败**：脚本 1.5/5 已自动配置镜像加速；仍失败可手动编辑 `/etc/docker/daemon.json` 的 `registry-mirrors` 更换加速地址后 `systemctl restart docker`。
- **searxng 健康检查提示未就绪**：`docker compose logs searxng` 查看；不影响主站，搜索会自动回退云供应商。
- **8082 被占用**：`.env` 里改 `SEARXNG_PORT=8083` 再 `./quick.sh restart`。
