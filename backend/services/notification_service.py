from datetime import datetime
from typing import List, Dict, Any
from backend.database import get_db

class NotificationService:
    @staticmethod
    def create(user_id: int, notice_type: str, title: str, content: str, related_task_id: str = None):
        with get_db() as conn:
            conn.execute("INSERT INTO notifications (user_id, type, title, content, related_task_id) VALUES (%s, %s, %s, %s, %s)", (user_id, notice_type, title, content, related_task_id))

    @staticmethod
    def list(user_id: int, page: int = 1, size: int = 20) -> Dict[str, Any]:
        offset = (page - 1) * size
        with get_db() as conn:
            total = conn.execute("SELECT COUNT(*) cnt FROM notifications WHERE user_id = %s", (user_id,)).fetchone()["cnt"]
            rows = conn.execute("SELECT id,user_id,type,title,content,related_task_id,is_read,created_at,read_at FROM notifications WHERE user_id = %s ORDER BY created_at DESC LIMIT %s OFFSET %s", (user_id, size, offset)).fetchall()
        items = []
        for row in rows:
            d = dict(row)
            d["is_read"] = bool(d.get("is_read"))
            items.append(d)
        return {"total": total, "items": items, "page": page, "size": size}

    @staticmethod
    def unread_count(user_id: int) -> int:
        with get_db() as conn:
            row = conn.execute("SELECT COUNT(*) cnt FROM notifications WHERE user_id = %s AND COALESCE(is_read,FALSE)=FALSE", (user_id,)).fetchone()
        return int(row["cnt"] if row else 0)

    @staticmethod
    def mark_read(user_id: int, notification_id: int) -> bool:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with get_db() as conn:
            row = conn.execute("UPDATE notifications SET is_read = TRUE, read_at = %s WHERE id = %s AND user_id = %s RETURNING id", (now, notification_id, user_id)).fetchone()
        return bool(row)

    @staticmethod
    def mark_all_read(user_id: int) -> int:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with get_db() as conn:
            row = conn.execute("UPDATE notifications SET is_read = TRUE, read_at = %s WHERE user_id = %s AND COALESCE(is_read,FALSE)=FALSE RETURNING id", (now, user_id)).fetchall()
        return len(row or [])

    @staticmethod
    def clear_read(user_id: int) -> int:
        with get_db() as conn:
            rows = conn.execute("DELETE FROM notifications WHERE user_id = %s AND is_read = TRUE RETURNING id", (user_id,)).fetchall()
        return len(rows or [])
