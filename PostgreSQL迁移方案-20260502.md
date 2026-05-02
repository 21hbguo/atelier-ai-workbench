# SQLite → PostgreSQL 迁移方案

> 日期：2026-05-02

## 一、迁移动机

| 问题 | 说明 |
|------|------|
| 单写锁 | SQLite 同一时刻只允许一个写事务，高并发下阻塞 |
| 无连接池 | 每次请求新建连接，无法复用 |
| 内存真相源 | `TaskManager._tasks`、限流字典在进程内，多实例部署不一致 |
| 热点行 | `stats` 单行、`likes_count` 直接 UPDATE，并发写冲突 |
| 无正式迁移 | ALTER TABLE 脚本散落在 `init_db()` 中，无法回滚 |

## 二、技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 数据库 | PostgreSQL 16 | 多版本并发控制(MVCC)、JSONB、分区表、丰富索引类型 |
| Python 驱动 | psycopg (v3) | 异步支持好，PostgreSQL 原生协议 |
| 连接池 | psycopg 连接池 + PgBouncer | 应用层 + 服务端双层池化 |
| 迁移工具 | Alembic + SQLAlchemy Core | 不引入完整 ORM，只用 Core 做 SQL 编译和迁移管理 |
| 缓存（可选） | Redis | 限流、点赞计数、session，P1 阶段可先用内存 |

> **不引入完整 ORM**：当前项目全部是手写 SQL，迁移到 ORM 改动量巨大且收益有限。用 SQLAlchemy Core 只做连接管理和 SQL 方言兼容，保留手写 SQL 风格。

## 三、SQL 方言差异清单

SQLite → PostgreSQL 需要修改的 SQL 语法：

| 差异点 | SQLite 写法 | PostgreSQL 写法 |
|--------|------------|----------------|
| 自增主键 | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` 或 `BIGSERIAL` |
| 占位符 | `?` | `%s`（psycopg）或 `:name`（SQLAlchemy） |
| 字符串拼接 | `||` | `||`（相同） |
| UPSERT | `INSERT OR REPLACE` / `INSERT OR IGNORE` | `INSERT ... ON CONFLICT ... DO UPDATE/NOTHING` |
| 布尔值 | `INTEGER 0/1` | `BOOLEAN`（迁移时保留 INTEGER 兼容亦可） |
| JSON 存储 | `TEXT` 存 JSON 字符串 | `JSONB`（支持索引和查询） |
| PRAGMA | WAL / busy_timeout 等 | 无需，PostgreSQL 有自己的配置 |
| `executescript` | 批量执行多条 SQL | 不支持，需逐条执行或用 `;` 分割 |
| 日期函数 | `CURRENT_TIMESTAMP` | `NOW()` / `CURRENT_TIMESTAMP`（均可） |
| `datetime()` | `datetime('now')` | `NOW()` |
| `IF NOT EXISTS` | 支持 | 支持（相同） |
| 分页 | `LIMIT n OFFSET m` | `LIMIT n OFFSET m`（相同） / `FETCH FIRST n ROWS ONLY` |
| WAL 模式 | `PRAGMA journal_mode=WAL` | 默认即 MVCC，无需设置 |

## 四、数据库 Schema 迁移

### 4.1 PostgreSQL 建表 DDL

```sql
-- users
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(128),
    avatar VARCHAR(512),
    is_admin BOOLEAN DEFAULT FALSE,
    is_frozen BOOLEAN DEFAULT FALSE,
    last_ip VARCHAR(45),
    last_active TIMESTAMP,
    points INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- user_requests（限流 + 审计）
CREATE TABLE user_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_user_requests_user_id ON user_requests(user_id);
CREATE INDEX idx_user_requests_created_at ON user_requests(created_at DESC);

