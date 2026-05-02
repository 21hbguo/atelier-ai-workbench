from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from backend.auth import get_current_user, get_client_ip
from backend.services.points_service import PointsService

router = APIRouter(prefix="/api/points", tags=["points"])


class RedeemRequest(BaseModel):
    code: str


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
    from backend.database import get_db
    offset = (page - 1) * size
    with get_db() as conn:
        total = conn.execute(
            "SELECT COUNT(*) as cnt FROM point_transactions WHERE user_id = ?",
            (user["user_id"],)
        ).fetchone()["cnt"]
        rows = conn.execute(
            "SELECT * FROM point_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (user["user_id"], size, offset)
        ).fetchall()
        return {"total": total, "items": [dict(r) for r in rows], "page": page, "size": size}
