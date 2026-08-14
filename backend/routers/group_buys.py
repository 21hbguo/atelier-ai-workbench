from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.auth import get_current_user, get_optional_user, get_client_ip
from backend.database import get_db
from backend.services import group_buy_service

router = APIRouter(prefix="/api/group-buys", tags=["group-buys"])


class PayChannelRequest(BaseModel):
    channel: str = Field(..., description="wechat/alipay")


@router.get("/active")
async def active_group_buys(user=Depends(get_current_user)):
    with get_db() as conn:
        return {"items": group_buy_service.list_active_group_buys(conn)}


@router.get("/teams/{team_id}")
async def team_detail(team_id: int, user=Depends(get_optional_user)):
    viewer_user_id = (user or {}).get("user_id")
    with get_db() as conn:
        try:
            return group_buy_service.get_team_detail(conn, team_id, viewer_user_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{group_buy_id}/create-team-and-pay")
async def create_team_and_pay(group_buy_id: int, body: PayChannelRequest, request: Request, user=Depends(get_current_user)):
    try:
        with get_db() as conn:
            return group_buy_service.join_or_create_team(
                conn, user["user_id"], group_buy_id, body.channel, get_client_ip(request),
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/teams/{team_id}/upgrade")
async def upgrade_team(team_id: int, body: PayChannelRequest, request: Request, user=Depends(get_current_user)):
    try:
        with get_db() as conn:
            return group_buy_service.upgrade_team(
                conn, user["user_id"], team_id, body.channel, get_client_ip(request),
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