-- tasks
CREATE TABLE tasks (
    task_id VARCHAR(64) PRIMARY KEY,
    type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    params JSONB,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    progress INTEGER DEFAULT 0,
    result_urls JSONB,
    error TEXT,
    external_result JSONB,
    user_id INTEGER REFERENCES users(id)
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_updated_at ON tasks(updated_at DESC);
CREATE INDEX idx_tasks_user_id ON tasks(user_id);

-- prompts
CREATE TABLE prompts (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    prompt TEXT NOT NULL,
    negative_prompt TEXT DEFAULT '',
    tags JSONB DEFAULT '[]',
    created_at TIMESTAMP,
    user_id INTEGER REFERENCES users(id),
    likes_count INTEGER DEFAULT 0,
    image_path VARCHAR(512),
    author VARCHAR(128),
    source VARCHAR(512),
    category VARCHAR(64)
);
CREATE INDEX idx_prompts_name ON prompts(name);
CREATE INDEX idx_prompts_user_id ON prompts(user_id);
CREATE UNIQUE INDEX idx_prompts_source ON prompts(source) WHERE source IS NOT NULL;
CREATE INDEX idx_prompts_category ON prompts(category);

-- categories
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(64) NOT NULL UNIQUE,
    label VARCHAR(128) NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- prompt_likes
CREATE TABLE prompt_likes (
    id SERIAL PRIMARY KEY,
    prompt_id VARCHAR(64) NOT NULL REFERENCES prompts(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(prompt_id, user_id)
);

-- square_images
CREATE TABLE square_images (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    filename VARCHAR(255) NOT NULL,
    prompt TEXT,
    metadata JSONB,
    likes_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_square_images_user_id ON square_images(user_id);
CREATE INDEX idx_square_images_created_at ON square_images(created_at DESC);

-- square_likes
CREATE TABLE square_likes (
    id SERIAL PRIMARY KEY,
    image_id INTEGER NOT NULL REFERENCES square_images(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(image_id, user_id)
);
CREATE INDEX idx_square_likes_image_id ON square_likes(image_id);
CREATE INDEX idx_square_likes_user_id ON square_likes(user_id);

-- stats（单行统计表，迁移后考虑废弃改用事件聚合）
CREATE TABLE stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    today_requests INTEGER DEFAULT 0,
    today_success INTEGER DEFAULT 0,
    today_failed INTEGER DEFAULT 0,
    total_requests INTEGER DEFAULT 0,
    total_success INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    last_date VARCHAR(10)
);

-- daily_stats
CREATE TABLE daily_stats (
    date VARCHAR(10) PRIMARY KEY,
    requests INTEGER DEFAULT 0,
    success INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0
);

-- banned_words
CREATE TABLE banned_words (
    id SERIAL PRIMARY KEY,
    word VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP
);

-- image_mappings
CREATE TABLE image_mappings (
    id SERIAL PRIMARY KEY,
    local_path VARCHAR(512) NOT NULL UNIQUE,
    url VARCHAR(1024) NOT NULL,
    upload_time TIMESTAMP,
    content_hash VARCHAR(64) DEFAULT '',
    delete_token VARCHAR(128) DEFAULT ''
);
CREATE INDEX idx_image_mappings_hash ON image_mappings(content_hash);

-- image_metadata
CREATE TABLE image_metadata (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL UNIQUE,
    metadata JSONB,
    created_at TIMESTAMP,
    user_id INTEGER REFERENCES users(id)
);
CREATE INDEX idx_image_metadata_filename ON image_metadata(filename);
CREATE INDEX idx_image_metadata_created_at ON image_metadata(created_at DESC);
CREATE INDEX idx_image_metadata_user_id ON image_metadata(user_id);
CREATE INDEX idx_image_metadata_user_created ON image_metadata(user_id, created_at DESC);

-- redemption_codes
CREATE TABLE redemption_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(64) UNIQUE NOT NULL,
    points INTEGER NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    used_by INTEGER REFERENCES users(id),
    used_by_ip VARCHAR(45),
    used_at TIMESTAMP,
    recharge_request_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_redemption_codes_code ON redemption_codes(code);
CREATE INDEX idx_redemption_codes_is_used ON redemption_codes(is_used);

-- point_transactions
CREATE TABLE point_transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    type VARCHAR(32) NOT NULL,
    description TEXT,
    recharge_request_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_point_tx_user_id ON point_transactions(user_id);
CREATE INDEX idx_point_tx_created_at ON point_transactions(created_at DESC);

-- daily_checkins
CREATE TABLE daily_checkins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    checkin_date VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, checkin_date)
);
CREATE INDEX idx_daily_checkins_user_date ON daily_checkins(user_id, checkin_date);

-- recharge_requests
CREATE TABLE recharge_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    channel VARCHAR(32) NOT NULL,
    amount REAL NOT NULL,
    points INTEGER NOT NULL,
    payer_name VARCHAR(128) DEFAULT '',
    tx_no VARCHAR(128) DEFAULT '',
    proof_url VARCHAR(1024) DEFAULT '',
    remark TEXT DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    redeem_code VARCHAR(64) DEFAULT '',
    review_note TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    reviewed_at TIMESTAMP,
    reviewed_by INTEGER REFERENCES users(id)
);
CREATE INDEX idx_recharge_user_id ON recharge_requests(user_id);
CREATE INDEX idx_recharge_status ON recharge_requests(status);
CREATE INDEX idx_recharge_created_at ON recharge_requests(created_at DESC);

-- announcements
CREATE TABLE announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_announcements_created_at ON announcements(created_at DESC);

-- announcement_reads
CREATE TABLE announcement_reads (
    id SERIAL PRIMARY KEY,
    announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    read_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(announcement_id, user_id)
);
CREATE INDEX idx_announcement_reads_user ON announcement_reads(user_id);
CREATE INDEX idx_announcement_reads_ann ON announcement_reads(announcement_id);

