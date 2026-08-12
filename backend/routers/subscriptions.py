import json
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from backend.auth import get_current_user, get_client_ip, require_admin
from backend.database import get_db
from backend.services.subscription_service import (
    create_order, get_current_state, get_usage, list_enabled_plans, approve_order, reject_order,
    update_order_proof, refund_order, list_subscriptions, grant_subscription, extend_subscription,
    set_subscription_status,
)
from backend.services.notification_service import NotificationService
from backend.services.billing_service import BillingService

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin-subscriptions"])


class SubscriptionOrderRequest(BaseModel):
    plan_id: int
    channel: str
    payer_name: str = Field("", max_length=128)
    tx_no: str = Field("", max_length=128)
    proof_url: str = Field("", max_length=1024)
    remark: str = Field("", max_length=1000)


class ProofRequest(BaseModel):
    proof_url: str = Field(..., min_length=1, max_length=1024)
    payer_name: str = Field("", max_length=128)
    tx_no: str = Field("", max_length=128)
    remark: str = Field("", max_length=1000)


def _clean_row(row):
    if not row:
        return None
    item = dict(row)
    for key in ("plan_snapshot", "risk_flags"):
        if isinstance(item.get(key), str):
            try:
                item[key] = json.loads(item[key])
            except Exception:
                item[key] = {} if key == "plan_snapshot" else []
    return item


@router.get("/plans")
async def subscription_plans(user=Depends(get_current_user)):
    return {"items": list_enabled_plans()}


@router.get("/me")
async def my_subscription(user=Depends(get_current_user)):
    return get_current_state(user["user_id"])


@router.get("/usage")
async def my_subscription_usage(days: int = Query(30, ge=1, le=365), user=Depends(get_current_user)):
    return get_usage(user["user_id"], days)


@router.get("/model-prices")
async def subscription_model_prices(user=Depends(get_current_user)):
    from backend.services.llm_model_service import get_all
    items = []
    for model in get_all():
        snapshot = BillingService.get_model_price_snapshot(model)
        items.append({
            "model_id": model["model_id"],
            "label": model.get("label") or model["model_id"],
            "rmb_per_million": snapshot.get("rmb_per_million") or {},
            "points_per_1k": snapshot.get("points_per_1k") or {},
        })
    return {"items": items}


@router.get("/orders")
async def my_subscription_orders(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), user=Depends(get_current_user)):
    offset = (page - 1) * size
    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) AS cnt FROM subscription_orders WHERE user_id = %s", (user["user_id"],)).fetchone()["cnt"]
        rows = conn.execute(
            "SELECT * FROM subscription_orders WHERE user_id = %s ORDER BY created_at DESC LIMIT %s OFFSET %s",
            (user["user_id"], size, offset),
        ).fetchall()
    return {"items": [_clean_row(row) for row in rows], "total": total, "page": page, "size": size}


@router.post("/orders")
async def create_subscription_order(body: SubscriptionOrderRequest, request: Request, user=Depends(get_current_user)):
    try:
        row = create_order(user["user_id"], body.plan_id, body.channel, get_client_ip(request), body.payer_name, body.tx_no, body.proof_url, body.remark)
        return _clean_row(row)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/orders/{order_id}")
