from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from backend.config import get_config, update_config

router = APIRouter(prefix="/api/config", tags=["config"])


class ConfigUpdate(BaseModel):
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    image_hosting_upload_url: Optional[str] = None
    image_hosting_base_url: Optional[str] = None
    image_hosting_referer: Optional[str] = None


@router.get("")
async def get_runtime_config():
    cfg = get_config()
    cfg["api_key"] = "***" if cfg.get("api_key") else ""
    return cfg


@router.post("")
async def update_runtime_config(body: ConfigUpdate):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    update_config(updates)
    return {"status": "ok"}
