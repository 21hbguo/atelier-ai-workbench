from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP


_POINT_QUANTUM = Decimal("0.0001")


def _points(value) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(_POINT_QUANTUM, rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal(0)


FEATURE_DEFAULTS = {
    "web_search": True,
    "file_upload": True,
    "file_write": True,
    "max_tool_calls": 10,
    "max_chat_sessions": 100,
    "max_chat_files": 20,
}


def _json(value, default):
    if isinstance(value, (dict, list)):
        return value
    return default


def _plan_dict(row) -> dict:
    if not row:
        return {}
    plan = dict(row)
    plan["features"] = {**FEATURE_DEFAULTS, **(_json(plan.get("features"), {}))}
    plan["allowed_models"] = _json(plan.get("allowed_models"), [])
    plan["is_free"] = bool(plan.get("is_free"))
    return plan


def _snapshot(plan: dict) -> dict:
    return {
        "id": plan.get("id"),
        "code": plan.get("code"),
        "name": plan.get("name"),
        "description": plan.get("description") or "",
        "price_rmb": str(plan.get("price_rmb") or 0),
        "cycle_days": int(plan.get("cycle_days") or 30),
        "grant_points": float(_points(plan.get("grant_points"))),
        "features": dict(plan.get("features") or {}),
        "allowed_models": list(plan.get("allowed_models") or []),
        "max_concurrent_requests": int(plan.get("max_concurrent_requests") or 1),
        "is_free": bool(plan.get("is_free")),
    }


def _cycle_plan(cycle: dict) -> dict:
    snapshot = _json(cycle.get("entitlements_snapshot"), {})
    plan = dict(snapshot)
    plan["features"] = {**FEATURE_DEFAULTS, **(_json(plan.get("features"), {}))}
    plan["allowed_models"] = _json(plan.get("allowed_models"), [])
    plan["is_free"] = bool(plan.get("is_free"))
    return plan


def _order_plan(order: dict) -> dict:
    plan = dict(_json(order.get("plan_snapshot"), {}))
    plan["id"] = order["plan_id"]
    plan["features"] = {**FEATURE_DEFAULTS, **(_json(plan.get("features"), {}))}
    plan["allowed_models"] = _json(plan.get("allowed_models"), [])
    plan["is_free"] = bool(plan.get("is_free"))
    return plan


def _get_plan(conn, plan_id=None, code=None, for_update=False):
    suffix = " FOR UPDATE" if for_update else ""
    if plan_id is not None:
        row = conn.execute(f"SELECT * FROM subscription_plans WHERE id = %s{suffix}", (plan_id,)).fetchone()
    else:
        row = conn.execute(f"SELECT * FROM subscription_plans WHERE code = %s{suffix}", (code,)).fetchone()
    return _plan_dict(row) if row else None


def _record_transaction(conn, user_id: int, amount: Decimal, tx_type: str, description: str, request_key: str = "", bucket_id=None):
    if request_key:
        existing = conn.execute(
            "SELECT balance_after FROM point_transactions WHERE request_key = %s", (request_key,)
        ).fetchone()
        if existing:
            return _points(existing["balance_after"])
    balance = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()["points"]
    if request_key:
        row = conn.execute(
            """INSERT INTO point_transactions
               (user_id, amount, balance_after, type, description, request_key)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT DO NOTHING RETURNING id""",
            (user_id, amount, balance, tx_type, description, request_key),
        ).fetchone()
    else:
        row = conn.execute(
            """INSERT INTO point_transactions
               (user_id, amount, balance_after, type, description)
               VALUES (%s, %s, %s, %s, %s) RETURNING id""",
            (user_id, amount, balance, tx_type, description),
        ).fetchone()
    if row and bucket_id is not None and amount:
        conn.execute(
            "INSERT INTO point_transaction_allocations (transaction_id, bucket_id, amount) VALUES (%s, %s, %s)",
            (row["id"], bucket_id, amount),
        )
    return _points(balance)


def _expire_cycle_in_conn(conn, cycle: dict, user_id: int, now: datetime):
    from backend.services.points_service import PointsService

    cycle_id = cycle["id"]
    bucket = conn.execute(
        "SELECT id, remaining_points, status FROM point_buckets WHERE cycle_id = %s FOR UPDATE", (cycle_id,)
    ).fetchone()
    if bucket:
        remaining = _points(bucket["remaining_points"])
        if bucket["status"] == "active" and remaining > 0:
            PointsService.expire_subscription_bucket_in_conn(
                conn, user_id, bucket["id"], remaining, cycle_id,
                f"subscription-expire:{cycle_id}", f"订阅周期到期清零 ({cycle_id})",
            )
        else:
            conn.execute("UPDATE point_buckets SET remaining_points = 0, status = 'expired' WHERE id = %s", (bucket["id"],))
    conn.execute(
        "UPDATE subscription_cycles SET status = 'expired', remaining_points = 0 WHERE id = %s AND status = 'active'",
        (cycle_id,),
    )


def _create_cycle_in_conn(conn, user_id: int, subscription_id: int, plan: dict, start: datetime, order_id=None):
    days = max(1, int(plan.get("cycle_days") or 30))
    end = start + timedelta(days=days)
    points = max(Decimal(0), _points(plan.get("grant_points")))
    is_credits = (plan.get("features") or {}).get("package_type") == "credits"
    cycle = conn.execute(
        """INSERT INTO subscription_cycles
           (subscription_id, plan_id, period_start, period_end, granted_points, remaining_points, entitlements_snapshot)
           VALUES (%s, %s, %s, %s, 0, 0, %s::jsonb) RETURNING *""",
        (subscription_id, plan["id"], start, end, json.dumps(_snapshot(plan), ensure_ascii=False)),
    ).fetchone()
    cycle_id = cycle["id"]
    bucket = conn.execute(
        """INSERT INTO point_buckets
           (user_id, bucket_type, cycle_id, granted_points, remaining_points, expires_at)
           VALUES (%s, 'subscription', %s, 0, 0, %s) RETURNING id""",
        (user_id, cycle_id, end),
    ).fetchone()
    conn.execute(
        "UPDATE user_subscriptions SET plan_id = %s, status = 'active', current_cycle_id = %s, started_at = %s, expires_at = %s, last_order_id = COALESCE(%s, last_order_id), updated_at = NOW() WHERE id = %s",
        (plan["id"], cycle_id, start, end, order_id, subscription_id),
    )
    if points:
        from backend.services.points_service import PointsService
        if is_credits:
            # 积分包：永久积分直接进永久桶（换套餐/周期过期都不清零），不走订阅桶
            PointsService.add_points(
                conn=conn, user_id=user_id, amount=float(points), tx_type="plan_credits_grant",
                description=f"{plan['name']} 永久积分", request_key=f"credits-plan-grant:{order_id or cycle_id}",
            )
        else:
            PointsService.grant_subscription_points_in_conn(
                conn, user_id, bucket["id"], cycle_id, points,
                f"{plan['name']} 周期积分", f"subscription-grant:{cycle_id}",
            )
        cycle = conn.execute("SELECT * FROM subscription_cycles WHERE id = %s", (cycle_id,)).fetchone()
    return dict(cycle)


def ensure_current_cycle_in_conn(conn, user_id: int, now: datetime | None = None):
    now = now or datetime.now()
    user = conn.execute("SELECT id, points FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
    if not user:
        raise ValueError("用户不存在")
    conn.execute(
        """INSERT INTO point_buckets (user_id, bucket_type, granted_points, remaining_points)
           VALUES (%s, 'permanent', %s, %s) ON CONFLICT (user_id) WHERE bucket_type = 'permanent' DO NOTHING""",
        (user_id, _points(user["points"]), _points(user["points"])),
    )
    sub_row = conn.execute("SELECT * FROM user_subscriptions WHERE user_id = %s FOR UPDATE", (user_id,)).fetchone()
    if not sub_row:
        free = _get_plan(conn, code="free", for_update=True)
        if not free:
            raise ValueError("免费套餐未初始化")
        sub = conn.execute(
            "INSERT INTO user_subscriptions (user_id, plan_id, status, started_at, expires_at) VALUES (%s, %s, 'active', %s, %s) RETURNING *",
            (user_id, free["id"], now, now),
        ).fetchone()
        cycle = _create_cycle_in_conn(conn, user_id, sub["id"], free, now)
        return {"subscription": dict(sub), "cycle": cycle, "plan": free}

    sub = dict(sub_row)
    cycle_row = conn.execute(
        "SELECT * FROM subscription_cycles WHERE id = %s FOR UPDATE", (sub.get("current_cycle_id"),)
    ).fetchone() if sub.get("current_cycle_id") else None
    if cycle_row and sub.get("status") != "active":
        plan = _cycle_plan(dict(cycle_row))
        return {"subscription": sub, "cycle": dict(cycle_row), "plan": plan}
    if cycle_row and cycle_row["status"] == "active" and cycle_row["period_end"] > now:
        plan = _cycle_plan(dict(cycle_row))
        return {"subscription": sub, "cycle": dict(cycle_row), "plan": plan or {}}

    if cycle_row and cycle_row["status"] == "active":
        _expire_cycle_in_conn(conn, dict(cycle_row), user_id, now)
    next_plan_id = sub.get("next_plan_id")
    next_plan = _get_plan(conn, plan_id=next_plan_id) if next_plan_id else None
    if not next_plan:
        next_plan = _get_plan(conn, code="free", for_update=True)
    conn.execute("UPDATE user_subscriptions SET next_plan_id = NULL WHERE id = %s", (sub["id"],))
    cycle = _create_cycle_in_conn(conn, user_id, sub["id"], next_plan, now)
    sub = dict(conn.execute("SELECT * FROM user_subscriptions WHERE id = %s", (sub["id"],)).fetchone())
    return {"subscription": sub, "cycle": cycle, "plan": next_plan}


def ensure_current_cycle(user_id: int):
    from backend.database import get_db
    with get_db() as conn:
        return ensure_current_cycle_in_conn(conn, user_id)


def get_current_state(user_id: int) -> dict:
    from backend.database import get_db
    with get_db() as conn:
        state = ensure_current_cycle_in_conn(conn, user_id)
        permanent = conn.execute(
            "SELECT COALESCE(remaining_points, 0) AS points FROM point_buckets WHERE user_id = %s AND bucket_type = 'permanent'",
            (user_id,),
        ).fetchone()
        next_plan = _get_plan(conn, plan_id=state["subscription"].get("next_plan_id")) if state["subscription"].get("next_plan_id") else None
        cycle = state["cycle"]
        plan = _cycle_plan(cycle)
        return {
            "subscription_id": state["subscription"]["id"],
            "status": state["subscription"].get("status", "active"),
            "plan": _snapshot(plan),
            "cycle": {
                "id": cycle["id"],
                "period_start": cycle["period_start"].isoformat(),
                "period_end": cycle["period_end"].isoformat(),
                "granted_points": float(_points(cycle["granted_points"])),
                "remaining_points": float(_points(cycle["remaining_points"])),
                "status": cycle["status"],
            },
            "permanent_points": float(_points(permanent["points"])) if permanent else 0,
            "total_points": float(_points(conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()["points"])),
            "next_plan": _snapshot(next_plan) if next_plan else None,
        }


def get_entitlements_in_conn(conn, user_id: int) -> dict:
    state = ensure_current_cycle_in_conn(conn, user_id)
    plan = _cycle_plan(state["cycle"])
    # 老周期快照兜底：套餐体系上线前的 free 周期快照缺 is_free/package_type，
    # 会被误判为非免费用户（无每日次数、直接扣积分）。按 cycle.plan_id 查当前套餐定义补齐。
    if not plan.get("is_free"):
        db_plan = _get_plan(conn, plan_id=state["cycle"].get("plan_id"))
        if db_plan:
            if db_plan.get("is_free"):
                plan["is_free"] = True
            db_feats = _json(db_plan.get("features"), {})
            plan_feats = plan.get("features") or {}
            if db_feats.get("package_type") and not plan_feats.get("package_type"):
                plan["features"] = {**plan_feats, "package_type": db_feats["package_type"], "daily_quota": db_feats.get("daily_quota")}
    features = {**FEATURE_DEFAULTS, **(plan.get("features") or {})}
    return {
        "active": state["subscription"].get("status") == "active" and state["cycle"].get("status") == "active",
        "plan": _snapshot(plan),
        "features": features,
        "allowed_models": list(plan.get("allowed_models") or []),
        "max_concurrent_requests": max(1, int(plan.get("max_concurrent_requests") or 1)),
        "cycle_id": state["cycle"].get("id"),
        "period_end": state["cycle"].get("period_end"),
    }


def get_entitlements(user_id: int) -> dict:
    from backend.database import get_db
    with get_db() as conn:
        return get_entitlements_in_conn(conn, user_id)


def list_enabled_plans() -> list[dict]:
    from backend.database import get_db
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM subscription_plans WHERE enabled = TRUE ORDER BY sort_order ASC, id ASC").fetchall()
    return [_snapshot(_plan_dict(row)) for row in rows]


def create_order(user_id: int, plan_id: int, channel: str, submit_ip: str, payer_name: str = "", tx_no: str = "", proof_url: str = "", remark: str = "") -> dict:
    from backend.database import get_db
    if channel not in {"wechat", "alipay"}:
        raise ValueError("支持方式仅支持 wechat/alipay")
    with get_db() as conn:
        plan = _get_plan(conn, plan_id=plan_id, for_update=True)
        if not plan or not plan.get("enabled") or plan.get("is_free"):
            raise ValueError("套餐不可购买")
        order_no = f"SUB{datetime.now().strftime('%Y%m%d%H%M%S')}{user_id}{secrets.token_hex(4).upper()}"
        row = conn.execute(
            """INSERT INTO subscription_orders
               (order_no, user_id, plan_id, plan_snapshot, amount_rmb, channel, payer_name, tx_no, proof_url, remark, submit_ip)
               VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (order_no, user_id, plan_id, json.dumps(_snapshot(plan), ensure_ascii=False), plan["price_rmb"], channel, payer_name[:128], tx_no[:128], proof_url[:1024], remark[:1000], submit_ip[:45]),
        ).fetchone()
    return dict(row)


def get_plan_in_conn(conn, plan_id: int) -> dict | None:
    plan = _get_plan(conn, plan_id=plan_id)
    return _snapshot(plan) if plan else None


def activate_plan_in_conn(conn, user_id: int, plan: dict, order_id=None) -> str:
    """激活/续期订阅：供订阅订单审核与充值审核（套餐）共用，返回激活方式"""
    state = ensure_current_cycle_in_conn(conn, user_id)
    current_plan = state["plan"]
    current_cycle = state["cycle"]
    now = datetime.now()
    current_credits = (current_plan.get("features") or {}).get("package_type") == "credits"
    new_credits = (plan.get("features") or {}).get("package_type") == "credits"
    # 积分包是永久积分购买，任何时候都立即生效；仅会员套餐在有效期内再次购买才排队到下一周期
    if (not current_plan.get("is_free") and not current_credits and not new_credits
            and state["subscription"].get("expires_at") and state["subscription"]["expires_at"] > now):
        conn.execute(
            "UPDATE user_subscriptions SET next_plan_id = %s, last_order_id = COALESCE(%s, last_order_id), updated_at = NOW() WHERE id = %s",
            (plan["id"], order_id, state["subscription"]["id"]),
        )
        return "next_cycle"
    if current_cycle.get("status") == "active":
        _expire_cycle_in_conn(conn, current_cycle, user_id, now)
    conn.execute("UPDATE user_subscriptions SET next_plan_id = NULL WHERE id = %s", (state["subscription"]["id"],))
    _create_cycle_in_conn(conn, user_id, state["subscription"]["id"], plan, now, order_id)
    return "current_cycle"


def approve_order(order_id: int, admin_id: int, review_note: str = "") -> dict:
    from backend.database import get_db
    with get_db() as conn:
        order = conn.execute("SELECT * FROM subscription_orders WHERE id = %s FOR UPDATE", (order_id,)).fetchone()
        if not order:
            raise ValueError("订阅订单不存在")
        order = dict(order)
        if order["status"] == "approved":
            return order
        if order["status"] != "pending":
            raise ValueError("仅待审核订单可通过")
        plan = _order_plan(order)
        activation = activate_plan_in_conn(conn, order["user_id"], plan, order_id)
        conn.execute(
            "UPDATE subscription_orders SET status = 'approved', reviewed_by = %s, reviewed_at = NOW(), review_note = %s WHERE id = %s",
            (admin_id, review_note[:1000], order_id),
        )
        conn.execute(
            "INSERT INTO billing_audit_logs (admin_id, action, target_type, target_id, reason, old_state, new_state) VALUES (%s, 'subscription_order_approve', 'subscription_order', %s, %s, %s::jsonb, %s::jsonb)",
            (admin_id, str(order_id), review_note[:1000], json.dumps({"status": "pending"}), json.dumps({"status": "approved", "activation": activation})),
        )
        result = dict(conn.execute("SELECT * FROM subscription_orders WHERE id = %s", (order_id,)).fetchone())
        result["activation"] = activation
        return result


def reject_order(order_id: int, admin_id: int, review_note: str) -> dict:
    from backend.database import get_db
    if not review_note.strip():
        raise ValueError("拒绝原因不能为空")
    with get_db() as conn:
        row = conn.execute("SELECT status FROM subscription_orders WHERE id = %s FOR UPDATE", (order_id,)).fetchone()
        if not row:
            raise ValueError("订阅订单不存在")
        if row["status"] != "pending":
            raise ValueError("仅待审核订单可拒绝")
        conn.execute("UPDATE subscription_orders SET status = 'rejected', reviewed_by = %s, reviewed_at = NOW(), review_note = %s WHERE id = %s", (admin_id, review_note[:1000], order_id))
        conn.execute(
            "INSERT INTO billing_audit_logs (admin_id, action, target_type, target_id, reason, old_state, new_state) VALUES (%s, 'subscription_order_reject', 'subscription_order', %s, %s, %s::jsonb, %s::jsonb)",
            (admin_id, str(order_id), review_note[:1000], json.dumps({"status": "pending"}), json.dumps({"status": "rejected"})),
        )
        return dict(conn.execute("SELECT * FROM subscription_orders WHERE id = %s", (order_id,)).fetchone())


def refund_order(order_id: int, admin_id: int, review_note: str) -> dict:
    from backend.database import get_db
    if not review_note.strip():
        raise ValueError("退款原因不能为空")
    with get_db() as conn:
        order = conn.execute("SELECT * FROM subscription_orders WHERE id = %s FOR UPDATE", (order_id,)).fetchone()
        if not order:
            raise ValueError("订阅订单不存在")
        if order["status"] == "refunded":
            return dict(order)
        if order["status"] not in {"approved", "pending"}:
            raise ValueError("当前订单不能退款")
        old_status = order["status"]
        conn.execute(
            "UPDATE subscription_orders SET status = 'refunded', reviewed_by = %s, reviewed_at = NOW(), review_note = %s WHERE id = %s",
            (admin_id, review_note[:1000], order_id),
        )
        conn.execute(
            "INSERT INTO billing_audit_logs (admin_id, action, target_type, target_id, reason, old_state, new_state) VALUES (%s, 'subscription_order_refund', 'subscription_order', %s, %s, %s::jsonb, %s::jsonb)",
            (admin_id, str(order_id), review_note[:1000], json.dumps({"status": old_status}), json.dumps({"status": "refunded"})),
        )
        return dict(conn.execute("SELECT * FROM subscription_orders WHERE id = %s", (order_id,)).fetchone())


def list_subscriptions(page: int = 1, size: int = 20, query: str = "") -> dict:
    from backend.database import get_db
    offset = (page - 1) * size
    where, params = [], []
    if query:
        where.append("(u.username ILIKE %s OR u.nickname ILIKE %s)")
        value = f"%{query}%"
        params.extend([value, value])
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    with get_db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM user_subscriptions s JOIN users u ON u.id = s.user_id {where_sql}", params
        ).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT s.*, u.username, u.nickname, p.name AS plan_name, p.features->>'package_type' AS plan_package_type,
                       c.period_start, c.period_end, c.granted_points, c.remaining_points
                FROM user_subscriptions s JOIN users u ON u.id = s.user_id
                JOIN subscription_plans p ON p.id = s.plan_id
                LEFT JOIN subscription_cycles c ON c.id = s.current_cycle_id
                {where_sql} ORDER BY s.updated_at DESC LIMIT %s OFFSET %s""",
            params + [size, offset],
        ).fetchall()
    return {"items": [dict(row) for row in rows], "total": total, "page": page, "size": size}


def grant_subscription(user_id: int, admin_id: int, points: float, reason: str) -> dict:
    from backend.database import get_db
    from backend.services.points_service import PointsService
    points = _points(points)
    if points <= 0:
        raise ValueError("补发积分必须大于0")
    if not reason.strip():
        raise ValueError("补发原因不能为空")
    with get_db() as conn:
        state = ensure_current_cycle_in_conn(conn, user_id)
        bucket = conn.execute("SELECT id FROM point_buckets WHERE cycle_id = %s FOR UPDATE", (state["cycle"]["id"],)).fetchone()
        PointsService.grant_subscription_points_in_conn(
            conn, user_id, bucket["id"], state["cycle"]["id"], points,
            "管理员补发订阅积分", f"subscription-admin-grant:{state['cycle']['id']}:{admin_id}:{points}",
        )
        conn.execute(
            "INSERT INTO billing_audit_logs (admin_id, action, target_type, target_id, reason, new_state) VALUES (%s, 'subscription_grant', 'subscription', %s, %s, %s::jsonb)",
            (admin_id, str(state["subscription"]["id"]), reason[:1000], json.dumps({"points": float(points)})),
        )
    return get_current_state(user_id)


def extend_subscription(user_id: int, admin_id: int, days: int, reason: str) -> dict:
    from backend.database import get_db
    days = max(1, int(days or 0))
    if not reason.strip():
        raise ValueError("续期原因不能为空")
    with get_db() as conn:
        state = ensure_current_cycle_in_conn(conn, user_id)
        cycle = state["cycle"]
        conn.execute("UPDATE subscription_cycles SET period_end = period_end + (%s || ' days')::interval WHERE id = %s", (days, cycle["id"]))
        conn.execute("UPDATE point_buckets SET expires_at = expires_at + (%s || ' days')::interval WHERE cycle_id = %s", (days, cycle["id"]))
        conn.execute("UPDATE user_subscriptions SET expires_at = expires_at + (%s || ' days')::interval, updated_at = NOW() WHERE id = %s", (days, state["subscription"]["id"]))
        conn.execute(
            "INSERT INTO billing_audit_logs (admin_id, action, target_type, target_id, reason, new_state) VALUES (%s, 'subscription_extend', 'subscription', %s, %s, %s::jsonb)",
            (admin_id, str(state["subscription"]["id"]), reason[:1000], json.dumps({"days": days})),
        )
    return get_current_state(user_id)


def set_subscription_status(user_id: int, admin_id: int, status: str, reason: str) -> dict:
    from backend.database import get_db
    if status not in {"suspended", "revoked"} or not reason.strip():
        raise ValueError("操作状态或原因无效")
    with get_db() as conn:
        state = ensure_current_cycle_in_conn(conn, user_id)
        old_status = state["subscription"].get("status")
        conn.execute("UPDATE user_subscriptions SET status = %s, updated_at = NOW() WHERE id = %s", (status, state["subscription"]["id"]))
        conn.execute(
            "INSERT INTO billing_audit_logs (admin_id, action, target_type, target_id, reason, old_state, new_state) VALUES (%s, %s, 'subscription', %s, %s, %s::jsonb, %s::jsonb)",
            (admin_id, f"subscription_{status}", str(state["subscription"]["id"]), reason[:1000], json.dumps({"status": old_status}), json.dumps({"status": status})),
        )
    return get_current_state(user_id)


def update_order_proof(user_id: int, order_id: int, proof_url: str, payer_name: str = "", tx_no: str = "", remark: str = "") -> dict:
    from backend.database import get_db
    with get_db() as conn:
        row = conn.execute("SELECT * FROM subscription_orders WHERE id = %s AND user_id = %s", (order_id, user_id)).fetchone()
        if not row:
            raise ValueError("订阅订单不存在")
        if row["status"] != "pending":
            raise ValueError("订单已处理，不能修改凭证")
        conn.execute("UPDATE subscription_orders SET proof_url = %s, payer_name = %s, tx_no = %s, remark = %s WHERE id = %s", (proof_url[:1024], payer_name[:128], tx_no[:128], remark[:1000], order_id))
        return dict(conn.execute("SELECT * FROM subscription_orders WHERE id = %s", (order_id,)).fetchone())


def get_usage(user_id: int, days: int = 30) -> dict:
    from backend.database import get_db
    days = max(1, min(int(days), 365))
    with get_db() as conn:
        state = ensure_current_cycle_in_conn(conn, user_id)
        params = (user_id, days)
        summary = conn.execute(
            """SELECT COALESCE(SUM(input_tokens),0) input_tokens, COALESCE(SUM(output_tokens),0) output_tokens,
                      COALESCE(SUM(cache_read_tokens),0) cache_read_tokens, COALESCE(SUM(cache_creation_tokens),0) cache_creation_tokens,
                      COALESCE(SUM(calculated_cost_points),0) calculated_cost_points, COALESCE(SUM(charged_points),0) charged_points,
                      COALESCE(SUM(subscription_points_used),0) subscription_points_used, COALESCE(SUM(wallet_points_used),0) wallet_points_used,
                      COUNT(*) requests, COUNT(*) FILTER (WHERE usage_missing = TRUE) usage_missing_requests
               FROM chat_usage_records WHERE user_id = %s AND created_at >= NOW() - (%s || ' days')::interval""",
            params,
        ).fetchone()
        models = conn.execute(
            """SELECT model_key, COUNT(*) requests, COALESCE(SUM(calculated_cost_points),0) calculated_cost_points,
                      COALESCE(SUM(charged_points),0) charged_points
               FROM chat_usage_records WHERE user_id = %s AND created_at >= NOW() - (%s || ' days')::interval
               GROUP BY model_key ORDER BY requests DESC""",
            params,
        ).fetchall()
        sessions = conn.execute(
            """SELECT session_id, COUNT(*) requests, COALESCE(SUM(charged_points),0) charged_points
               FROM chat_usage_records WHERE user_id = %s AND created_at >= NOW() - (%s || ' days')::interval
               GROUP BY session_id ORDER BY requests DESC LIMIT 50""",
            params,
        ).fetchall()
    return {"cycle": state["cycle"], "summary": dict(summary), "by_model": [dict(r) for r in models], "by_session": [dict(r) for r in sessions]}
