from fastapi import APIRouter, HTTPException, Depends, Request, Query
from pydantic import BaseModel
from backend.auth import get_current_user, get_client_ip
from backend.services.points_service import PointsService
from backend.database import get_db

router = APIRouter(prefix="/api/points", tags=["points"])


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
            """SELECT t.*, rr.channel, rr.amount as recharge_amount, rr.points as recharge_points,
                      rr.payer_name, rr.tx_no, rr.proof_url, rr.remark, rr.status as recharge_status,
                      rr.redeem_code, rr.review_note, rr.created_at as recharge_created_at,
                      rr.reviewed_at, rr.reviewed_by
               FROM point_transactions t
               LEFT JOIN recharge_requests rr ON t.recharge_request_id = rr.id
               WHERE t.user_id = %s ORDER BY t.created_at DESC LIMIT %s OFFSET %s""",
            (user["user_id"], size, offset)
        ).fetchall()
        return {"total": total, "items": [dict(r) for r in rows], "page": page, "size": size}


@router.post("/recharge/requests")
async def create_recharge_request(body: RechargeCreateRequest, user=Depends(get_current_user)):
    channel = (body.channel or "").strip().lower()
    if channel not in {"wechat", "alipay"}:
        raise HTTPException(status_code=400, detail="充值渠道仅支持 wechat/alipay")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="充值金额必须大于0")
    if body.points <= 0:
        raise HTTPException(status_code=400, detail="兑换积分必须大于0")
    payer_name = (body.payer_name or "").strip()[:64]
    from datetime import datetime
    tx_no = f"RCH{datetime.now().strftime('%Y%m%d%H%M%S')}{user['user_id']}"
    proof_url = (body.proof_url or "").strip()[:1000]
    remark = (body.remark or "").strip()[:500]
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO recharge_requests (user_id, channel, amount, points, payer_name, tx_no, proof_url, remark, status) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending') RETURNING id",
            (user["user_id"], channel, body.amount, body.points, payer_name, tx_no, proof_url, remark),
        )
        request_id = cursor.fetchone()["id"]
        balance = conn.execute("SELECT points FROM users WHERE id = %s", (user["user_id"],)).fetchone()["points"]
        conn.execute(
            "INSERT INTO point_transactions (user_id, amount, balance_after, type, description, recharge_request_id) VALUES (%s, %s, %s, %s, %s, %s)",
            (user["user_id"], 0, balance, "recharge_pending", f"充值申请待审核 (¥{body.amount})", request_id),
        )
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