-- import_sources
CREATE TABLE import_sources (
    id SERIAL PRIMARY KEY,
    source_key VARCHAR(255) UNIQUE NOT NULL,
    last_imported_at TIMESTAMP,
    record_count INTEGER DEFAULT 0,
    metadata JSONB
);
```

### 4.2 JSON 字段迁移策略

当前 SQLite 中以下字段存的是 JSON 字符串，迁移到 PostgreSQL 后改为 JSONB：

| 表 | 字段 | 用途 |
|----|------|------|
| tasks | params, result_urls, external_result | 任务参数和结果 |
| prompts | tags | 标签数组 |
| square_images | metadata | 图片元信息 |
| image_metadata | metadata | 图片 EXIF 等 |
| import_sources | metadata | 导入源配置 |

迁移时需要：`UPDATE table SET col = col::jsonb WHERE col IS NOT NULL`

## 五、代码改造清单

### 5.1 新增文件

| 文件 | 职责 |
|------|------|
| `backend/db/engine.py` | PostgreSQL 连接池管理（psycopg 连接池） |
| `backend/db/session.py` | `get_db()` 上下文管理器，兼容 PostgreSQL |
| `backend/db/migrations/` | Alembic 迁移目录 |
| `backend/db/migrations/env.py` | Alembic 配置 |
| `backend/db/migrations/versions/` | 迁移版本文件 |
| `alembic.ini` | Alembic 配置文件 |

### 5.2 修改文件

| 文件 | 改动内容 |
|------|----------|
| `backend/database.py` | 保留为兼容层，内部调用 `db/session.py`；或标记废弃 |
| `backend/config.py` | 新增 `DATABASE_URL`、`PG_POOL_SIZE` 等配置项 |
| `backend/requirements.txt` | 新增 `psycopg[binary]`、`sqlalchemy`、`alembic` |
| 所有 router/service 文件（13 个） | `?` 占位符 → `%s`，`sqlite3.Row` → dict，`executescript` → 逐条执行 |

### 5.3 需要改动的 SQL 语句汇总

共 **13 个文件**、约 **80+ 处 SQL 调用**需要修改：

| 文件 | SQL 调用数 | 主要改动 |
|------|-----------|---------|
| `routers/auth.py` | 3 | 占位符、Row 访问 |
| `routers/generate.py` | 2 | 占位符 |
| `routers/tasks.py` | 1 | 占位符、Row 访问 |
| `routers/images.py` | 4 | 占位符、Row 访问 |
| `routers/prompts.py` | 3 | 占位符、INSERT OR IGNORE → ON CONFLICT |
| `routers/stats.py` | 2 | 占位符、Row 访问 |
| `routers/square.py` | 6 | 占位符、Row 访问 |
| `routers/admin.py` | 15+ | 占位符、Row 访问、INSERT OR IGNORE |
| `routers/points.py` | 3 | 占位符 |
| `routers/announcements.py` | 5 | 占位符 |
| `services/task_manager.py` | 6 | INSERT OR REPLACE → UPSERT、占位符 |
| `services/stats_service.py` | 8+ | INSERT OR IGNORE → ON CONFLICT、占位符 |
| `services/prompt_service.py` | 10+ | 占位符、Row 访问 |
| `services/banned_words.py` | 5 | 占位符 |
| `services/image_mapping.py` | 6 | 占位符 |
| `services/points_service.py` | 10+ | 占位符、Row 访问 |
| `services/category_service.py` | 5 | 占位符 |
| `auth.py` | 3 | 占位符 |
| `scripts/import_evo.py` | 3 | INSERT OR IGNORE → ON CONFLICT |

### 5.4 关键改造点

**1) 连接池管理 (`db/engine.py`)**

```python
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

pool = ConnectionPool(
    conninfo="postgresql://user:pass@localhost:5432/app_db",
    min_size=5,
    max_size=20,
    kwargs={"row_factory": dict_row}
)
```

**2) get_db() 改造 (`db/session.py`)**

```python
@contextmanager
def get_db():
    with pool.connection() as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
```

**3) 占位符批量替换**

`?` → `%s`，全项目一次性替换。

**4) Row 访问方式**

`sqlite3.Row` 的 `row["col"]` 语法与 psycopg 的 `dict_row` 兼容，无需改动访问代码。

**5) INSERT OR IGNORE / INSERT OR REPLACE**

```python
# SQLite
conn.execute("INSERT OR IGNORE INTO square_likes ...")
# PostgreSQL
conn.execute("INSERT INTO square_likes ... ON CONFLICT(image_id, user_id) DO NOTHING")