async def get_subscription_order(order_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM subscription_orders WHERE id = %s AND user_id = %s", (order_id, user["user_id"])).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="订阅订单不存在")
    return _clean_row(row)


@router.post("/orders/{order_id}/proof")
async def upload_subscription_proof(order_id: int, body: ProofRequest, user=Depends(get_current_user)):
    try:
        return _clean_row(update_order_proof(user["user_id"], order_id, body.proof_url, body.payer_name, body.tx_no, body.remark))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/orders/{order_id}/confirm")
async def confirm_subscription_order(order_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute("SELECT status FROM subscription_orders WHERE id = %s AND user_id = %s", (order_id, user["user_id"])).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="订阅订单不存在")
    return {"status": row["status"], "message": "订单状态已刷新"}


@admin_router.get("/subscription-plans")
async def admin_list_plans(admin=Depends(require_admin)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM subscription_plans ORDER BY sort_order ASC, id ASC").fetchall()
    return {"items": [_clean_row(row) for row in rows]}


@admin_router.post("/subscription-plans")
async def admin_create_plan(body: dict, admin=Depends(require_admin)):
    required = ["code", "name"]
    if any(not str(body.get(key) or "").strip() for key in required):
        raise HTTPException(status_code=400, detail="套餐 code 和名称不能为空")
    with get_db() as conn:
        try:
            row = conn.execute(
                """INSERT INTO subscription_plans
                   (code, name, description, price_rmb, cycle_days, grant_points, features, allowed_models, max_concurrent_requests, enabled, is_free, sort_order)
                   VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s) RETURNING *""",
                (str(body["code"]).strip(), str(body["name"]).strip(), str(body.get("description") or ""), float(body.get("price_rmb") or 0), int(body.get("cycle_days") or 30), int(body.get("grant_points") or 0), json.dumps(body.get("features") or {}), json.dumps(body.get("allowed_models") or []), int(body.get("max_concurrent_requests") or 1), bool(body.get("enabled", True)), bool(body.get("is_free", False)), int(body.get("sort_order") or 0)),
            ).fetchone()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"套餐保存失败: {exc}")
        conn.execute("INSERT INTO billing_audit_logs (admin_id, action, target_type, target_id, reason, new_state) VALUES (%s, 'plan_create', 'subscription_plan', %s, %s, %s::jsonb)", (admin["user_id"], str(row["id"]), str(body.get("reason") or "创建套餐"), json.dumps(dict(row))))
    return _clean_row(row)


@admin_router.patch("/subscription-plans/{plan_id}")
async def admin_update_plan(plan_id: int, body: dict, admin=Depends(require_admin)):
    allowed = {"name", "description", "price_rmb", "cycle_days", "grant_points", "features", "allowed_models", "max_concurrent_requests", "enabled", "is_free", "sort_order"}
    fields = [(key, value) for key, value in body.items() if key in allowed]
    if not fields:
        raise HTTPException(status_code=400, detail="没有可更新字段")
    set_parts = []
    params = []
    for key, value in fields:
        if key in {"features", "allowed_models"}:
            set_parts.append(f"{key} = %s::jsonb")
            params.append(json.dumps(value))
        else:
            set_parts.append(f"{key} = %s")
            params.append(value)
    params.append(plan_id)
    with get_db() as conn:
        old = conn.execute("SELECT * FROM subscription_plans WHERE id = %s FOR UPDATE", (plan_id,)).fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="套餐不存在")
        row = conn.execute(f"UPDATE subscription_plans SET {', '.join(set_parts)}, updated_at = NOW() WHERE id = %s RETURNING *", params).fetchone()
        conn.execute("INSERT INTO billing_audit_logs (admin_id, action, target_type, target_id, reason, old_state, new_state) VALUES (%s, 'plan_update', 'subscription_plan', %s, %s, %s::jsonb, %s::jsonb)", (admin["user_id"], str(plan_id), str(body.get("reason") or "更新套餐"), json.dumps(dict(old)), json.dumps(dict(row))))
    return _clean_row(row)


@admin_router.post("/subscription-plans/{plan_id}/disable")
async def admin_disable_plan(plan_id: int, body: dict | None = None, admin=Depends(require_admin)):
    return await admin_update_plan(plan_id, {"enabled": False, "reason": (body or {}).get("reason") or "下架套餐"}, admin)


@admin_router.get("/subscription-orders")
async def admin_list_subscription_orders(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), status: str = Query("all"), query: str = Query(""), admin=Depends(require_admin)):
    offset = (page - 1) * size
    where, params = [], []
    if status in {"pending", "approved", "rejected", "refunded", "cancelled"}:
        where.append("o.status = %s"); params.append(status)
    if query:
        where.append("(u.username ILIKE %s OR u.nickname ILIKE %s OR o.order_no ILIKE %s OR o.tx_no ILIKE %s)")
        q = f"%{query}%"; params.extend([q, q, q, q])
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    with get_db() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS cnt FROM subscription_orders o JOIN users u ON u.id = o.user_id {where_sql}", params).fetchone()["cnt"]
        rows = conn.execute(f"SELECT o.*, u.username, u.nickname, p.name AS plan_name, au.username AS reviewer_name FROM subscription_orders o JOIN users u ON u.id = o.user_id JOIN subscription_plans p ON p.id = o.plan_id LEFT JOIN users au ON au.id = o.reviewed_by {where_sql} ORDER BY o.created_at DESC LIMIT %s OFFSET %s", params + [size, offset]).fetchall()
    return {"items": [_clean_row(row) for row in rows], "total": total, "page": page, "size": size}


@admin_router.post("/subscription-orders/{order_id}/approve")
async def admin_approve_subscription_order(order_id: int, body: dict | None = None, admin=Depends(require_admin)):
    try:
        row = approve_order(order_id, admin["user_id"], (body or {}).get("review_note") or "审核通过")
        NotificationService.create(row["user_id"], "subscription", "订阅已生效", "你的订阅订单已审核通过。")
        return _clean_row(row)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@admin_router.post("/subscription-orders/{order_id}/reject")
async def admin_reject_subscription_order(order_id: int, body: dict, admin=Depends(require_admin)):
    try:
        row = reject_order(order_id, admin["user_id"], body.get("review_note") or "")
        NotificationService.create(row["user_id"], "subscription", "订阅订单未通过", row.get("review_note") or "请查看订单详情。")
        return _clean_row(row)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@admin_router.post("/subscription-orders/{order_id}/refund")
