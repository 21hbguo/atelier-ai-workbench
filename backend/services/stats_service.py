from datetime import datetime
from typing import Dict, Any
from backend.database import get_db


class StatsService:
    @classmethod
    def _ensure_row(cls):
        with get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO stats (id, last_date) VALUES (1, ?)",
                (datetime.now().strftime("%Y-%m-%d"),),
            )

    @classmethod
    def _check_date_reset(cls, conn):
        row = conn.execute("SELECT last_date FROM stats WHERE id = 1").fetchone()
        today = datetime.now().strftime("%Y-%m-%d")
        if row and row["last_date"] != today:
            conn.execute(
                "UPDATE stats SET today_requests=0, today_success=0, today_failed=0, last_date=? WHERE id=1",
                (today,),
            )

    @classmethod
    def record_request(cls) -> None:
        cls._ensure_row()
        with get_db() as conn:
            cls._check_date_reset(conn)
            conn.execute(
                "UPDATE stats SET today_requests=today_requests+1, total_requests=total_requests+1 WHERE id=1"
            )

    @classmethod
    def record_success(cls) -> None:
        cls._ensure_row()
        with get_db() as conn:
            cls._check_date_reset(conn)
            conn.execute(
                "UPDATE stats SET today_success=today_success+1, total_success=total_success+1 WHERE id=1"
            )

    @classmethod
    def record_failed(cls) -> None:
        cls._ensure_row()
        with get_db() as conn:
            cls._check_date_reset(conn)
            conn.execute(
                "UPDATE stats SET today_failed=today_failed+1, total_failed=total_failed+1 WHERE id=1"
            )

    @classmethod
    def get_stats(cls) -> Dict[str, Any]:
        cls._ensure_row()
        with get_db() as conn:
            cls._check_date_reset(conn)
            row = conn.execute("SELECT * FROM stats WHERE id = 1").fetchone()
            return dict(row)
