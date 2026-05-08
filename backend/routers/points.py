from fastapi import APIRouter, HTTPException, Depends, Request, Query
from pydantic import BaseModel
import hashlib
import json
import logging
import secrets
from backend.auth import get_current_user, get_client_ip
from backend.config import get_config
from backend.services.points_service import PointsService
from backend.services.invite_service import InviteService
from backend.services.notification_service import NotificationService
from backend.database import get_db
from backend.config import get_recharge_packages

router = APIRouter(prefix="/api/points", tags=["points"])
logger = logging.getLogger(__name__)


class RedeemRequest(BaseModel):
    code: str


class RechargeCreateRequest(BaseModel):
    channel: str
    amount: float
    points: int
    invite_code: str = ""


def _build_recharge_risk(conn, user_id: int, ip: str, tx_no: str, amount: float):
    flags = []
    recent_user = conn.execute("SELECT COUNT(*) AS cnt FROM recharge_requests WHERE user_id = %s AND created_at >= NOW() - interval '10 minutes'", (user_id,)).fetchone()["cnt"]
    if int(recent_user or 0) >= 3:
        flags.append("user_high_frequency")
    dup_tx = conn.execute("SELECT id FROM recharge_requests WHERE tx_no = %s LIMIT 1", (tx_no,)).fetchone()
    if dup_tx:
        flags.append("duplicate_tx_no")
    if amount >= 500:
        flags.append("high_amount")
    level = "high" if len(flags) >= 2 else ("medium" if len(flags) == 1 else "low")
    return level, flags


def _expire_stale_requests(conn, user_id: int):
    conn.execute(
        "UPDATE recharge_requests SET status = 'expired' WHERE user_id = %s AND status = 'pending' AND created_at < NOW() - interval '10 minutes'",
        (user_id,),
    )

def _generate_unique_discount(conn, user_id: int) -> float:
    import random
    for _ in range(50):
        discount = round(random.uniform(0.01, 0.50), 2)
        dup = conn.execute(
            "SELECT id FROM recharge_requests WHERE discount = %s AND status = 'pending' AND created_at >= NOW() - interval '10 minutes' LIMIT 1",
            (discount,),
        ).fetchone()
        if not dup:
            return discount
    return round(random.uniform(0.01, 0.50), 2)


@router.get("/balance")
async def get_balance(user=Depends(get_current_user)):
    balance = PointsService.get_balance(user["user_id"])
    return {"points": balance}


@router.get("/checkin/status")
async def checkin_status(user=Depends(get_current_user)):
    return {"checked_in_today": PointsService.has_checked_in_today(user["user_id"])}


@router.post("/checkin")
async def check_in(user=Depends(get_current_user)):
    try:
        result = PointsService.check_in(user["user_id"])
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/redeem")
async def redeem(req: RedeemRequest, request: Request, user=Depends(get_current_user)):
    try:
        ip = get_client_ip(request)
        result = PointsService.redeem_code(req.code, user["user_id"], ip)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/transactions")
async def get_transactions(page: int = 1, size: int = 20, user=Depends(get_current_user)):
    offset = (page - 1) * size
    with get_db() as conn:
        total = conn.execute(
            "SELECT COUNT(*) as cnt FROM point_transactions WHERE user_id = %s",
            (user["user_id"],)
        ).fetchone()["cnt"]
        rows = conn.execute(
            """SELECT t.*, CASE WHEN t.type IN ('generate_consume','generate_refund') THEN COALESCE(NULLIF(tk.params->>'model_id',''),'GPT-Image-2') ELSE NULL END as model_name, rr.channel, rr.amount as recharge_amount, rr.points as recharge_points,
                      rr.payer_name, rr.tx_no, rr.proof_url, rr.remark, rr.status as recharge_status,
                      rr.redeem_code, rr.review_note, rr.created_at as recharge_created_at,
                      rr.reviewed_at, rr.reviewed_by
               FROM point_transactions t
               LEFT JOIN tasks tk ON tk.task_id = split_part(COALESCE(t.request_key,''), ':', 2)
               LEFT JOIN recharge_requests rr ON t.recharge_request_id = rr.id
               WHERE t.user_id = %s ORDER BY t.created_at DESC LIMIT %s OFFSET %s""",
            (user["user_id"], size, offset)
        ).fetchall()
        return {"total": total, "items": [dict(r) for r in rows], "page": page, "size": size}


