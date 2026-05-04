from fastapi import APIRouter, HTTPException, Depends, Request, Query
from pydantic import BaseModel
import json
import logging
import secrets
from backend.auth import get_current_user, get_client_ip
from backend.services.points_service import PointsService
from backend.services.upload_file_service import UploadFileService
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
    payer_name: str = ""
    tx_no: str = ""
    proof_url: str = ""
    remark: str = ""


def _build_recharge_risk(conn, user_id: int, ip: str, tx_no: str, amount: float, proof_url: str):
    flags = []
    recent_user = conn.execute("SELECT COUNT(*) AS cnt FROM recharge_requests WHERE user_id = %s AND created_at >= NOW() - interval '10 minutes'", (user_id,)).fetchone()["cnt"]
    if int(recent_user or 0) >= 3:
        flags.append("user_high_frequency")
    dup_tx = conn.execute("SELECT id FROM recharge_requests WHERE tx_no = %s LIMIT 1", (tx_no,)).fetchone()
    if dup_tx:
        flags.append("duplicate_tx_no")
    dup_proof = conn.execute("SELECT COUNT(*) AS cnt FROM recharge_requests WHERE proof_url = %s AND user_id <> %s", (proof_url, user_id)).fetchone()["cnt"]
    if int(dup_proof or 0) > 0:
        flags.append("shared_proof_url")
    if amount >= 500:
        flags.append("high_amount")
    level = "high" if len(flags) >= 2 else ("medium" if len(flags) == 1 else "low")
    return level, flags


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
        raise HTTPException(status_code=400, detail="充值渠道仅支持 wechat/alipay")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="充值金额必须大于0")
    if body.points <= 0:
        raise HTTPException(status_code=400, detail="兑换积分必须大于0")
    if not any(abs(float(pkg["amount"]) - float(body.amount)) < 1e-6 and int(pkg["points"]) == int(body.points) for pkg in get_recharge_packages()):
        raise HTTPException(status_code=400, detail="充值套餐已变更，请刷新页面后重试")
    payer_name = (body.payer_name or "").strip()[:64]
    from datetime import datetime
    tx_no = f"RCH{datetime.now().strftime('%Y%m%d%H%M%S')}{user['user_id']}{secrets.token_hex(4).upper()}"
    proof_url = (body.proof_url or "").strip()[:1000]
    if not proof_url.startswith("/api/uploads/"):
        raise HTTPException(status_code=400, detail="支付凭证地址不合法")
    file_key = proof_url.rsplit("/", 1)[-1]
    if not UploadFileService.belongs_to_user(file_key, user["user_id"]):
        raise HTTPException(status_code=400, detail="支付凭证不存在或无权使用")
    remark = (body.remark or "").strip()[:500]
    ip = get_client_ip(request)
    with get_db() as conn:
        risk_level, risk_flags = _build_recharge_risk(conn, user["user_id"], ip, tx_no, body.amount, proof_url)
        cursor = conn.execute(
            "INSERT INTO recharge_requests (user_id, channel, amount, points, payer_name, tx_no, proof_url, remark, status, risk_level, risk_flags) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s, %s) RETURNING id",
            (user["user_id"], channel, body.amount, body.points, payer_name, tx_no, proof_url, remark, risk_level, json.dumps(risk_flags, ensure_ascii=False)),
        )
        request_id = cursor.fetchone()["id"]
        balance = conn.execute("SELECT points FROM users WHERE id = %s", (user["user_id"],)).fetchone()["points"]
        conn.execute(
            "INSERT INTO point_transactions (user_id, amount, balance_after, type, description, recharge_request_id) VALUES (%s, %s, %s, %s, %s, %s)",
            (user["user_id"], 0, balance, "recharge_pending", f"充值申请待审核 (¥{body.amount})", request_id),
        )
        admins = conn.execute("SELECT id FROM users WHERE is_admin = TRUE").fetchall()
    for a in admins or []:
        try:
            NotificationService.create(a["id"], "recharge_pending", "待审核充值申请", f"用户 {user['username']} 提交了充值申请 ¥{body.amount}", str(request_id))
        except Exception:
            pass
    logger.info(f"[audit.recharge.request] id={request_id} user={user['user_id']} amount={body.amount} points={body.points} risk={risk_level} flags={','.join(risk_flags) if risk_flags else 'none'} ip={ip}")
    return {"id": request_id, "tx_no": tx_no, "message": "充值申请已提交，等待审核"}


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
