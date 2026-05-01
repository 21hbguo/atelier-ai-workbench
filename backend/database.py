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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

            CREATE INDEX IF NOT EXISTS idx_square_images_user_id ON square_images(user_id);
            CREATE INDEX IF NOT EXISTS idx_square_images_created_at ON square_images(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_square_likes_image_id ON square_likes(image_id);
            CREATE INDEX IF NOT EXISTS idx_square_likes_user_id ON square_likes(user_id);
        """)

        # 检查 is_admin 列是否存在，不存在则添加
        columns = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "is_admin" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0")


def create_admin_if_not_exists():
    """创建管理员账号（如果不存在）"""
    import bcrypt
    with get_db() as conn:
        admin = conn.execute("SELECT id FROM users WHERE username = '2678896985'").fetchone()
        if not admin:
            password_hash = bcrypt.hashpw("CHANGE_ME".encode(), bcrypt.gensalt()).decode()
            conn.execute(
                "INSERT INTO users (username, password_hash, nickname, is_admin) VALUES (?, ?, ?, ?)",
                ("2678896985", password_hash, "管理员", 1),
            )


init_db()
create_admin_if_not_exists()