@router.post("/recharge/requests")
async def create_recharge_request(body: RechargeCreateRequest, request: Request, user=Depends(get_current_user)):
    channel = (body.channel or "").strip().lower()
    if channel not in {"wechat", "alipay"}:
        raise HTTPException(status_code=400, detail="支持方式仅支持 wechat/alipay")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="捐赠金额必须大于0")
    if body.points <= 0:
        raise HTTPException(status_code=400, detail="赠送积分必须大于0")
    if not any(abs(float(pkg["amount"]) - float(body.amount)) < 1e-6 and int(pkg["points"]) == int(body.points) for pkg in get_recharge_packages()):
        raise HTTPException(status_code=400, detail="捐赠档位已变更，请刷新页面后重试")
    from datetime import datetime, timedelta
    ip = get_client_ip(request)
    with get_db() as conn:
        _expire_stale_requests(conn, user["user_id"])
        existing = conn.execute(
            "SELECT id, amount, discount, created_at FROM recharge_requests WHERE user_id = %s AND channel = %s AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
            (user["user_id"], channel),
        ).fetchone()
        if existing:
            created = existing["created_at"]
            if isinstance(created, str):
                created = datetime.strptime(created, "%Y-%m-%d %H:%M:%S")
            expires_at = created + timedelta(minutes=10)
            remaining = max(0, int((expires_at - datetime.now()).total_seconds()))
            return {
                "id": existing["id"],
                "amount": float(existing["amount"]),
                "discount": float(existing["discount"]),
                "remaining_seconds": remaining,
                "message": "已有待捐赠请求",
            }
        discount = _generate_unique_discount(conn, user["user_id"])
        actual_amount = round(body.amount - discount, 2)
        tx_no = f"RCH{datetime.now().strftime('%Y%m%d%H%M%S')}{user['user_id']}{secrets.token_hex(4).upper()}"
        invite_snapshot=InviteService.build_recharge_snapshot(conn,user["user_id"],body.amount,body.points,body.invite_code,ip) if InviteService.is_enabled() else {"inviter_user_id":None,"invite_code":"","invite_discount_percent_snapshot":0,"invite_rebate_percent_snapshot":0,"invite_bonus_points":0,"invite_rebate_points":0,"same_ip_hit":False,"same_ip_reason":""}
        risk_level, risk_flags = _build_recharge_risk(conn, user["user_id"], ip, tx_no, body.amount)
        if invite_snapshot.get("same_ip_hit"):
            risk_flags=list(risk_flags)+[invite_snapshot.get("same_ip_reason") or "same_ip_within_30d"]
            risk_level="high" if risk_level!="high" else risk_level
        cursor = conn.execute(
            "INSERT INTO recharge_requests (user_id, channel, amount, points, submit_ip, invite_code, inviter_user_id, invite_discount_percent_snapshot, invite_rebate_percent_snapshot, invite_bonus_points, invite_rebate_points, tx_no, status, risk_level, risk_flags, discount) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s, %s, %s) RETURNING id",
            (user["user_id"], channel, actual_amount, body.points, ip, invite_snapshot["invite_code"], invite_snapshot["inviter_user_id"], invite_snapshot["invite_discount_percent_snapshot"], invite_snapshot["invite_rebate_percent_snapshot"], invite_snapshot["invite_bonus_points"], invite_snapshot["invite_rebate_points"], tx_no, risk_level, json.dumps(risk_flags, ensure_ascii=False), discount),
        )
        request_id = cursor.fetchone()["id"]
        balance = conn.execute("SELECT points FROM users WHERE id = %s", (user["user_id"],)).fetchone()["points"]
        conn.execute(
            "INSERT INTO point_transactions (user_id, amount, balance_after, type, description, recharge_request_id) VALUES (%s, %s, %s, %s, %s, %s)",
            (user["user_id"], 0, balance, "recharge_pending", f"待捐赠 (¥{actual_amount})", request_id),
        )
    logger.info(f"[audit.recharge.request] id={request_id} user={user['user_id']} base={body.amount} discount={discount} actual={actual_amount} points={body.points} risk={risk_level} flags={','.join(risk_flags) if risk_flags else 'none'} ip={ip}")
    return {"id": request_id, "tx_no": tx_no, "amount": actual_amount, "discount": discount, "remaining_seconds": 600, "message": "已创建，请扫码捐赠"}

@router.get("/invite")
async def get_invite_info(user=Depends(get_current_user)):
    return InviteService.get_user_invite_overview(user["user_id"])

@router.post("/invite/generate")
async def generate_invite_code(user=Depends(get_current_user)):
    code=InviteService.ensure_user_invite_code(user["user_id"])
    return {"invite_code":code}

@router.get("/invite/history")
async def get_invite_history(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), user=Depends(get_current_user)):
    return InviteService.list_user_invite_history(user["user_id"],page,size)


