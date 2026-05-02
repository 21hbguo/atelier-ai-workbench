from backend.db.engine import init_pool
from backend.db.session import get_db

__all__ = ["get_db", "init_db", "create_admin_if_not_exists"]


def _column_exists(conn, table, column):
    row = conn.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name=%s AND column_name=%s",
        (table, column),
    ).fetchone()
    return row is not None


def _exec(conn, sql):
    conn.execute(sql)


def init_db():
    with get_db() as conn:
        statements = [
            """CREATE TABLE IF NOT EXISTS users (
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
            )""",
            """CREATE TABLE IF NOT EXISTS user_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                status VARCHAR(32) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_user_requests_user_id ON user_requests(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_user_requests_created_at ON user_requests(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS tasks (
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
            )""",
            "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)",
            "CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)",
            """CREATE TABLE IF NOT EXISTS prompts (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                prompt TEXT NOT NULL,
                negative_prompt TEXT DEFAULT '',
                tags JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP,
                user_id INTEGER REFERENCES users(id),
                likes_count INTEGER DEFAULT 0,
                image_path VARCHAR(512),
                author VARCHAR(128),
                source VARCHAR(512),
                category VARCHAR(64)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_prompts_name ON prompts(name)",
            "CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category)",
            """CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                slug VARCHAR(64) NOT NULL UNIQUE,
                label VARCHAR(128) NOT NULL,
                sort_order INTEGER DEFAULT 0
            )""",
            """CREATE TABLE IF NOT EXISTS prompt_likes (
                id SERIAL PRIMARY KEY,
                prompt_id VARCHAR(64) NOT NULL REFERENCES prompts(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(prompt_id, user_id)
            )""",
            """CREATE TABLE IF NOT EXISTS square_images (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                filename VARCHAR(255) NOT NULL,
                prompt TEXT,
                metadata JSONB,
                likes_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_square_images_user_id ON square_images(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_square_images_created_at ON square_images(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS square_likes (
                id SERIAL PRIMARY KEY,
                image_id INTEGER NOT NULL REFERENCES square_images(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(image_id, user_id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_square_likes_image_id ON square_likes(image_id)",
            "CREATE INDEX IF NOT EXISTS idx_square_likes_user_id ON square_likes(user_id)",
            """CREATE TABLE IF NOT EXISTS stats (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                today_requests INTEGER DEFAULT 0,
                today_success INTEGER DEFAULT 0,
                today_failed INTEGER DEFAULT 0,
                total_requests INTEGER DEFAULT 0,
                total_success INTEGER DEFAULT 0,
                total_failed INTEGER DEFAULT 0,
                last_date VARCHAR(10)
            )""",
            """CREATE TABLE IF NOT EXISTS daily_stats (
                date VARCHAR(10) PRIMARY KEY,
                requests INTEGER DEFAULT 0,
                success INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0
            )""",
            """CREATE TABLE IF NOT EXISTS banned_words (
                id SERIAL PRIMARY KEY,
                word VARCHAR(255) NOT NULL UNIQUE,
                created_at TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS image_mappings (
                id SERIAL PRIMARY KEY,
                local_path VARCHAR(512) NOT NULL UNIQUE,
                url VARCHAR(1024) NOT NULL,
                upload_time TIMESTAMP,
                content_hash VARCHAR(64) DEFAULT '',
                delete_token VARCHAR(128) DEFAULT ''
            )""",
            "CREATE INDEX IF NOT EXISTS idx_image_mappings_hash ON image_mappings(content_hash)",
            """CREATE TABLE IF NOT EXISTS image_metadata (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) NOT NULL UNIQUE,
                metadata JSONB,
                created_at TIMESTAMP,
                user_id INTEGER REFERENCES users(id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_image_metadata_filename ON image_metadata(filename)",
            "CREATE INDEX IF NOT EXISTS idx_image_metadata_created_at ON image_metadata(created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_image_metadata_user_id ON image_metadata(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_image_metadata_user_created ON image_metadata(user_id, created_at DESC)",
            """CREATE TABLE IF NOT EXISTS recharge_requests (
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
            )""",
            """CREATE TABLE IF NOT EXISTS redemption_codes (
                id SERIAL PRIMARY KEY,
                code VARCHAR(64) UNIQUE NOT NULL,
                points INTEGER NOT NULL,
                is_used BOOLEAN DEFAULT FALSE,
                used_by INTEGER REFERENCES users(id),
                used_by_ip VARCHAR(45),
                used_at TIMESTAMP,
                recharge_request_id INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_redemption_codes_code ON redemption_codes(code)",
            "CREATE INDEX IF NOT EXISTS idx_redemption_codes_is_used ON redemption_codes(is_used)",
            """CREATE TABLE IF NOT EXISTS point_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount INTEGER NOT NULL,
                balance_after INTEGER NOT NULL,
                type VARCHAR(32) NOT NULL,
                description TEXT,
                recharge_request_id INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_point_tx_user_id ON point_transactions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_point_tx_created_at ON point_transactions(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS daily_checkins (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                checkin_date VARCHAR(10) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id, checkin_date)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_daily_checkins_user_date ON daily_checkins(user_id, checkin_date)",
            "CREATE INDEX IF NOT EXISTS idx_recharge_user_id ON recharge_requests(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_recharge_status ON recharge_requests(status)",
            "CREATE INDEX IF NOT EXISTS idx_recharge_created_at ON recharge_requests(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS announcements (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS announcement_reads (
                id SERIAL PRIMARY KEY,
                announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                read_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(announcement_id, user_id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_announcement_reads_ann ON announcement_reads(announcement_id)",
            """CREATE TABLE IF NOT EXISTS import_sources (
                id SERIAL PRIMARY KEY,
                source_key VARCHAR(255) UNIQUE NOT NULL,
                last_imported_at TIMESTAMP,
                record_count INTEGER DEFAULT 0,
                metadata JSONB
            )""",
        ]
        for sql in statements:
            conn.execute(sql)

        # 唯一索引需要条件判断（source 可能为 NULL）
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_source ON prompts(source) WHERE source IS NOT NULL"
        )

        # 初始化默认分类
        count = conn.execute("SELECT COUNT(*) AS cnt FROM categories").fetchone()["cnt"]
        if count == 0:
            default_categories = [
                ("poster", "海报与插画", 1),
                ("portrait", "人像摄影", 2),
                ("ui", "UI设计", 3),
                ("comparison", "模型对比", 4),
                ("ad-creative", "广告创意", 5),
                ("ecommerce", "电商案例", 6),
                ("character", "角色设计", 7),
            ]
            conn.executemany(
                "INSERT INTO categories (slug, label, sort_order) VALUES (%s, %s, %s)",
                default_categories,
            )

        # 清理历史脏数据
        conn.execute("""
            DELETE FROM user_requests WHERE status = 'processing' AND user_id IN (
                SELECT DISTINCT user_id FROM user_requests WHERE status IN ('success', 'failed')
            )
        """)


def create_admin_if_not_exists():
    import os
    import bcrypt

    admin_username = os.getenv("ADMIN_USERNAME")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_username or not admin_password:
        print("[WARNING] ADMIN_USERNAME 或 ADMIN_PASSWORD 未设置，跳过管理员创建")
        return
    with get_db() as conn:
        admin = conn.execute(
            "SELECT id FROM users WHERE username = %s", (admin_username,)
        ).fetchone()
        if not admin:
            password_hash = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt()).decode()
            conn.execute(
                "INSERT INTO users (username, password_hash, nickname, is_admin) VALUES (%s, %s, %s, %s)",
                (admin_username, password_hash, "管理员", True),
            )


init_pool()
init_db()
create_admin_if_not_exists()
