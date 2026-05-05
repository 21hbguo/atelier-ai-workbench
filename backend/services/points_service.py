from datetime import datetime
from backend.database import get_db
from backend.config import get_limit_config


class PointsService:
    @classmethod
    def cost_per_generation(cls) -> int:
        return get_limit_config()["points_cost_per_generation"]
    @classmethod
    def cost_per_optimize(cls) -> int:
        return get_limit_config()["points_cost_per_optimize"]
    @classmethod
    def checkin_reward(cls) -> int:
        return get_limit_config()["points_checkin_reward"]
    @classmethod
    def register_bonus(cls) -> int:
        return get_limit_config()["points_register_bonus"]
    @classmethod
    def migration_amount(cls) -> int:
        return get_limit_config()["points_migration_amount"]

    @classmethod
    def get_balance(cls, user_id: int) -> int:
        with get_db() as conn:
            row = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()
            return row["points"] if row else 0

    @classmethod
    def has_enough(cls, user_id: int, amount: int) -> bool:
        with get_db() as conn:
            user = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()
            if not user:
                return False
            return user["points"] >= amount

    @classmethod
    def consume(cls, user_id: int, amount: int, description: str = "", tx_type: str = "generate_consume", request_key: str = "") -> int:
        with get_db() as conn:
            user = conn.execute("SELECT points FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
            if not user:
                raise ValueError("用户不存在")
            if request_key:
                existing = conn.execute("SELECT balance_after FROM point_transactions WHERE request_key = %s", (request_key,)).fetchone()
                if existing:
                    return existing["balance_after"]
            if user["points"] < amount:
                raise ValueError("积分不足")
            conn.execute("UPDATE users SET points = points - %s WHERE id = %s", (amount, user_id))
            new_balance = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()["points"]
            if request_key:
                conn.execute("INSERT INTO point_transactions (user_id, amount, balance_after, type, description, request_key) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING", (user_id, -amount, new_balance, tx_type, description, request_key))
            else:
                conn.execute("INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (%s, %s, %s, %s, %s)", (user_id, -amount, new_balance, tx_type, description))
            return new_balance

    @classmethod
    def refund(cls, user_id: int, amount: int, description: str = "", request_key: str = "") -> int:
        with get_db() as conn:
            user = conn.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
            if not user:
                raise ValueError("用户不存在")
            if request_key:
                existing = conn.execute("SELECT balance_after FROM point_transactions WHERE request_key = %s", (request_key,)).fetchone()
                if existing:
                    return existing["balance_after"]
            conn.execute("UPDATE users SET points = points + %s WHERE id = %s", (amount, user_id))
            new_balance = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()["points"]
            if request_key:
                conn.execute("INSERT INTO point_transactions (user_id, amount, balance_after, type, description, request_key) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING", (user_id, amount, new_balance, "generate_refund", description, request_key))
            else:
                conn.execute("INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (%s, %s, %s, %s, %s)", (user_id, amount, new_balance, "generate_refund", description))
            return new_balance

    @classmethod
    def add_points(cls, user_id: int, amount: int, tx_type: str, description: str = "", conn=None, request_key: str = "", recharge_request_id=None) -> int:
        if conn is not None:
            return cls._add_points_in_conn(conn, user_id, amount, tx_type, description, request_key=request_key, recharge_request_id=recharge_request_id)
        with get_db() as c:
            return cls._add_points_in_conn(c, user_id, amount, tx_type, description, request_key=request_key, recharge_request_id=recharge_request_id)

    @classmethod
    def check_in(cls, user_id: int) -> dict:
        today = datetime.now().strftime("%Y-%m-%d")
        reward = cls.checkin_reward()
        with get_db() as conn:
            existing = conn.execute(
                "SELECT id FROM daily_checkins WHERE user_id = %s AND checkin_date = %s",
                (user_id, today),
            ).fetchone()
            if existing:
                raise ValueError("今日已签到")
            conn.execute(
                "INSERT INTO daily_checkins (user_id, checkin_date) VALUES (%s, %s)",
                (user_id, today),
            )
            conn.execute("UPDATE users SET points = points + %s WHERE id = %s", (reward, user_id))
            new_balance = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()["points"]
            conn.execute(
                "INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (%s, %s, %s, %s, %s)",
                (user_id, reward, new_balance, "daily_checkin", "每日签到"),
            )
            return {"success": True, "points": new_balance, "message": f"签到成功 +{reward}"}

    @classmethod
    def has_checked_in_today(cls, user_id: int) -> bool:
        today = datetime.now().strftime("%Y-%m-%d")
        with get_db() as conn:
            row = conn.execute(
                "SELECT id FROM daily_checkins WHERE user_id = %s AND checkin_date = %s",
                (user_id, today),
            ).fetchone()
            return row is not None

    @classmethod
    def redeem_code(cls, code: str, user_id: int, ip: str) -> dict:
        with get_db() as conn:
            row = conn.execute(
                "SELECT id, points, is_used FROM redemption_codes WHERE code = %s",
                (code.strip().upper(),),
            ).fetchone()
            if not row:
                raise ValueError("兑换码不存在")
            if row["is_used"]:
                raise ValueError("兑换码已被使用")
            points_to_add = row["points"]
            conn.execute(
                "UPDATE redemption_codes SET is_used = true, used_by = %s, used_by_ip = %s, used_at = %s WHERE id = %s",
                (user_id, ip, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), row["id"]),
            )
            conn.execute("UPDATE users SET points = points + %s WHERE id = %s", (points_to_add, user_id))
            new_balance = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()["points"]
            conn.execute(
                "INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (%s, %s, %s, %s, %s)",
                (user_id, points_to_add, new_balance, "redeem_code", f"兑换码兑换 ({code.strip().upper()})"),
            )
            return {"success": True, "points_awarded": points_to_add, "balance": new_balance}

    @classmethod
    def migrate_existing_users(cls) -> dict:
        amount = cls.migration_amount()
        with get_db() as conn:
            users = conn.execute("SELECT id FROM users WHERE points = 0").fetchall()
            count = 0
            for user in users:
                uid = user["id"]
                conn.execute("UPDATE users SET points = points + %s WHERE id = %s", (amount, uid))
                new_balance = conn.execute("SELECT points FROM users WHERE id = %s", (uid,)).fetchone()["points"]
                conn.execute(
                    "INSERT INTO point_transactions (user_id, amount, balance_after, type, description) VALUES (%s, %s, %s, %s, %s)",
                    (uid, amount, new_balance, "migration", "系统补发"),
                )
                count += 1
            return {"migrated": count}
    @classmethod
    def _add_points_in_conn(cls, conn, user_id: int, amount: int, tx_type: str, description: str = "", request_key: str = "", recharge_request_id=None) -> int:
        if request_key:
            existing=conn.execute("SELECT balance_after FROM point_transactions WHERE request_key = %s",(request_key,)).fetchone()
            if existing:
                return existing["balance_after"]
        conn.execute("UPDATE users SET points = points + %s WHERE id = %s", (amount, user_id))
        row = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()
        if not row:
            raise ValueError("用户不存在")
        new_balance = row["points"]
        if request_key:
            conn.execute("INSERT INTO point_transactions (user_id, amount, balance_after, type, description, request_key, recharge_request_id) VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",(user_id, amount, new_balance, tx_type, description, request_key, recharge_request_id))
        else:
            conn.execute("INSERT INTO point_transactions (user_id, amount, balance_after, type, description, recharge_request_id) VALUES (%s, %s, %s, %s, %s, %s)",(user_id, amount, new_balance, tx_type, description, recharge_request_id))
        return new_balance
