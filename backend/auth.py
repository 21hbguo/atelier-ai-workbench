import os
import asyncio
import secrets
from datetime import datetime, timedelta
from typing import Optional
from fastapi import HTTPException, Security, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
import bcrypt
from backend.database import get_db
from backend.config import DATA_DIR

JWT_SECRET_FILE = DATA_DIR / ".jwt_secret"

def _save_jwt_secret(secret):
    try:
        fd = os.open(JWT_SECRET_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secret)
    except FileExistsError:
        pass

def _get_jwt_secret():
    secret = os.getenv("JWT_SECRET")
    if secret:
        _save_jwt_secret(secret)
        return secret
    if JWT_SECRET_FILE.exists():
        saved = JWT_SECRET_FILE.read_text().strip()
        if saved:
            return saved
    new_secret = secrets.token_hex(32)
    _save_jwt_secret(new_secret)
    if JWT_SECRET_FILE.exists():
        saved = JWT_SECRET_FILE.read_text().strip()
        if saved:
            return saved
    return new_secret


JWT_SECRET = _get_jwt_secret()
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "720"))

security = HTTPBearer(auto_error=False)


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(
        lambda: bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    )


async def verify_password(password: str, password_hash: str) -> bool:
    return await asyncio.to_thread(
        lambda: bcrypt.checkpw(password.encode(), password_hash.encode())
    )


def create_token(user_id: int, username: str, is_admin: bool = False) -> str:
    payload = {
        "user_id": user_id,
        "username": username,
        "is_admin": is_admin,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已过期")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token 无效")


def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Security(security)) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="请先登录")
    payload = decode_token(credentials.credentials)
    user_id = payload["user_id"]

    # 检查用户是否被冻结
    with get_db() as conn:
        user = conn.execute("SELECT is_frozen FROM users WHERE id = %s", (user_id,)).fetchone()
        if user and user["is_frozen"]:
            raise HTTPException(status_code=403, detail="账号已被冻结")

    return {"user_id": user_id, "username": payload["username"], "is_admin": payload.get("is_admin", False)}


def get_optional_user(credentials: Optional[HTTPAuthorizationCredentials] = Security(security)) -> Optional[dict]:
    if not credentials:
        return None
    try:
        return get_current_user(credentials)
    except HTTPException:
        return None


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


def record_request(user_id: int, status: str):
    """记录用户请求。成功/失败时清理对应的 processing 记录。"""
    with get_db() as conn:
        if status in ("success", "failed"):
            conn.execute(
                "DELETE FROM user_requests WHERE user_id = %s AND status = 'processing' AND id = (SELECT id FROM user_requests WHERE user_id = %s AND status = 'processing' ORDER BY id DESC LIMIT 1)",
                (user_id, user_id),
            )
        conn.execute(
            "INSERT INTO user_requests (user_id, status) VALUES (%s, %s)",
            (user_id, status),
        )


def get_client_ip(request) -> str:
    """获取真实客户端 IP（兼容反向代理）"""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host


def update_user_ip(user_id: int, ip: str, conn=None):
    """更新用户 IP"""
    if conn:
        conn.execute("UPDATE users SET last_ip = %s WHERE id = %s", (ip, user_id))
    else:
        with get_db() as c:
            c.execute("UPDATE users SET last_ip = %s WHERE id = %s", (ip, user_id))