async def admin_refund_subscription_order(order_id: int, body: dict, admin=Depends(require_admin)):
    try:
        row = refund_order(order_id, admin["user_id"], body.get("review_note") or "")
        NotificationService.create(row["user_id"], "subscription", "订阅订单已退款", row.get("review_note") or "请查看订单详情。")
        return _clean_row(row)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@admin_router.get("/subscriptions")
async def admin_subscriptions(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(""), admin=Depends(require_admin)):
    return list_subscriptions(page, size, query)


@admin_router.post("/subscriptions/{user_id}/grant")
async def admin_grant_subscription(user_id: int, body: dict, admin=Depends(require_admin)):
    try:
        return grant_subscription(user_id, admin["user_id"], int(body.get("points") or 0), str(body.get("reason") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@admin_router.post("/subscriptions/{user_id}/extend")
async def admin_extend_subscription(user_id: int, body: dict, admin=Depends(require_admin)):
    try:
        return extend_subscription(user_id, admin["user_id"], int(body.get("days") or 0), str(body.get("reason") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@admin_router.post("/subscriptions/{user_id}/suspend")
async def admin_suspend_subscription(user_id: int, body: dict, admin=Depends(require_admin)):
    try:
        return set_subscription_status(user_id, admin["user_id"], "suspended", str(body.get("reason") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@admin_router.post("/subscriptions/{user_id}/revoke")
async def admin_revoke_subscription(user_id: int, body: dict, admin=Depends(require_admin)):
    try:
        return set_subscription_status(user_id, admin["user_id"], "revoked", str(body.get("reason") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@admin_router.get("/subscription-usage")
async def admin_subscription_usage(days: int = Query(30, ge=1, le=365), admin=Depends(require_admin)):
    with get_db() as conn:
        summary = conn.execute("SELECT COUNT(*) requests, COALESCE(SUM(calculated_cost_points),0) calculated_cost_points, COALESCE(SUM(charged_points),0) charged_points, COUNT(*) FILTER (WHERE usage_missing = TRUE) usage_missing_requests FROM chat_usage_records WHERE created_at >= NOW() - (%s || ' days')::interval", (days,)).fetchone()
        by_model = conn.execute("SELECT model_key, COUNT(*) requests, COALESCE(SUM(calculated_cost_points),0) calculated_cost_points, COALESCE(SUM(charged_points),0) charged_points FROM chat_usage_records WHERE created_at >= NOW() - (%s || ' days')::interval GROUP BY model_key ORDER BY requests DESC", (days,)).fetchall()
    return {"days": days, "summary": dict(summary), "by_model": [dict(row) for row in by_model]}


@admin_router.get("/billing-config")
async def admin_billing_config(admin=Depends(require_admin)):
    from backend.config import get_billing_config
    return get_billing_config()


@admin_router.patch("/billing-config")
async def admin_update_billing_config(body: dict, admin=Depends(require_admin)):
    from backend.config import update_config, get_billing_config
    values = {key: body[key] for key in ("points_per_rmb", "usd_cny_fx_rate", "platform_markup", "min_charge_points") if key in body}
    update_config(values)
    return get_billing_config()


@admin_router.get("/model-prices")
async def admin_model_prices(admin=Depends(require_admin)):
    from backend.services.llm_model_service import get_all
    with get_db() as conn:
        versions = conn.execute("SELECT model_id, id, effective_at, snapshot FROM model_price_versions ORDER BY effective_at DESC, id DESC").fetchall()
    history = {}
    for row in versions:
        history.setdefault(row["model_id"], []).append({"id": row["id"], "effective_at": row["effective_at"].isoformat() if row["effective_at"] else None, "snapshot": row["snapshot"]})
    return {"items": [{**BillingService.get_model_price_snapshot(row), "model_id": row["model_id"], "versions": history.get(row["model_id"], [])} for row in get_all()]}


@admin_router.post("/model-prices/{model_id}/versions")
async def admin_create_model_price_version(model_id: str, body: dict, admin=Depends(require_admin)):
    from backend.services.llm_model_service import get_by_model_id, upsert
    model = get_by_model_id(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")
    allowed = {"input_price_per_million", "output_price_per_million", "cache_read_price_per_million", "cache_creation_price_per_million", "price_currency"}
    updated = upsert({"model_id": model_id, **{key: body[key] for key in allowed if key in body}})
    snapshot = BillingService.create_price_version(updated, admin["user_id"])
    with get_db() as conn:
        conn.execute("INSERT INTO billing_audit_logs (admin_id, action, target_type, target_id, reason, new_state) VALUES (%s, 'model_price_version_create', 'model_price', %s, %s, %s::jsonb)", (admin["user_id"], model_id, str(body.get("reason") or "更新模型价格"), json.dumps(snapshot, ensure_ascii=False)))
    return snapshot
