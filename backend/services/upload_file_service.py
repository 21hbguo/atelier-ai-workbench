from datetime import datetime
from typing import Optional
from backend.database import get_db


class UploadFileService:
    @classmethod
    def create(cls, file_key: str, owner_id: int, original_name: str, storage_name: str, content_type: str, category: str = "private") -> dict:
        created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with get_db() as conn:
            row = conn.execute(
                "INSERT INTO upload_files (file_key, owner_id, original_name, storage_name, content_type, category, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING file_key, owner_id, original_name, storage_name, content_type, category, created_at",
                (file_key, owner_id, original_name, storage_name, content_type, category, created_at),
            ).fetchone()
            return dict(row)

    @classmethod
    def get_by_key(cls, file_key: str) -> Optional[dict]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM upload_files WHERE file_key = %s", (file_key,)).fetchone()
            return dict(row) if row else None

    @classmethod
    def get_by_storage_name(cls, storage_name: str) -> Optional[dict]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM upload_files WHERE storage_name = %s", (storage_name,)).fetchone()
            return dict(row) if row else None

    @classmethod
    def belongs_to_user(cls, file_key: str, user_id: int) -> bool:
        item = cls.get_by_key(file_key)
        return bool(item and item["owner_id"] == user_id)
