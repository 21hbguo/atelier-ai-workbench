from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Optional
from backend.config import get_config, update_config
from backend.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/config", tags=["config"])


class ConfigUpdate(BaseModel):
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    image_hosting_upload_url: Optional[str] = None
    image_hosting_base_url: Optional[str] = None
    image_hosting_referer: Optional[str] = None
    wechat_pay_qr_url: Optional[str] = None
    alipay_pay_qr_url: Optional[str] = None
    manual_recharge_notice: Optional[str] = None
    generate_concurrent_limit_per_user: Optional[int] = Field(None, ge=1)
    points_cost_per_generation: Optional[int] = Field(None, ge=1)
    points_checkin_reward: Optional[int] = Field(None, ge=0)
    points_register_bonus: Optional[int] = Field(None, ge=0)
    points_migration_amount: Optional[int] = Field(None, ge=0)
    login_rate_limit_per_minute_per_ip: Optional[int] = Field(None, ge=1)
    register_rate_limit_per_minute_per_ip: Optional[int] = Field(None, ge=1)


@router.get("")
async def get_runtime_config(user=Depends(get_current_user)):
    cfg = get_config()
    if user.get("is_admin"):
        cfg["api_key"] = "***" if cfg.get("api_key") else ""
        return cfg
    return {
        "wechat_pay_qr_url": cfg.get("wechat_pay_qr_url", ""),
        "alipay_pay_qr_url": cfg.get("alipay_pay_qr_url", ""),
        "manual_recharge_notice": cfg.get("manual_recharge_notice", ""),
    }


@router.get("/admin")
async def get_runtime_config_admin(admin=Depends(require_admin)):
    cfg = get_config()
    cfg["api_key"] = "***" if cfg.get("api_key") else ""
    return cfg


@router.post("")
async def update_runtime_config(body: ConfigUpdate, admin=Depends(require_admin)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    update_config(updates)
    return {"status": "ok"}
