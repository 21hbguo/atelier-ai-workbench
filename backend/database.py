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
        conn.execute("SELECT pg_advisory_lock(%s,%s)", (58231, 19001))
        try:
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
                is_frozen BOOLEAN DEFAULT FALSE,
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
            """CREATE TABLE IF NOT EXISTS favorites (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                target_type VARCHAR(16) NOT NULL,
                target_id VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id,target_type,target_id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id,created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_favorites_target ON favorites(target_type,target_id)",
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
                user_id INTEGER REFERENCES users(id),
                expires_at TIMESTAMP,
                is_permanent BOOLEAN DEFAULT FALSE
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
                risk_level VARCHAR(16) DEFAULT 'low',
                risk_flags JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP DEFAULT NOW(),
                reviewed_at TIMESTAMP,
                reviewed_by INTEGER REFERENCES users(id)
            )""",
            """CREATE TABLE IF NOT EXISTS upload_files (
                id SERIAL PRIMARY KEY,
                file_key VARCHAR(128) NOT NULL UNIQUE,
                owner_id INTEGER NOT NULL REFERENCES users(id),
                original_name VARCHAR(255) NOT NULL,
                storage_name VARCHAR(255) NOT NULL UNIQUE,
                content_type VARCHAR(128) NOT NULL,
                category VARCHAR(32) NOT NULL DEFAULT 'private',
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_upload_files_owner_id ON upload_files(owner_id)",
            "CREATE INDEX IF NOT EXISTS idx_upload_files_created_at ON upload_files(created_at DESC)",
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
                request_key VARCHAR(128),
                recharge_request_id INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_point_tx_user_id ON point_transactions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_point_tx_created_at ON point_transactions(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS provider_purchase_batches (
                id SERIAL PRIMARY KEY,
                provider_id VARCHAR(64) NOT NULL,
                purchase_date TIMESTAMP NOT NULL,
                amount_rmb NUMERIC(18,6) NOT NULL,
                quota_amount NUMERIC(18,6) NOT NULL,
                remaining_quota NUMERIC(18,6) NOT NULL,
                unit_cost NUMERIC(18,8) NOT NULL,
                remark TEXT DEFAULT '',
                operator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_provider_purchase_batches_provider_date ON provider_purchase_batches(provider_id,purchase_date DESC,id DESC)",
            "CREATE INDEX IF NOT EXISTS idx_provider_purchase_batches_remaining ON provider_purchase_batches(provider_id,remaining_quota)",
            """CREATE TABLE IF NOT EXISTS generation_finance_entries (
                id SERIAL PRIMARY KEY,
                task_id VARCHAR(64) NOT NULL UNIQUE REFERENCES tasks(task_id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                model_id VARCHAR(64) NOT NULL,
                provider_id VARCHAR(64) NOT NULL,
                status VARCHAR(32) NOT NULL,
                charged_points INTEGER DEFAULT 0,
                revenue_rmb NUMERIC(18,6) DEFAULT 0,
                cost_rmb NUMERIC(18,6),
                pricing_source VARCHAR(64) DEFAULT '',
                cost_source VARCHAR(64) DEFAULT '',
                purchase_batch_id INTEGER REFERENCES provider_purchase_batches(id) ON DELETE SET NULL,
                quota_used NUMERIC(18,6) DEFAULT 0,
                quota_shortage NUMERIC(18,6) DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_generation_finance_entries_created ON generation_finance_entries(created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_generation_finance_entries_provider_created ON generation_finance_entries(provider_id,created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_generation_finance_entries_model_provider ON generation_finance_entries(model_id,provider_id)",
            """CREATE TABLE IF NOT EXISTS provider_model_quota_rules (
                id SERIAL PRIMARY KEY,
                provider_id VARCHAR(64) NOT NULL,
                model_id VARCHAR(64) NOT NULL,
                quota_per_success NUMERIC(18,6) NOT NULL,
                enabled BOOLEAN DEFAULT TRUE,
                remark TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(provider_id, model_id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_provider_model_quota_rules_provider_model ON provider_model_quota_rules(provider_id,model_id)",
            """CREATE TABLE IF NOT EXISTS generation_finance_allocations (
                id SERIAL PRIMARY KEY,
                finance_entry_id INTEGER NOT NULL REFERENCES generation_finance_entries(id) ON DELETE CASCADE,
                purchase_batch_id INTEGER NOT NULL REFERENCES provider_purchase_batches(id) ON DELETE CASCADE,
                quota_used NUMERIC(18,6) NOT NULL,
                cost_rmb NUMERIC(18,6) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_generation_finance_allocations_entry ON generation_finance_allocations(finance_entry_id)",
            "CREATE INDEX IF NOT EXISTS idx_generation_finance_allocations_batch ON generation_finance_allocations(purchase_batch_id)",
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
            """CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(32) NOT NULL,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                related_task_id VARCHAR(64),
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW(),
                read_at TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)",
            """CREATE TABLE IF NOT EXISTS share_links (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                filename VARCHAR(255) NOT NULL,
                token VARCHAR(128) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                is_revoked BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_share_links_user_created ON share_links(user_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token)",
            """CREATE TABLE IF NOT EXISTS import_sources (
                id SERIAL PRIMARY KEY,
                source_key VARCHAR(255) UNIQUE NOT NULL,
                last_imported_at TIMESTAMP,
                record_count INTEGER DEFAULT 0,
                metadata JSONB
            )""",
            """CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash VARCHAR(128) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                revoked_at TIMESTAMP,
                last_ip VARCHAR(45) DEFAULT '',
                user_agent VARCHAR(255) DEFAULT ''
            )""",
            "CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user_id ON auth_refresh_tokens(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_expires_at ON auth_refresh_tokens(expires_at)",
            """CREATE TABLE IF NOT EXISTS email_verification_codes (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                code VARCHAR(10) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                registered BOOLEAN DEFAULT FALSE,
                ip VARCHAR(45) DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_ev_codes_email ON email_verification_codes(email)",
            "CREATE INDEX IF NOT EXISTS idx_ev_codes_created_at ON email_verification_codes(created_at DESC)",
        ]
            for sql in statements:
                conn.execute(sql)

        # 唯一索引需要条件判断（source 可能为 NULL）
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_source ON prompts(source) WHERE source IS NOT NULL"
            )

        # 迁移：给 square_images 添加 is_frozen 字段
            if not _column_exists(conn, "square_images", "is_frozen"):
                conn.execute("ALTER TABLE square_images ADD COLUMN is_frozen BOOLEAN DEFAULT FALSE")
            if not _column_exists(conn, "prompts", "is_frozen"):
                conn.execute("ALTER TABLE prompts ADD COLUMN is_frozen BOOLEAN DEFAULT FALSE")
            if not _column_exists(conn, "image_metadata", "expires_at"):
                conn.execute("ALTER TABLE image_metadata ADD COLUMN expires_at TIMESTAMP")
            if not _column_exists(conn, "image_metadata", "is_permanent"):
                conn.execute("ALTER TABLE image_metadata ADD COLUMN is_permanent BOOLEAN DEFAULT FALSE")
            if not _column_exists(conn, "tasks", "points_cost"):
                conn.execute("ALTER TABLE tasks ADD COLUMN points_cost INTEGER DEFAULT 0")
            if not _column_exists(conn, "tasks", "points_balance_after"):
                conn.execute("ALTER TABLE tasks ADD COLUMN points_balance_after INTEGER")
            if not _column_exists(conn, "tasks", "is_deleted"):
                conn.execute("ALTER TABLE tasks ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE")
            if not _column_exists(conn, "tasks", "deleted_at"):
                conn.execute("ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMP")
            if not _column_exists(conn, "tasks", "deleted_by_role"):
                conn.execute("ALTER TABLE tasks ADD COLUMN deleted_by_role VARCHAR(16)")
            if not _column_exists(conn, "point_transactions", "request_key"):
                conn.execute("ALTER TABLE point_transactions ADD COLUMN request_key VARCHAR(128)")
            if not _column_exists(conn, "recharge_requests", "risk_level"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN risk_level VARCHAR(16) DEFAULT 'low'")
            if not _column_exists(conn, "recharge_requests", "risk_flags"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN risk_flags JSONB DEFAULT '[]'::jsonb")
            if not _column_exists(conn, "generation_finance_entries", "quota_shortage"):
                conn.execute("ALTER TABLE generation_finance_entries ADD COLUMN quota_shortage NUMERIC(18,6) DEFAULT 0")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_image_metadata_expires_at ON image_metadata(expires_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_image_metadata_is_permanent ON image_metadata(is_permanent)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_is_deleted ON tasks(is_deleted)")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_point_tx_request_key ON point_transactions(request_key) WHERE request_key IS NOT NULL")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_user_client_req ON tasks(user_id, ((params->>'client_request_id'))) WHERE params ? 'client_request_id'")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_user_target ON favorites(user_id,target_type,target_id)")
            conn.execute("UPDATE image_metadata m SET is_permanent = TRUE, expires_at = NULL WHERE EXISTS (SELECT 1 FROM square_images s WHERE s.filename = m.filename)")
            conn.execute("UPDATE image_metadata SET expires_at = COALESCE(created_at, NOW()) + interval '3 day' WHERE is_permanent = FALSE AND expires_at IS NULL")
            if not _column_exists(conn, "users", "email"):
                conn.execute("ALTER TABLE users ADD COLUMN email VARCHAR(255) DEFAULT ''")
            dup_nickname = conn.execute("SELECT nickname,COUNT(*) cnt FROM users WHERE nickname IS NOT NULL AND nickname<>'' GROUP BY nickname HAVING COUNT(*)>1 LIMIT 1").fetchone()
            if not dup_nickname:
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_unique ON users(nickname) WHERE nickname IS NOT NULL AND nickname<>''")

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
                with conn.cursor() as cur:
                    cur.executemany(
                        "INSERT INTO categories (slug, label, sort_order) VALUES (%s, %s, %s)",
                        default_categories,
                    )

        # 清理历史脏数据
            conn.execute("SAVEPOINT init_cleanup_sp")
            try:
                conn.execute("""
                    DELETE FROM user_requests WHERE status = 'processing' AND user_id IN (
                        SELECT DISTINCT user_id FROM user_requests WHERE status IN ('success', 'failed')
                    )
                """)
            except Exception:
                conn.execute("ROLLBACK TO SAVEPOINT init_cleanup_sp")
            conn.execute("RELEASE SAVEPOINT init_cleanup_sp")
        finally:
            try:
                conn.execute("SELECT pg_advisory_unlock(%s,%s)", (58231, 19001))
            except Exception:
                try:
                    conn.rollback()
                    conn.execute("SELECT pg_advisory_unlock(%s,%s)", (58231, 19001))
                except Exception:
                    pass


def create_admin_if_not_exists():
    import os
    import bcrypt

    admin_username = os.getenv("ADMIN_USERNAME")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_username or not admin_password:
        print("[WARNING] ADMIN_USERNAME 或 ADMIN_PASSWORD 未设置，跳过管理员创建")
        return
    if not admin_username.isdigit() or len(admin_username) < 5 or len(admin_username) > 11:
        print("[WARNING] ADMIN_USERNAME 需为5到11位数字，跳过管理员创建")
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
