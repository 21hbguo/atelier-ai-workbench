import sqlite3
from pathlib import Path
from contextlib import contextmanager
from backend.config import DATA_DIR

DB_PATH = DATA_DIR / "app.db"


def get_connection():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                nickname TEXT,
                avatar TEXT,
                is_admin INTEGER DEFAULT 0,
                is_frozen INTEGER DEFAULT 0,
                last_ip TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS user_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS square_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                prompt TEXT,
                metadata TEXT,
                likes_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS square_likes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                image_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (image_id) REFERENCES square_images(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(image_id, user_id)
            );

            CREATE INDEX IF NOT EXISTS idx_user_requests_user_id ON user_requests(user_id);
            CREATE INDEX IF NOT EXISTS idx_user_requests_created_at ON user_requests(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_square_images_user_id ON square_images(user_id);
            CREATE INDEX IF NOT EXISTS idx_square_images_created_at ON square_images(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_square_likes_image_id ON square_likes(image_id);
            CREATE INDEX IF NOT EXISTS idx_square_likes_user_id ON square_likes(user_id);

            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                params TEXT,
                created_at TEXT,
                updated_at TEXT,
                started_at TEXT,
                completed_at TEXT,
                progress INTEGER DEFAULT 0,
                result_urls TEXT,
                error TEXT,
                external_result TEXT
            );

            CREATE TABLE IF NOT EXISTS prompts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL,
                negative_prompt TEXT DEFAULT '',
                tags TEXT DEFAULT '[]',
                created_at TEXT,
                user_id INTEGER,
                likes_count INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS prompt_likes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prompt_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (prompt_id) REFERENCES prompts(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(prompt_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS stats (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                today_requests INTEGER DEFAULT 0,
                today_success INTEGER DEFAULT 0,
                today_failed INTEGER DEFAULT 0,
                total_requests INTEGER DEFAULT 0,
                total_success INTEGER DEFAULT 0,
                total_failed INTEGER DEFAULT 0,
                last_date TEXT
            );

            CREATE TABLE IF NOT EXISTS daily_stats (
                date TEXT PRIMARY KEY,
                requests INTEGER DEFAULT 0,
                success INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS image_mappings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                local_path TEXT NOT NULL UNIQUE,
                url TEXT NOT NULL,
                upload_time TEXT,
                content_hash TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS image_metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL UNIQUE,
                metadata TEXT,
                created_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_prompts_name ON prompts(name);
            CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id);
            CREATE INDEX IF NOT EXISTS idx_image_mappings_hash ON image_mappings(content_hash);
            CREATE INDEX IF NOT EXISTS idx_image_metadata_filename ON image_metadata(filename);
        """)

        # 检查新列是否存在，不存在则添加
        columns = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "is_admin" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0")
        if "is_frozen" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN is_frozen INTEGER DEFAULT 0")
        if "last_ip" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN last_ip TEXT")
        if "last_active" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN last_active TIMESTAMP")

        task_cols = [row[1] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()]
        if "user_id" not in task_cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN user_id INTEGER")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)")

        meta_cols = [row[1] for row in conn.execute("PRAGMA table_info(image_metadata)").fetchall()]
        if "user_id" not in meta_cols:
            conn.execute("ALTER TABLE image_metadata ADD COLUMN user_id INTEGER")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_image_metadata_user_id ON image_metadata(user_id)")

        prompt_cols = [row[1] for row in conn.execute("PRAGMA table_info(prompts)").fetchall()]
        if "user_id" not in prompt_cols:
            conn.execute("ALTER TABLE prompts ADD COLUMN user_id INTEGER")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id)")
        if "likes_count" not in prompt_cols:
            conn.execute("ALTER TABLE prompts ADD COLUMN likes_count INTEGER DEFAULT 0")

        # 清理历史脏数据：删除已有终态记录的 processing 条目
        conn.execute("""
            DELETE FROM user_requests WHERE status = 'processing' AND user_id IN (
                SELECT DISTINCT user_id FROM user_requests WHERE status IN ('success', 'failed')
            )
        """)


def create_admin_if_not_exists():
    """创建管理员账号（从环境变量读取）"""
    import os
    import bcrypt
    admin_username = os.getenv("ADMIN_USERNAME")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_username or not admin_password:
        print("[WARNING] ADMIN_USERNAME 或 ADMIN_PASSWORD 未设置，跳过管理员创建")
        return
    with get_db() as conn:
        admin = conn.execute("SELECT id FROM users WHERE username = ?", (admin_username,)).fetchone()
        if not admin:
            password_hash = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt()).decode()
            conn.execute(
                "INSERT INTO users (username, password_hash, nickname, is_admin) VALUES (?, ?, ?, ?)",
                (admin_username, password_hash, "管理员", 1),
            )


init_db()
create_admin_if_not_exists()
