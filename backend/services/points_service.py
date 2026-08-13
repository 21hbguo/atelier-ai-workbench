from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from backend.database import get_db
from backend.config import get_limit_config
from backend.services.subscription_service import ensure_current_cycle_in_conn


_POINT_QUANTUM = Decimal("0.0001")


def _point_amount(value) -> Decimal:
    try:
        return Decimal(str(value)).quantize(_POINT_QUANTUM, rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal(0)


class PointsService:
    @classmethod
    def cost_per_generation(cls) -> float:
        return get_limit_config()["points_cost_per_generation"]

    @classmethod
    def cost_per_optimize(cls, mode: str = "simple") -> float:
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
    def get_balance(cls, user_id: int) -> Decimal:
        with get_db() as conn:
            row = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()
            return _point_amount(row["points"] or 0) if row else Decimal(0)

    @classmethod
    def has_enough(cls, user_id: int, amount: float) -> bool:
        required = _point_amount(amount)
        with get_db() as conn:
            user = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()
            return bool(user and _point_amount(user["points"] or 0) >= required)

    @classmethod
    def consume(cls, user_id: int, amount: float, description: str = "", tx_type: str = "generate_consume", request_key: str = "", conn=None, bucket_type: str | None = None, model_id: str = "") -> Decimal:
        amount = _point_amount(amount)
        if amount <= 0:
            return cls.get_balance(user_id)
        if conn is not None:
            return cls._consume_in_conn(conn, user_id, amount, description, tx_type, request_key, bucket_type, model_id)
        with get_db() as c:
            return cls._consume_in_conn(c, user_id, amount, description, tx_type, request_key, bucket_type, model_id)

    @classmethod
    def consume_with_breakdown(cls, user_id: int, amount: float, description: str = "", tx_type: str = "generate_consume", request_key: str = "", model_id: str = "") -> dict:
        amount = _point_amount(amount)
        if amount <= 0:
            return {"balance": cls.get_balance(user_id), "subscription_points_used": 0, "wallet_points_used": 0}
        with get_db() as conn:
            balance = cls._consume_in_conn(conn, user_id, amount, description, tx_type, request_key, model_id=model_id)
            breakdown = cls._allocation_breakdown_in_conn(conn, user_id, [request_key])
        return {"balance": balance, **breakdown}

    @classmethod
    def get_ai_daily_quota(cls, user_id: int, is_free_user: bool) -> dict:
        """AI 助手每日免费次数查询（只读展示，不落库）。

        - 非免费用户：total=0, remaining=0（订阅用户不消耗每日次数）
        - 免费用户：total=全局 ai_daily_free_quota；ai_daily_quota_date 不是今天（含 NULL）
          时展示 remaining=total（懒重置，展示用），否则展示字段值。
        """
        total = int(get_limit_config()["ai_daily_free_quota"])
        if not is_free_user:
            return {"total": 0, "remaining": 0}
        today = datetime.now().strftime("%Y-%m-%d")
        with get_db() as conn:
            row = conn.execute(
                "SELECT ai_daily_quota_remaining, ai_daily_quota_date FROM users WHERE id = %s",
                (user_id,),
            ).fetchone()
        if not row:
            return {"total": total, "remaining": total}
        date = row["ai_daily_quota_date"]
        if date is None or date.strftime("%Y-%m-%d") != today:
            return {"total": total, "remaining": total}
        return {"total": total, "remaining": max(0, int(row["ai_daily_quota_remaining"] or 0))}

    @classmethod
    def consume_ai_chat(cls, user_id: int, amount: float, description: str, request_key: str, is_free_user: bool, model_id: str = "") -> dict:
        """AI 助手对话预扣：免费用户优先消耗每日免费次数（固定 1 次/对话），
        次数用尽或订阅用户则扣通用积分（users.points）。

        返回 {"mode": "free"|"paid", "balance": Decimal, "remaining": int}；
        余额不足时抛 ValueError（由调用方转 402）。
        """
        amount = _point_amount(amount)
        if amount <= 0:
            return {"mode": "paid", "balance": cls.get_balance(user_id), "remaining": 0}
        today = datetime.now().strftime("%Y-%m-%d")
        total = int(get_limit_config()["ai_daily_free_quota"])
        with get_db() as conn:
            user = conn.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
            if not user:
                raise ValueError("用户不存在")
            # 幂等：request_key 已有流水（免费标记 amount=0 或普通负流水）→ 返回当前状态，不重复扣
            if request_key:
                existing = conn.execute(
                    "SELECT type FROM point_transactions WHERE request_key = %s", (request_key,),
                ).fetchone()
                if existing:
                    cur = conn.execute("SELECT points, ai_daily_quota_remaining FROM users WHERE id = %s", (user_id,)).fetchone()
                    mode = "free" if existing["type"] == "ai_daily_free" else "paid"
                    return {"mode": mode, "balance": _point_amount(cur["points"] or 0), "remaining": int(cur["ai_daily_quota_remaining"] or 0)}
            if is_free_user:
                # 懒重置：当天首次使用时把剩余次数重置为 total（仅当日期不是今天时生效）
                conn.execute(
                    "UPDATE users SET ai_daily_quota_remaining = %s, ai_daily_quota_date = %s WHERE id = %s AND ai_daily_quota_date IS DISTINCT FROM %s",
                    (total, today, user_id, today),
                )
                row = conn.execute("SELECT ai_daily_quota_remaining FROM users WHERE id = %s", (user_id,)).fetchone()
                if row["ai_daily_quota_remaining"] is not None and int(row["ai_daily_quota_remaining"]) > 0:
                    conn.execute("UPDATE users SET ai_daily_quota_remaining = ai_daily_quota_remaining - 1 WHERE id = %s", (user_id,))
                    cur = conn.execute("SELECT points, ai_daily_quota_remaining FROM users WHERE id = %s", (user_id,)).fetchone()
                    balance = _point_amount(cur["points"] or 0)
                    remaining = int(cur["ai_daily_quota_remaining"] or 0)
                    # amount=0 免费次数扣减标记：仅用于幂等与流水可见性，不动积分
                    conn.execute(
                        """INSERT INTO point_transactions (user_id, amount, balance_after, type, description, request_key, model_id)
                           VALUES (%s, 0, %s, 'ai_daily_free', %s, %s, %s) ON CONFLICT DO NOTHING""",
                        (user_id, balance, description, request_key, model_id or None),
                    )
                    return {"mode": "free", "balance": balance, "remaining": remaining}
            # 订阅用户或免费次数已用尽 → 扣通用积分（余额不足抛 ValueError）
            balance = cls._consume_in_conn(conn, user_id, amount, description, tx_type="chat_consume", request_key=request_key, model_id=model_id)
            return {"mode": "paid", "balance": balance, "remaining": 0}

    @classmethod
    def refund_ai_chat(cls, user_id: int, amount: float, description: str, request_key: str, mode: str, model_id: str = "") -> Decimal:
        """AI 助手对话失败退款。

        - mode != "free"：原样委托 cls.refund（普通积分退款，含桶分配回退）
        - mode == "free"：免费次数 +1（幂等：退款标记流水已存在则直接返回当前余额）
        """
        if mode != "free":
            return cls.refund(user_id, amount, description, request_key=request_key, tx_type="chat_refund", model_id=model_id)
        with get_db() as conn:
            user = conn.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
            if not user:
                raise ValueError("用户不存在")
            if request_key:
                existing = conn.execute(
                    "SELECT 1 FROM point_transactions WHERE request_key = %s AND amount = 0", (request_key,),
                ).fetchone()
                if existing:
                    return cls._balance_in_conn(conn, user_id)
            conn.execute("UPDATE users SET ai_daily_quota_remaining = ai_daily_quota_remaining + 1 WHERE id = %s", (user_id,))
            balance = cls._balance_in_conn(conn, user_id)
            conn.execute(
                """INSERT INTO point_transactions (user_id, amount, balance_after, type, description, request_key, model_id)
                   VALUES (%s, 0, %s, 'ai_daily_free_refund', %s, %s, %s) ON CONFLICT DO NOTHING""",
                (user_id, balance, description, request_key, model_id or None),
            )
            return balance

    @classmethod
    def add_points(cls, user_id: int, amount: float, tx_type: str, description: str = "", conn=None, request_key: str = "", recharge_request_id=None) -> Decimal:
        amount = _point_amount(amount)
        if amount <= 0:
            return cls.get_balance(user_id) if conn is None else cls._balance_in_conn(conn, user_id)
        if conn is not None:
            return cls._add_points_in_conn(conn, user_id, amount, tx_type, description, request_key, recharge_request_id)
        with get_db() as c:
            return cls._add_points_in_conn(c, user_id, amount, tx_type, description, request_key, recharge_request_id)

    @classmethod
    def refund(cls, user_id: int, amount: float, description: str = "", request_key: str = "", tx_type: str = "generate_refund", model_id: str = "") -> Decimal:
        amount = _point_amount(amount)
        if amount <= 0:
            return cls.get_balance(user_id)
        with get_db() as conn:
            user = conn.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
            if not user:
                raise ValueError("用户不存在")
            if request_key:
                existing = conn.execute("SELECT balance_after FROM point_transactions WHERE request_key = %s", (request_key,)).fetchone()
                if existing:
                    return _point_amount(existing["balance_after"] or 0)
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
                part = min(remaining, _point_amount(item["amount"] or 0))
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
            tx = cls._insert_transaction(conn, user_id, amount, balance, tx_type, description, request_key, model_id=model_id)
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
            points_to_add = _point_amount(row["points"] or 0)
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
    def _balance_in_conn(cls, conn, user_id: int) -> Decimal:
        row = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()
        if not row:
            raise ValueError("用户不存在")
        return _point_amount(row["points"] or 0)

    @classmethod
    def _insert_transaction(cls, conn, user_id, amount, balance, tx_type, description, request_key="", recharge_request_id=None, model_id=""):
        if request_key:
            row = conn.execute(
                """INSERT INTO point_transactions
                   (user_id, amount, balance_after, type, description, request_key, recharge_request_id, model_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT DO NOTHING RETURNING id""",
                (user_id, amount, balance, tx_type, description, request_key, recharge_request_id, model_id or None),
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
            "subscription_points_used": max(Decimal(0), _point_amount(row["subscription_points_used"] or 0)) if row else Decimal(0),
            "wallet_points_used": max(Decimal(0), _point_amount(row["wallet_points_used"] or 0)) if row else Decimal(0),
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
                return _point_amount(existing["balance_after"] or 0)
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
    def _consume_in_conn(cls, conn, user_id, amount, description="", tx_type="generate_consume", request_key="", bucket_type=None, model_id=""):
        user = conn.execute("SELECT id, points FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if not user:
            raise ValueError("用户不存在")
        if request_key:
            existing = conn.execute("SELECT balance_after FROM point_transactions WHERE request_key = %s", (request_key,)).fetchone()
            if existing:
                return _point_amount(existing["balance_after"] or 0)
        ensure_current_cycle_in_conn(conn, user_id)
        user = conn.execute("SELECT id, points FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if _point_amount(user["points"] or 0) < amount:
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
            part = min(remaining, _point_amount(bucket["remaining_points"] or 0))
            if part:
                conn.execute("UPDATE point_buckets SET remaining_points = remaining_points - %s WHERE id = %s", (part, bucket["id"]))
                if bucket["bucket_type"] == "subscription":
                    conn.execute("UPDATE subscription_cycles SET remaining_points = %s WHERE id = %s", (_point_amount(bucket["remaining_points"] or 0) - part, bucket["cycle_id"]))
                allocations.append((bucket["id"], part))
                remaining -= part
        if remaining:
            raise ValueError("积分不足")
        conn.execute("UPDATE users SET points = points - %s WHERE id = %s", (amount, user_id))
        balance = cls._balance_in_conn(conn, user_id)
        tx = cls._insert_transaction(conn, user_id, -amount, balance, tx_type, description, request_key, model_id=model_id)
        if tx:
            for bucket_id, part in allocations:
                conn.execute("INSERT INTO point_transaction_allocations (transaction_id, bucket_id, amount) VALUES (%s, %s, %s)", (tx, bucket_id, part))
        return balance

    @classmethod
    def grant_subscription_points_in_conn(cls, conn, user_id: int, bucket_id: int, cycle_id: int,
                                          amount: float, description: str, request_key: str) -> Decimal:
        """把订阅周期积分写入订阅桶、用户余额和积分流水。"""
        amount = max(Decimal(0), _point_amount(amount))
        user = conn.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if not user:
            raise ValueError("用户不存在")
        if request_key:
            existing = conn.execute("SELECT balance_after FROM point_transactions WHERE request_key = %s", (request_key,)).fetchone()
            if existing:
                return _point_amount(existing["balance_after"] or 0)
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
    def expire_subscription_bucket_in_conn(cls, conn, user_id: int, bucket_id: int, amount: float, cycle_id: int, request_key: str, description: str) -> Decimal:
        """清零订阅桶并写入负向流水，供订阅周期过期处理调用。"""
        amount = max(Decimal(0), _point_amount(amount))
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
        amount = min(amount, _point_amount(bucket["remaining_points"] or 0))
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
