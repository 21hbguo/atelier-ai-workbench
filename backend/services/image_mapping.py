import os
from datetime import datetime
from typing import Optional, Dict, List
from backend.database import get_db


class ImageUrlMapping:
    @classmethod
    def load_mapping(cls) -> Dict[str, str]:
        with get_db() as conn:
            rows = conn.execute("SELECT local_path, url FROM image_mappings").fetchall()
            return {row["local_path"]: row["url"] for row in rows}

    @classmethod
    def get_url(cls, local_path: str) -> Optional[str]:
        abs_path = os.path.abspath(local_path)
        with get_db() as conn:
            row = conn.execute("SELECT url FROM image_mappings WHERE local_path = ?", (abs_path,)).fetchone()
            return row["url"] if row else None

    @classmethod
    def get_url_by_hash(cls, content_hash: str) -> Optional[str]:
        with get_db() as conn:
            row = conn.execute("SELECT url FROM image_mappings WHERE content_hash = ?", (content_hash,)).fetchone()
            return row["url"] if row else None

    @classmethod
    def save_url(cls, local_path: str, url: str, content_hash: str = "", delete_token: str = "") -> Optional[str]:
        """保存映射，返回已存在的URL（如果去重命中），否则返回None"""
        abs_path = os.path.abspath(local_path)
        with get_db() as conn:
            # 如果有content_hash，先检查是否已有相同内容的记录
            if content_hash:
                row = conn.execute("SELECT url FROM image_mappings WHERE content_hash = ?", (content_hash,)).fetchone()
                if row:
                    return row["url"]

            conn.execute(
                "INSERT OR IGNORE INTO image_mappings (local_path, url, upload_time, content_hash, delete_token) VALUES (?, ?, ?, ?, ?)",
                (abs_path, url, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), content_hash, delete_token),
            )
            return None

    @classmethod
    def get_delete_tokens(cls, urls: List[str]) -> Dict[str, str]:
        """获取多个URL对应的删除token"""
        with get_db() as conn:
            placeholders = ",".join("?" for _ in urls)
            rows = conn.execute(f"SELECT url, delete_token FROM image_mappings WHERE url IN ({placeholders}) AND delete_token != ''", urls).fetchall()
            return {row["url"]: row["delete_token"] for row in rows}

    @classmethod
    def delete_urls(cls, urls: list) -> int:
        with get_db() as conn:
            placeholders = ",".join("?" for _ in urls)
            cur = conn.execute(f"DELETE FROM image_mappings WHERE url IN ({placeholders})", urls)
            return cur.rowcount

    @classmethod
    def ensure_url(cls, local_path: str, upload_func) -> Optional[str]:
        abs_path = os.path.abspath(local_path)
        existing_url = cls.get_url(abs_path)
        if existing_url:
            return existing_url, True
        url = upload_func(abs_path)
        if url:
            cls.save_url(abs_path, url)
            return url, False
        return None, False
