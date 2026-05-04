from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from backend.config import get_config, update_config, get_generation_models, get_generation_providers, get_default_model_id, get_recharge_packages
from backend.auth import get_current_user, get_optional_user, require_admin
from backend.services.gen_gateway import GenGateway

router = APIRouter(prefix="/api/config", tags=["config"])


class ConfigUpdate(BaseModel):
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    register_enabled: Optional[bool] = None
    image_hosting_upload_url: Optional[str] = None
    image_hosting_base_url: Optional[str] = None
    image_hosting_referer: Optional[str] = None
    wechat_pay_qr_url: Optional[str] = None
    alipay_pay_qr_url: Optional[str] = None
    manual_recharge_notice: Optional[str] = None
    recharge_packages: Optional[List[Dict[str, Any]]] = None
    generate_concurrent_limit_per_user: Optional[int] = Field(None, ge=1)
    points_cost_per_generation: Optional[int] = Field(None, ge=1)
    points_checkin_reward: Optional[int] = Field(None, ge=0)
    points_register_bonus: Optional[int] = Field(None, ge=0)
    points_migration_amount: Optional[int] = Field(None, ge=0)
    login_rate_limit_per_minute_per_ip: Optional[int] = Field(None, ge=1)
    register_rate_limit_per_minute_per_ip: Optional[int] = Field(None, ge=1)
    default_model_id: Optional[str] = None
    generation_models: Optional[Dict[str, Any]] = None
    generation_providers: Optional[Dict[str, Any]] = None
    cost_profit_config: Optional[Dict[str, Any]] = None
    cost_profit_launch_at: Optional[str] = None
    github_hosting_enabled: Optional[bool] = None
    github_hosting_repo: Optional[str] = None
    github_hosting_token: Optional[str] = None
    github_hosting_branch: Optional[str] = None
    smtp_server: Optional[str] = None
    smtp_port: Optional[int] = Field(None, ge=1, le=65535)
    smtp_password: Optional[str] = None
    smtp_sender: Optional[str] = None
    smtp_sender_name: Optional[str] = None


@router.get("")
async def get_runtime_config(user=Depends(get_optional_user)):
    cfg = get_config()
    if user and user.get("is_admin"):
        cfg["api_key"] = "***" if cfg.get("api_key") else ""
        cfg["github_hosting_token"] = "***" if cfg.get("github_hosting_token") else ""
        cfg["smtp_password"] = "***" if cfg.get("smtp_password") else ""
        return cfg
    return {
        "register_enabled": bool(cfg.get("register_enabled", True)),
        "wechat_pay_qr_url": cfg.get("wechat_pay_qr_url", ""),
        "alipay_pay_qr_url": cfg.get("alipay_pay_qr_url", ""),
        "manual_recharge_notice": cfg.get("manual_recharge_notice", ""),
        "recharge_packages": get_recharge_packages(),
        "points_cost_per_generation": cfg.get("points_cost_per_generation", 10),
    }


@router.get("/admin")
async def get_runtime_config_admin(admin=Depends(require_admin)):
    cfg = get_config()
    cfg["api_key"] = "***" if cfg.get("api_key") else ""
    cfg["github_hosting_token"] = "***" if cfg.get("github_hosting_token") else ""
    cfg["smtp_password"] = "***" if cfg.get("smtp_password") else ""
    cfg["recharge_packages"] = get_recharge_packages()
    return cfg


@router.post("")
async def update_runtime_config(body: ConfigUpdate, admin=Depends(require_admin)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if updates.get("github_hosting_token") == "***":
        del updates["github_hosting_token"]
    if updates.get("smtp_password") == "***":
        del updates["smtp_password"]
    update_config(updates)
    return {"status": "ok"}


@router.get("/models")
async def list_generation_models(user=Depends(get_current_user)):
    return {"default_model_id": get_default_model_id(), "models": GenGateway.public_models()}


@router.get("/generation/admin")
async def get_generation_config_admin(admin=Depends(require_admin)):
    return {"default_model_id": get_default_model_id(), "generation_models": get_generation_models(), "generation_providers": get_generation_providers()}
