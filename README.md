# Atelier AI

Atelier AI 是一个支持 AI 对话、图像生成、文件处理和联网搜索的全栈应用。

## 功能

- AI 对话与流式响应
- AI 图像生成与图片管理
- 文件上传、文档解析和工作区工具
- 联网搜索与提示词优化
- 用户、积分、订阅和管理后台

## 快速开始

### Docker Compose

```bash
cp .env.example .env
```

编辑 `.env`，至少设置 `PG_PASSWORD`、`JWT_SECRET` 以及所使用 AI 服务的 API 配置，然后运行：

```bash
chmod +x deploy-first-time.sh
./deploy-first-time.sh
```

服务启动后默认通过 `http://127.0.0.1:5173` 访问。

常用命令：

```bash
docker compose up -d
docker compose ps
docker compose logs -f app
docker compose down
```

### 本地开发

后端依赖安装：

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
```

前端开发：

```bash
cd frontend
npm install
npm run dev
```

## 配置

配置通过根目录 `.env` 读取，完整字段和示例见 `.env.example`。不要把真实 API Key、数据库密码、JWT 密钥或邮件凭据提交到 Git。

运行时数据库、上传文件、模型缓存和本地配置位于 `data/`，该目录默认不纳入版本控制。

## 测试与构建

```bash
cd frontend
npm run lint
npm run test
npm run build
```

后端测试使用 pytest：

```bash
pytest backend/tests
```

## 安全

生产环境请使用强随机密码和密钥，限制管理后台访问范围，并通过 HTTPS 暴露服务。公开部署前请确认 `.env`、数据库、上传文件和模型缓存均未进入 Git 历史。

## License

[MIT](LICENSE)
