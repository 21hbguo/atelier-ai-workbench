import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from backend.auth import get_current_user
from backend.database import get_db
from backend.config import GENERATED_IMAGES_DIR

router = APIRouter(tags=["shares"])
api_router = APIRouter(prefix="/api/shares", tags=["shares"])

class ShareCreateRequest(BaseModel):
    filename: str = Field(..., min_length=3, max_length=255)
    expires_days: int = Field(7, ge=1, le=365)

@api_router.post("")
async def create_share(req: ShareCreateRequest, user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute("SELECT user_id FROM image_metadata WHERE filename = %s", (req.filename,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="图片不存在")
        if not user.get("is_admin") and row["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="无权分享此图片")
        token = secrets.token_urlsafe(24)
        expires_at = (datetime.now() + timedelta(days=req.expires_days)).strftime("%Y-%m-%d %H:%M:%S")
        share_id = conn.execute("INSERT INTO share_links (user_id, filename, token, expires_at, is_revoked) VALUES (%s, %s, %s, %s, FALSE) RETURNING id", (user["user_id"], req.filename, token, expires_at)).fetchone()["id"]
    return {"id": share_id, "token": token, "url": f"/s/{token}", "expires_at": expires_at}

@api_router.get("")
async def list_shares(user=Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT id,filename,token,expires_at,is_revoked,created_at FROM share_links WHERE user_id = %s ORDER BY created_at DESC LIMIT 100", (user["user_id"],)).fetchall()
    return {"items": [dict(r) for r in rows]}

@api_router.post("/{share_id}/revoke")
async def revoke_share(share_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute("UPDATE share_links SET is_revoked = TRUE WHERE id = %s AND user_id = %s RETURNING id", (share_id, user["user_id"])).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="分享记录不存在")
    return {"message": "已撤销"}

@router.get("/s/{token}")
async def access_shared_file(token: str):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_db() as conn:
        row = conn.execute("SELECT filename,expires_at,is_revoked FROM share_links WHERE token = %s", (token,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="分享不存在")
    if row["is_revoked"]:
        raise HTTPException(status_code=410, detail="分享已撤销")
    if str(row["expires_at"]) < now:
        raise HTTPException(status_code=410, detail="分享已过期")
    image_path = GENERATED_IMAGES_DIR / row["filename"]
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")
    return FileResponse(str(image_path))
