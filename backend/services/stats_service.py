from datetime import datetime, timedelta
from typing import Dict, Any
from backend.database import get_db


class StatsService:
    @classmethod
    def _ensure_row(cls):
        with get_db() as conn:
            conn.execute(
                "INSERT INTO stats (id, last_date) VALUES (1, %s) ON CONFLICT(id) DO NOTHING",
                (datetime.now().strftime("%Y-%m-%d"),),
            )

    @classmethod
    def _check_date_reset(cls, conn):
        row = conn.execute("SELECT last_date, today_requests, today_success, today_failed FROM stats WHERE id = 1").fetchone()
        today = datetime.now().strftime("%Y-%m-%d")
        if row and row["last_date"] != today:
            # 快照前一天数据到 daily_stats
            yesterday = row["last_date"]
            if yesterday:
                conn.execute(
                    "INSERT INTO daily_stats (date, requests, success, failed) VALUES (%s, %s, %s, %s) ON CONFLICT(date) DO UPDATE SET requests=EXCLUDED.requests, success=EXCLUDED.success, failed=EXCLUDED.failed",
                    (yesterday, row["today_requests"], row["today_success"], row["today_failed"]),
                )
            conn.execute(
                "UPDATE stats SET today_requests=0, today_success=0, today_failed=0, last_date=%s WHERE id=1",
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
            result = dict(row)

            # 从 image_metadata 表统计实际图片数（更准确）
            img_count = conn.execute("SELECT COUNT(*) as cnt FROM image_metadata").fetchone()
            result["total_images"] = img_count["cnt"] if img_count else 0

            # 用实际图片数覆盖 success 统计（之前的统计可能不完整）
            result["total_success"] = result["total_images"]

            # 今日成功数从 image_metadata 统计
            today = datetime.now().strftime("%Y-%m-%d")
            today_img = conn.execute(
                "SELECT COUNT(*) as cnt FROM image_metadata WHERE created_at >= %s",
                (today,)
            ).fetchone()
            result["today_success"] = today_img["cnt"] if today_img else 0

            # 总用户数
            user_count = conn.execute("SELECT COUNT(*) as cnt FROM users").fetchone()
            result["total_users"] = user_count["cnt"] if user_count else 0

            # 当日活跃用户数（今天登录或有任务的用户）
            today_active = conn.execute(
                """SELECT COUNT(DISTINCT user_id) as cnt FROM (
                    SELECT id as user_id FROM users WHERE last_active >= %s
                    UNION
                    SELECT user_id FROM tasks WHERE user_id IS NOT NULL AND created_at >= %s
                )""",
                (today, today)
            ).fetchone()
            result["today_active_users"] = today_active["cnt"] if today_active else 0

            # 当前在线用户数（最近30分钟内登录或有任务的用户）
            thirty_min_ago = (datetime.now() - timedelta(minutes=30)).strftime("%Y-%m-%d %H:%M:%S")
            recent_active = conn.execute(
                """SELECT COUNT(DISTINCT user_id) as cnt FROM (
                    SELECT id as user_id FROM users WHERE last_active >= %s
                    UNION
                    SELECT user_id FROM tasks WHERE user_id IS NOT NULL AND created_at >= %s
                )""",
                (thirty_min_ago, thirty_min_ago)
            ).fetchone()
            result["current_active_users"] = recent_active["cnt"] if recent_active else 0

            # 前日新增用户数
            yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
            yesterday_new = conn.execute(
                "SELECT COUNT(*) as cnt FROM users WHERE created_at >= %s AND created_at < %s",
                (yesterday, today)
            ).fetchone()
            result["yesterday_new_users"] = yesterday_new["cnt"] if yesterday_new else 0

            # 当日成功率
            today_req = result.get("today_requests", 0)
            today_suc = result.get("today_success", 0)
            result["today_success_rate"] = round(today_suc / today_req * 100, 1) if today_req > 0 else 0

            return result

    @classmethod
    def get_daily_stats(cls) -> list:
        today = datetime.now().strftime("%Y-%m-%d")
        with get_db() as conn:
            rows = conn.execute(
                "SELECT date, requests, success, failed FROM daily_stats ORDER BY date DESC LIMIT 7"
            ).fetchall()
            result = [dict(r) for r in reversed(rows)]

            # 如果今天有数据也加上
            today_row = conn.execute("SELECT today_requests, today_success, today_failed FROM stats WHERE id=1").fetchone()
            if today_row and (today_row["today_requests"] > 0 or today_row["today_success"] > 0):
                today_entry = {"date": today, "requests": today_row["today_requests"], "success": today_row["today_success"], "failed": today_row["today_failed"]}
                if result and result[-1]["date"] == today:
                    result[-1] = today_entry
                else:
                    result.append(today_entry)

            return result