@router.get("/recharge/requests")
async def list_recharge_requests(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), user=Depends(get_current_user)):
    offset = (page - 1) * size
    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) as cnt FROM recharge_requests WHERE user_id = %s", (user["user_id"],)).fetchone()["cnt"]
        rows = conn.execute(
            "SELECT id, channel, amount, points, payer_name, tx_no, proof_url, remark, status, redeem_code, review_note, created_at, reviewed_at FROM recharge_requests WHERE user_id = %s ORDER BY created_at DESC LIMIT %s OFFSET %s",
            (user["user_id"], size, offset),
        ).fetchall()
        return {"total": total, "items": [dict(r) for r in rows], "page": page, "size": size}


@router.get("/recharge/requests/{request_id}")
async def get_recharge_request(request_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, channel, amount, points, status, user_confirmed, created_at FROM recharge_requests WHERE id = %s AND user_id = %s",
            (request_id, user["user_id"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="请求不存在")
        return dict(row)


@router.post("/recharge/requests/{request_id}/confirm")
async def confirm_recharge_request(request_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, status FROM recharge_requests WHERE id = %s AND user_id = %s",
            (request_id, user["user_id"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="请求不存在")
        if row["status"] != "pending":
            raise HTTPException(status_code=400, detail="该请求已处理")
        from datetime import datetime
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "UPDATE recharge_requests SET user_confirmed = TRUE, confirmed_at = %s WHERE id = %s",
            (now, request_id),
        )
        return {"message": "已确认，请等待到账"}


def _md5(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest()


@router.get("/appPush")
async def app_push_callback(t: str, type: str, price: str, sign: str):
    secret = get_config().get("vmq_notify_secret") or ""
    if not secret:
        logger.warning("[appPush] vmq_notify_secret 未配置")
        return "fail"
    expected = _md5(type + price + t + secret)
    if sign != expected:
        logger.warning(f"[appPush] 签名验证失败 t={t}")
        return "fail"
    channel = "wechat" if type == "1" else "alipay"
    paid_amount = float(price)
    import math
    base_amount = math.ceil(paid_amount)
    discount = round(base_amount - paid_amount, 2)
    if discount < 0.01 or discount > 0.50:
        logger.warning(f"[appPush] discount 超出范围 paid={paid_amount} discount={discount}")
        return "success"
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM recharge_requests WHERE channel = %s AND discount = %s AND status = 'pending' AND created_at >= NOW() - interval '10 minutes' ORDER BY created_at ASC LIMIT 1",
            (channel, discount),
        ).fetchone()
        if not row:
            logger.warning(f"[appPush] 未匹配到 channel={channel} discount={discount} price={paid_amount}")
            return "success"
        item = dict(row)
        request_id = item["id"]
        user_id = item["user_id"]
        points = int(item["points"])
        existing = conn.execute(
            "SELECT id FROM point_transactions WHERE request_key = %s",
            (f"vmq-appPush:{request_id}",),
        ).fetchone()
        if existing:
            return "success"
        from datetime import datetime
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        while True:
            code = secrets.token_urlsafe(8).upper()
            if not conn.execute("SELECT id FROM redemption_codes WHERE code = %s", (code,)).fetchone():
                break
        conn.execute(
            "INSERT INTO redemption_codes (code, points, recharge_request_id) VALUES (%s, %s, %s)",
            (code, points, request_id),
        )
        code_id = conn.execute("SELECT id FROM redemption_codes WHERE code = %s", (code,)).fetchone()["id"]
        conn.execute(
            "UPDATE redemption_codes SET is_used = true, used_by = %s, used_at = %s WHERE id = %s",
            (user_id, now, code_id),
        )
        PointsService.add_points(
            user_id, points, "redeem_code", f"VMQ自动到账 (¥{paid_amount})",
            conn=conn, request_key=f"vmq-appPush:{request_id}", recharge_request_id=request_id,
        )
        conn.execute(
            "UPDATE recharge_requests SET status = 'approved', review_note = %s, reviewed_at = %s WHERE id = %s",
            (f"VMQ自动到账 discount={discount}", now, request_id),
        )
        invite_result = InviteService.apply_recharge_rewards(conn, item, item.get("submit_ip") or "")
    try:
        NotificationService.create(user_id, "recharge_approved", "捐赠成功", f"你的 ¥{paid_amount} 捐赠已到账，获得 {points} 积分", str(request_id))
        if item.get("inviter_user_id") and invite_result.get("rebate_points", 0) > 0:
            NotificationService.create(item["inviter_user_id"], "invite_recharge_rebate", "邀请返利到账", f"你收到 {invite_result['rebate_points']} 积分返利", str(request_id))
    except Exception:
        pass
    logger.info(f"[appPush] 自动到账 request={request_id} user={user_id} points={points} paid={paid_amount} discount={discount}")
    return "success"