# SQLite
conn.execute("INSERT OR REPLACE INTO tasks ...")
# PostgreSQL
conn.execute("""INSERT INTO tasks (...) VALUES (...)
    ON CONFLICT(task_id) DO UPDATE SET status=EXCLUDED.status, ...""")
```

**6) TaskManager 内存状态迁移**

当前 `_tasks` dict 是进程内真相源。迁移方案：
- 写操作全部走数据库（`INSERT ... ON CONFLICT DO UPDATE`）
- 读操作走数据库 + 内存缓存（LRU，TTL 30s）
- 多实例部署时以数据库为准

## 六、数据迁移

### 6.1 导出 SQLite 数据

```bash
# 导出为 SQL
sqlite3 data/app.db .dump > backup_full.sql

# 逐表导出为 CSV（推荐，PostgreSQL COPY 命令导入更快）
for table in users user_requests tasks prompts categories prompt_likes \
    square_images square_likes stats daily_stats banned_words image_mappings \
    image_metadata redemption_codes point_transactions daily_checkins \
    recharge_requests announcements announcement_reads import_sources; do
    sqlite3 -header -csv data/app.db "SELECT * FROM $table;" > "migration/${table}.csv"
done
```

### 6.2 导入 PostgreSQL

```bash
# 方案 A：COPY 命令（推荐，速度快）
psql -d app_db -c "\COPY users FROM 'migration/users.csv' WITH (FORMAT csv, HEADER true)"

# 方案 B：写 Python 迁移脚本（更灵活，可做数据转换）
python backend/scripts/migrate_sqlite_to_pg.py
```

### 6.3 数据校验

迁移后逐表对比：
- 行数：`SELECT COUNT(*) FROM table`
- 关键字段校验和：`SELECT md5(string_agg(...)) FROM table`
- 抽样比对：随机取 100 条记录对比字段值

## 七、配置变更

### 7.1 `.env` 新增

```env
# PostgreSQL
DATABASE_URL=postgresql://app_user:password@localhost:5432/app_db
PG_POOL_MIN=5
PG_POOL_MAX=20

# Redis（可选，P1 阶段可跳过）
# REDIS_URL=redis://localhost:6379/0
```

### 7.2 `config.py` 新增

```python
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/app_db")
PG_POOL_MIN = int(os.getenv("PG_POOL_MIN", "5"))
PG_POOL_MAX = int(os.getenv("PG_POOL_MAX", "20"))
```

## 八、实施步骤

### 阶段 1：基础设施（1-2 天）

- [ ] 安装 PostgreSQL 16
- [ ] 创建数据库和用户
- [ ] 执行建表 DDL
- [ ] 安装 Python 依赖：`psycopg[binary]`、`sqlalchemy`、`alembic`

### 阶段 2：数据库访问层（2-3 天）

- [ ] 创建 `backend/db/engine.py`（连接池）
- [ ] 创建 `backend/db/session.py`（get_db 上下文管理器）
- [ ] 配置 Alembic 迁移环境
- [ ] 生成初始迁移脚本

### 阶段 3：SQL 改造（3-5 天）

- [ ] 全局替换占位符 `?` → `%s`
- [ ] 改造 `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`
- [ ] 改造 `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE`
- [ ] 改造 `PRAGMA` 相关代码（删除）
- [ ] JSON 字段迁移到 JSONB
- [ ] TaskManager 去除内存真相源

### 阶段 4：数据迁移（1 天）

- [ ] 导出 SQLite 数据
- [ ] 导入 PostgreSQL
- [ ] 行数和抽样校验

### 阶段 5：测试与切换（2-3 天）

- [ ] 本地全量功能测试
- [ ] 压测：并发写入、连接池压力
- [ ] 部署切换：修改 systemd service 环境变量
- [ ] 监控观察 24 小时
- [ ] SQLite 文件保留为只读备份

### 阶段 6（可选）：Redis 引入

- [ ] 限流迁移到 Redis
- [ ] 点赞计数迁移到 Redis
- [ ] TaskManager 缓存层

## 九、风险与回滚

| 风险 | 应对 |
|------|------|
| SQL 语法遗漏 | 全量测试覆盖每个 API 端点 |
| 连接池耗尽 | 设置合理的 pool_size，添加监控告警 |
| 数据迁移丢失 | 迁移前完整备份 SQLite，逐表校验行数 |
| 性能回退 | PostgreSQL 单机小数据量可能比 SQLite 慢，需调优（shared_buffers、work_mem） |
| 回滚方案 | 保留 SQLite 文件和旧代码分支，切换回 `DATABASE_URL=sqlite:///...` 即可 |

## 十、预期收益

- 支持多实例部署，水平扩展 API 服务
- 写并发从 1 提升到数百（MVCC）
- 连接复用，减少连接开销
- JSONB 索引提升复杂查询性能
- 正式迁移管理（Alembic），可追踪、可回滚
- 为后续读写分离、分区表打基础
