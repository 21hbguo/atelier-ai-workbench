from datetime import datetime
from backend.database import get_db


class PointsService:
    COST_PER_GENERATION = 10
    CHECKIN_REWARD = 10
    REGISTER_BONUS = 50
    MIGRATION_AMOUNT = 50

    @classmethod
    def get_balance(cls, user_id: int) -> int:
        with get_db() as conn:
            row = conn.execute("SELECT points FROM users WHERE id = ?", (user_id,)).fetchone()
            return row["points"] if row else 0

    @classmethod
    def has_enough(cls, user_id: int, amount: int) -> bool:
        with get_db() as conn:
            user = conn.execute("SELECT is_admin, points FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                return False
            if user["is_admin"]:
                return True
            return user["points"] >= amount

    @classmethod
    def consume(cls, user_id: int, amount: int, description: str = "") -> int:
        with get_db() as conn:
            user = conn.execute("SELECT is_admin, points FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ValueError("用户不存在")
            if user["is_admin"]:
                return -1
            cursor = conn.execute(
                "UPDATE users SET points = points - ? WHERE id = ? AND points >= ?",
                (amount, user_id, amount),
            )
            if cursor.rowcount == 0:
                raise ValueError("积分不足")
            new_balance = conn.execute("SELECT points FROM users WHERE id = ?", (user_id,)).fetchone()["points"]
            conn.execute(
                "INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (?, ?, ?, ?, ?)",
                (user_id, -amount, new_balance, "generate_consume", description),
            )
            return new_balance

    @classmethod
    def refund(cls, user_id: int, amount: int, description: str = "") -> int:
        with get_db() as conn:
            user = conn.execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ValueError("用户不存在")
            if user["is_admin"]:
                return -1
            conn.execute("UPDATE users SET points = points + ? WHERE id = ?", (amount, user_id))
            new_balance = conn.execute("SELECT points FROM users WHERE id = ?", (user_id,)).fetchone()["points"]
            conn.execute(
                "INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (?, ?, ?, ?, ?)",
                (user_id, amount, new_balance, "generate_refund", description),
            )
            return new_balance

    @classmethod
    def add_points(cls, user_id: int, amount: int, tx_type: str, description: str = "") -> int:
        with get_db() as conn:
            conn.execute("UPDATE users SET points = points + ? WHERE id = ?", (amount, user_id))
            new_balance = conn.execute("SELECT points FROM users WHERE id = ?", (user_id,)).fetchone()["points"]
            conn.execute(
                "INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (?, ?, ?, ?, ?)",
                (user_id, amount, new_balance, tx_type, description),
            )
            return new_balance

    @classmethod
    def check_in(cls, user_id: int) -> dict:
        today = datetime.now().strftime("%Y-%m-%d")
        with get_db() as conn:
            existing = conn.execute(
                "SELECT id FROM daily_checkins WHERE user_id = ? AND checkin_date = ?",
                (user_id, today),
            ).fetchone()
            if existing:
                raise ValueError("今日已签到")
            conn.execute(
                "INSERT INTO daily_checkins (user_id, checkin_date) VALUES (?, ?)",
                (user_id, today),
            )
            conn.execute("UPDATE users SET points = points + ? WHERE id = ?", (cls.CHECKIN_REWARD, user_id))
            new_balance = conn.execute("SELECT points FROM users WHERE id = ?", (user_id,)).fetchone()["points"]
            conn.execute(
                "INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (?, ?, ?, ?, ?)",
                (user_id, cls.CHECKIN_REWARD, new_balance, "daily_checkin", "每日签到"),
            )
            return {"success": True, "points": new_balance, "message": f"签到成功 +{cls.CHECKIN_REWARD}"}

    @classmethod
    def has_checked_in_today(cls, user_id: int) -> bool:
        today = datetime.now().strftime("%Y-%m-%d")
        with get_db() as conn:
            row = conn.execute(
                "SELECT id FROM daily_checkins WHERE user_id = ? AND checkin_date = ?",
                (user_id, today),
            ).fetchone()
            return row is not None

    @classmethod
    def redeem_code(cls, code: str, user_id: int, ip: str) -> dict:
        with get_db() as conn:
            row = conn.execute(
                "SELECT id, points, is_used FROM redemption_codes WHERE code = ?",
                (code.strip().upper(),),
            ).fetchone()
            if not row:
                raise ValueError("兑换码不存在")
            if row["is_used"]:
                raise ValueError("兑换码已被使用")
            points_to_add = row["points"]
            conn.execute(
                "UPDATE redemption_codes SET is_used = 1, used_by = ?, used_by_ip = ?, used_at = ? WHERE id = ?",
                (user_id, ip, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), row["id"]),
            )
            conn.execute("UPDATE users SET points = points + ? WHERE id = ?", (points_to_add, user_id))
            new_balance = conn.execute("SELECT points FROM users WHERE id = ?", (user_id,)).fetchone()["points"]
            conn.execute(
                "INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (?, ?, ?, ?, ?)",
                (user_id, points_to_add, new_balance, "redeem_code", f"兑换码兑换 ({code.strip().upper()})"),
            )
            return {"success": True, "points_awarded": points_to_add, "balance": new_balance}

    @classmethod
    def migrate_existing_users(cls) -> dict:
        with get_db() as conn:
            users = conn.execute("SELECT id FROM users WHERE points = 0").fetchall()
            count = 0
            for user in users:
                uid = user["id"]
                conn.execute("UPDATE users SET points = points + ? WHERE id = ?", (cls.MIGRATION_AMOUNT, uid))
                new_balance = conn.execute("SELECT points FROM users WHERE id = ?", (uid,)).fetchone()["points"]
                conn.execute(
                    "INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (?, ?, ?, ?, ?)",
                    (uid, cls.MIGRATION_AMOUNT, new_balance, "migration", "系统补发"),
                )
                count += 1
            return {"migrated": count}
