import hashlib
from collections import Counter
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from backend.auth import get_current_user, verify_password, hash_password, REFRESH_COOKIE_NAME
from backend.database import get_db
from backend.services.banned_words import BannedWordsService

router = APIRouter(prefix="/api/account", tags=["account"])

class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., min_length=6, max_length=50)
    new_password: str = Field(..., min_length=6, max_length=50)

# 自定义指令（用户级长期指令）上限：对齐聊天消息内容上限 ChatSendRequest.content max_length=2000
CUSTOM_INSTRUCTIONS_MAX_LEN = 2000

class CustomInstructionsRequest(BaseModel):
    custom_instructions: str = Field("", max_length=CUSTOM_INSTRUCTIONS_MAX_LEN)

@router.post("/change-password")
async def change_password(req: ChangePasswordRequest, user=Depends(get_current_user)):
    if req.old_password == req.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与旧密码相同")
    with get_db() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id = %s", (user["user_id"],)).fetchone()
        if not row or not await verify_password(req.old_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="旧密码错误")
        new_hash = await hash_password(req.new_password)
        conn.execute("UPDATE users SET password_hash = %s WHERE id = %s", (new_hash, user["user_id"]))
    return {"message": "密码修改成功"}

@router.get("/security-sessions")
async def security_sessions(request: Request, page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), user=Depends(get_current_user)):
    offset = (page - 1) * size
    current_hash = hashlib.sha256((request.cookies.get(REFRESH_COOKIE_NAME) or "").encode()).hexdigest() if request.cookies.get(REFRESH_COOKIE_NAME) else ""
    now = datetime.now()
    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) cnt FROM auth_refresh_tokens WHERE user_id = %s", (user["user_id"],)).fetchone()["cnt"]
        rows = conn.execute("SELECT id, token_hash, expires_at, created_at, revoked_at, last_ip, user_agent FROM auth_refresh_tokens WHERE user_id = %s ORDER BY created_at DESC LIMIT %s OFFSET %s", (user["user_id"], size, offset)).fetchall()
    items = []
    raw = [dict(r) for r in rows]
    recent = [r for r in raw if r.get("created_at") and datetime.fromisoformat(str(r["created_at"]).replace(" ", "T")) >= now - timedelta(hours=24)]
    ip_counts = Counter(str(r.get("last_ip") or "") for r in recent if r.get("last_ip"))
    ua_counts = Counter(str(r.get("user_agent") or "") for r in recent if r.get("user_agent"))
    most_common_ip = ip_counts.most_common(1)[0][0] if ip_counts else None
    most_common_ua = ua_counts.most_common(1)[0][0] if ua_counts else None
    for r in raw:
        created_at = r.get("created_at")
        revoked_at = r.get("revoked_at")
        is_current = current_hash and r.get("token_hash") == current_hash
        ip = r.get("last_ip")
        ua = r.get("user_agent")
        if ip and ip != most_common_ip:
            risk = "high"
        elif ua and ua != most_common_ua:
            risk = "high"
        else:
            risk = "low"
        items.append({"id": r["id"], "ip": ip or "", "user_agent": ua or "", "created_at": created_at, "last_seen_at": revoked_at or created_at, "is_current": bool(is_current), "risk_level": risk, "revoked": bool(revoked_at)})
    return {"total": total, "items": items, "page": page, "size": size}

@router.get("/custom-instructions")
async def get_custom_instructions(user=Depends(get_current_user)) -> dict:
    """读取用户自定义指令（未设置返回空串；指令注入聊天 system prompt，见 chat_service）。"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT COALESCE(custom_instructions, '') AS ci FROM users WHERE id = %s",
            (user["user_id"],),
        ).fetchone()
    return {"custom_instructions": row["ci"] if row else ""}

@router.put("/custom-instructions")
async def update_custom_instructions(req: CustomInstructionsRequest,
                                    user=Depends(get_current_user)) -> dict:
    """保存用户自定义指令。校验顺序固定：长度（pydantic 422）→ trim → 敏感词（400）→ UPDATE。

    空串/纯空白 = 停用（存 NULL，与未设置等价）。
    """
    text = req.custom_instructions.strip()
    if len(text) > CUSTOM_INSTRUCTIONS_MAX_LEN:  # 双保险（pydantic 已拦，防绕过）
        raise HTTPException(status_code=422, detail="自定义指令最多 2000 个字符")
    hit = BannedWordsService.check(text)
    if hit:
        raise HTTPException(status_code=400, detail="内容包含违规词汇，请修改后重试")
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET custom_instructions = %s WHERE id = %s",
            (text or None, user["user_id"]),  # 空串存 NULL
        )
    return {"message": "保存成功"}
