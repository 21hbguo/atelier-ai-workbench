from datetime import datetime
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP

from backend.database import get_db
from backend.config import get_limit_config
from backend.services.subscription_service import ensure_current_cycle_in_conn


def _integer_amount(value, rounding=ROUND_HALF_UP) -> int:
    try:
        return int(Decimal(str(value)).to_integral_value(rounding=rounding))
    except Exception:
        return 0


class PointsService:
    @classmethod
    def cost_per_generation(cls) -> int:
        return get_limit_config()["points_cost_per_generation"]

    @classmethod
    def cost_per_optimize(cls, mode: str = "simple") -> int:
        cfg = get_limit_config()
        return cfg["points_cost_per_optimize_refine"] if mode == "refine" else cfg["points_cost_per_optimize"]

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
            return int(row["points"] or 0) if row else 0

    @classmethod
    def has_enough(cls, user_id: int, amount: float) -> bool:
        required = _integer_amount(amount, ROUND_CEILING)
        with get_db() as conn:
            user = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()
            return bool(user and int(user["points"] or 0) >= required)

    @classmethod
    def consume(cls, user_id: int, amount: float, description: str = "", tx_type: str = "generate_consume", request_key: str = "", conn=None, bucket_type: str | None = None) -> int:
        amount = _integer_amount(amount, ROUND_CEILING)
        if amount <= 0:
            return cls.get_balance(user_id)
        if conn is not None:
            return cls._consume_in_conn(conn, user_id, amount, description, tx_type, request_key, bucket_type)
        with get_db() as c:
            return cls._consume_in_conn(c, user_id, amount, description, tx_type, request_key, bucket_type)

    @classmethod
    def consume_with_breakdown(cls, user_id: int, amount: float, description: str = "", tx_type: str = "generate_consume", request_key: str = "") -> dict:
        amount = _integer_amount(amount, ROUND_CEILING)
        if amount <= 0:
            return {"balance": cls.get_balance(user_id), "subscription_points_used": 0, "wallet_points_used": 0}
        with get_db() as conn:
            balance = cls._consume_in_conn(conn, user_id, amount, description, tx_type, request_key)
            breakdown = cls._allocation_breakdown_in_conn(conn, user_id, [request_key])
        return {"balance": balance, **breakdown}

    @classmethod
    def add_points(cls, user_id: int, amount: float, tx_type: str, description: str = "", conn=None, request_key: str = "", recharge_request_id=None) -> int:
        amount = _integer_amount(amount)
        if amount <= 0:
            return cls.get_balance(user_id) if conn is None else cls._balance_in_conn(conn, user_id)
        if conn is not None:
            return cls._add_points_in_conn(conn, user_id, amount, tx_type, description, request_key, recharge_request_id)
        with get_db() as c:
            return cls._add_points_in_conn(c, user_id, amount, tx_type, description, request_key, recharge_request_id)

    @classmethod
    def refund(cls, user_id: int, amount: float, description: str = "", request_key: str = "") -> int:
        amount = _integer_amount(amount, ROUND_CEILING)
        if amount <= 0:
            return cls.get_balance(user_id)
        with get_db() as conn:
            user = conn.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
            if not user:
                raise ValueError("用户不存在")
            if request_key:
                existing = conn.execute("SELECT balance_after FROM point_transactions WHERE request_key = %s", (request_key,)).fetchone()
                if existing:
                    return int(existing["balance_after"] or 0)
            ensure_current_cycle_in_conn(conn, user_id)
            original_key = cls._original_request_key(request_key)
            original = conn.execute(
                "SELECT id FROM point_transactions WHERE user_id = %s AND request_key = %s AND amount < 0",
                (user_id, original_key),
            ).fetchone() if original_key else None
            allocations = conn.execute(
                """SELECT a.bucket_id, ABS(a.amount) AS amount, b.bucket_type, b.expires_at, b.status
                   FROM point_transaction_allocations a JOIN point_buckets b ON b.id = a.bucket_id
                   WHERE a.transaction_id = %s ORDER BY a.id ASC""",
                (original["id"],),
            ).fetchall() if original else []
            remaining = amount
            refund_allocations = []
            now = datetime.now()
            for item in allocations:
                if remaining <= 0:
                    break
                is_expired = item["bucket_type"] == "subscription" and (item["status"] != "active" or (item["expires_at"] and item["expires_at"] <= now))
                if is_expired:
                    continue
                part = min(remaining, int(item["amount"] or 0))
                if part:
                    bucket_id = item["bucket_id"]
                    conn.execute("UPDATE point_buckets SET remaining_points = remaining_points + %s WHERE id = %s", (part, bucket_id))
                    if item["bucket_type"] == "subscription":
                        conn.execute("UPDATE subscription_cycles SET remaining_points = (SELECT remaining_points FROM point_buckets WHERE cycle_id = subscription_cycles.id) WHERE id = (SELECT cycle_id FROM point_buckets WHERE id = %s)", (bucket_id,))
                    refund_allocations.append((bucket_id, part))
                    remaining -= part
            if remaining:
                permanent = conn.execute(
                    "SELECT id FROM point_buckets WHERE user_id = %s AND bucket_type = 'permanent' FOR UPDATE", (user_id,)
                ).fetchone()
                conn.execute("UPDATE point_buckets SET remaining_points = remaining_points + %s WHERE id = %s", (remaining, permanent["id"]))
                refund_allocations.append((permanent["id"], remaining))
            conn.execute("UPDATE users SET points = points + %s WHERE id = %s", (amount, user_id))
            balance = cls._balance_in_conn(conn, user_id)
            tx = cls._insert_transaction(conn, user_id, amount, balance, "generate_refund", description, request_key)
            if tx:
                for bucket_id, part in refund_allocations:
                    conn.execute("INSERT INTO point_transaction_allocations (transaction_id, bucket_id, amount) VALUES (%s, %s, %s)", (tx, bucket_id, part))
            return balance

    @classmethod
    def check_in(cls, user_id: int) -> dict:
        today = datetime.now().strftime("%Y-%m-%d")
        reward = cls.checkin_reward()
        with get_db() as conn:
            existing = conn.execute("SELECT id FROM daily_checkins WHERE user_id = %s AND checkin_date = %s", (user_id, today)).fetchone()
            if existing:
                raise ValueError("今日已签到")
            conn.execute("INSERT INTO daily_checkins (user_id, checkin_date) VALUES (%s, %s)", (user_id, today))
            new_balance = cls._add_points_in_conn(conn, user_id, reward, "daily_checkin", "每日签到", "", None)
            return {"success": True, "points": new_balance, "message": f"签到成功 +{reward}"}

    @classmethod
    def has_checked_in_today(cls, user_id: int) -> bool:
        today = datetime.now().strftime("%Y-%m-%d")
        with get_db() as conn:
            row = conn.execute("SELECT id FROM daily_checkins WHERE user_id = %s AND checkin_date = %s", (user_id, today)).fetchone()
            return row is not None

    @classmethod
    def redeem_code(cls, code: str, user_id: int, ip: str) -> dict:
        with get_db() as conn:
            row = conn.execute("SELECT id, points, is_used FROM redemption_codes WHERE code = %s FOR UPDATE", (code.strip().upper(),)).fetchone()
            if not row:
                raise ValueError("兑换码不存在")
            if row["is_used"]:
                raise ValueError("兑换码已被使用")
            points_to_add = int(row["points"] or 0)
            conn.execute("UPDATE redemption_codes SET is_used = true, used_by = %s, used_by_ip = %s, used_at = %s WHERE id = %s", (user_id, ip, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), row["id"]))
            new_balance = cls._add_points_in_conn(conn, user_id, points_to_add, "redeem_code", f"兑换码兑换 ({code.strip().upper()})", "", None)
            return {"success": True, "points_awarded": points_to_add, "balance": new_balance}

    @classmethod
    def migrate_existing_users(cls) -> dict:
        amount = cls.migration_amount()
        with get_db() as conn:
            users = conn.execute("SELECT id FROM users WHERE points = 0").fetchall()
            count = 0
            for user in users:
                cls._add_points_in_conn(conn, user["id"], amount, "migration", "系统补发", "", None)
                count += 1
            return {"migrated": count}

    @classmethod
    def _balance_in_conn(cls, conn, user_id: int) -> int:
        row = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()
        if not row:
            raise ValueError("用户不存在")
        return int(row["points"] or 0)

    @classmethod
    def _insert_transaction(cls, conn, user_id, amount, balance, tx_type, description, request_key="", recharge_request_id=None):
        if request_key:
            row = conn.execute(
                """INSERT INTO point_transactions
                   (user_id, amount, balance_after, type, description, request_key, recharge_request_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT DO NOTHING RETURNING id""",
                (user_id, amount, balance, tx_type, description, request_key, recharge_request_id),
            ).fetchone()
            return row["id"] if row else None
        row = conn.execute(
            """INSERT INTO point_transactions
               (user_id, amount, balance_after, type, description, recharge_request_id)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
            (user_id, amount, balance, tx_type, description, recharge_request_id),
        ).fetchone()
        return row["id"] if row else None

    @classmethod
    def _allocation_breakdown_in_conn(cls, conn, user_id: int, request_keys: list[str]) -> dict:
        keys = [str(key) for key in request_keys if key]
        if not keys:
            return {"subscription_points_used": 0, "wallet_points_used": 0}
        row = conn.execute(
            """SELECT
                 COALESCE(SUM(CASE WHEN b.bucket_type = 'subscription' THEN CASE WHEN t.amount < 0 THEN a.amount ELSE -a.amount END ELSE 0 END), 0) AS subscription_points_used,
                 COALESCE(SUM(CASE WHEN b.bucket_type = 'permanent' THEN CASE WHEN t.amount < 0 THEN a.amount ELSE -a.amount END ELSE 0 END), 0) AS wallet_points_used
               FROM point_transaction_allocations a
               JOIN point_transactions t ON t.id = a.transaction_id
               JOIN point_buckets b ON b.id = a.bucket_id
               WHERE t.user_id = %s AND t.request_key = ANY(%s)""",
            (user_id, keys),
        ).fetchone()
        return {
            "subscription_points_used": max(0, int(row["subscription_points_used"] or 0)) if row else 0,
            "wallet_points_used": max(0, int(row["wallet_points_used"] or 0)) if row else 0,
        }

    @classmethod
    def get_allocation_breakdown(cls, user_id: int, request_keys: list[str]) -> dict:
        with get_db() as conn:
            return cls._allocation_breakdown_in_conn(conn, user_id, request_keys)

    @classmethod
    def _add_points_in_conn(cls, conn, user_id, amount, tx_type, description="", request_key="", recharge_request_id=None):
        user = conn.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if not user:
            raise ValueError("用户不存在")
        if request_key:
            existing = conn.execute("SELECT balance_after FROM point_transactions WHERE request_key = %s", (request_key,)).fetchone()
            if existing:
                return int(existing["balance_after"] or 0)
        ensure_current_cycle_in_conn(conn, user_id)
        bucket = conn.execute("SELECT id FROM point_buckets WHERE user_id = %s AND bucket_type = 'permanent' FOR UPDATE", (user_id,)).fetchone()
        conn.execute("UPDATE point_buckets SET granted_points = granted_points + %s, remaining_points = remaining_points + %s WHERE id = %s", (amount, amount, bucket["id"]))
        conn.execute("UPDATE users SET points = points + %s WHERE id = %s", (amount, user_id))
        balance = cls._balance_in_conn(conn, user_id)
        tx = cls._insert_transaction(conn, user_id, amount, balance, tx_type, description, request_key, recharge_request_id)
        if tx:
            conn.execute("INSERT INTO point_transaction_allocations (transaction_id, bucket_id, amount) VALUES (%s, %s, %s)", (tx, bucket["id"], amount))
        return balance

    @classmethod
    def _consume_in_conn(cls, conn, user_id, amount, description="", tx_type="generate_consume", request_key="", bucket_type=None):
        user = conn.execute("SELECT id, points FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if not user:
            raise ValueError("用户不存在")
        if request_key:
            existing = conn.execute("SELECT balance_after FROM point_transactions WHERE request_key = %s", (request_key,)).fetchone()
            if existing:
                return int(existing["balance_after"] or 0)
        ensure_current_cycle_in_conn(conn, user_id)
        user = conn.execute("SELECT id, points FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if int(user["points"] or 0) < amount:
            raise ValueError("积分不足")
        now = datetime.now()
        buckets = conn.execute(
            """SELECT id, bucket_type, cycle_id, remaining_points FROM point_buckets
               WHERE user_id = %s AND remaining_points > 0 AND status = 'active'
                 AND (bucket_type = 'permanent' OR expires_at IS NULL OR expires_at > %s)
                 AND (bucket_type = %s OR %s::varchar IS NULL)
               ORDER BY CASE WHEN bucket_type = 'subscription' THEN 0 ELSE 1 END,
                        CASE WHEN bucket_type = 'subscription' THEN expires_at END ASC NULLS LAST, id ASC
               FOR UPDATE""",
            (user_id, now, bucket_type, bucket_type),
        ).fetchall()
        remaining = amount
        allocations = []
        for bucket in buckets:
            if remaining <= 0:
                break
            part = min(remaining, int(bucket["remaining_points"] or 0))
            if part:
                conn.execute("UPDATE point_buckets SET remaining_points = remaining_points - %s WHERE id = %s", (part, bucket["id"]))
                if bucket["bucket_type"] == "subscription":
                    conn.execute("UPDATE subscription_cycles SET remaining_points = %s WHERE id = %s", (int(bucket["remaining_points"] or 0) - part, bucket["cycle_id"]))
                allocations.append((bucket["id"], part))
                remaining -= part
        if remaining:
            raise ValueError("积分不足")
        conn.execute("UPDATE users SET points = points - %s WHERE id = %s", (amount, user_id))
        balance = cls._balance_in_conn(conn, user_id)
        tx = cls._insert_transaction(conn, user_id, -amount, balance, tx_type, description, request_key)
        if tx:
            for bucket_id, part in allocations:
                conn.execute("INSERT INTO point_transaction_allocations (transaction_id, bucket_id, amount) VALUES (%s, %s, %s)", (tx, bucket_id, part))
        return balance

    @classmethod
    def grant_subscription_points_in_conn(cls, conn, user_id: int, bucket_id: int, cycle_id: int,
                                          amount: int, description: str, request_key: str) -> int:
        """把订阅周期积分写入订阅桶、用户余额和积分流水。"""
        amount = max(0, int(amount or 0))
        user = conn.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if not user:
            raise ValueError("用户不存在")
        if request_key:
            existing = conn.execute("SELECT balance_after FROM point_transactions WHERE request_key = %s", (request_key,)).fetchone()
            if existing:
                return int(existing["balance_after"] or 0)
        bucket = conn.execute(
            "SELECT id FROM point_buckets WHERE id = %s AND user_id = %s AND bucket_type = 'subscription' FOR UPDATE",
            (bucket_id, user_id),
        ).fetchone()
        if not bucket:
            raise ValueError("订阅积分桶不存在")
        if amount:
            conn.execute(
                "UPDATE point_buckets SET granted_points = granted_points + %s, remaining_points = remaining_points + %s, status = 'active' WHERE id = %s",
                (amount, amount, bucket_id),
            )
            conn.execute(
                "UPDATE subscription_cycles SET granted_points = granted_points + %s, remaining_points = remaining_points + %s WHERE id = %s",
                (amount, amount, cycle_id),
            )
            conn.execute("UPDATE users SET points = points + %s WHERE id = %s", (amount, user_id))
        balance = cls._balance_in_conn(conn, user_id)
        tx = cls._insert_transaction(conn, user_id, amount, balance, "subscription_grant", description, request_key)
        if tx and amount:
            conn.execute(
                "INSERT INTO point_transaction_allocations (transaction_id, bucket_id, amount) VALUES (%s, %s, %s)",
                (tx, bucket_id, amount),
            )
        return balance

    @classmethod
    def expire_subscription_bucket_in_conn(cls, conn, user_id: int, bucket_id: int, amount: int, cycle_id: int, request_key: str, description: str) -> int:
        """清零订阅桶并写入负向流水，供订阅周期过期处理调用。"""
        amount = max(0, int(amount or 0))
        if amount <= 0:
            return cls._balance_in_conn(conn, user_id)
        user = conn.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if not user:
            raise ValueError("用户不存在")
        bucket = conn.execute(
            "SELECT remaining_points, status FROM point_buckets WHERE id = %s AND user_id = %s FOR UPDATE",
            (bucket_id, user_id),
        ).fetchone()
        if not bucket or bucket["status"] != "active":
            return cls._balance_in_conn(conn, user_id)
        amount = min(amount, int(bucket["remaining_points"] or 0))
        if amount <= 0:
            conn.execute("UPDATE point_buckets SET status = 'expired' WHERE id = %s", (bucket_id,))
            return cls._balance_in_conn(conn, user_id)
        conn.execute(
            "UPDATE point_buckets SET remaining_points = 0, status = 'expired' WHERE id = %s",
            (bucket_id,),
        )
        conn.execute("UPDATE subscription_cycles SET remaining_points = 0 WHERE id = %s", (cycle_id,))
        cur = conn.execute("UPDATE users SET points = points - %s WHERE id = %s AND points >= %s", (amount, user_id, amount))
        if cur.rowcount != 1:
            raise ValueError("积分账本不一致，无法清零订阅积分")
        balance = cls._balance_in_conn(conn, user_id)
        tx = cls._insert_transaction(conn, user_id, -amount, balance, "subscription_expire", description, request_key)
        if tx:
            conn.execute(
                "INSERT INTO point_transaction_allocations (transaction_id, bucket_id, amount) VALUES (%s, %s, %s)",
                (tx, bucket_id, -amount),
            )
        return balance

    @staticmethod
    def _original_request_key(request_key: str) -> str:
        key = str(request_key or "")
        for prefix, original in (("chat_refund:", "chat:"), ("chat_token_adjust:", "chat:"), ("refund:", "consume:"), ("optimize_refund:", "optimize:")):
            if key.startswith(prefix):
                return original + key[len(prefix):]
        return ""
