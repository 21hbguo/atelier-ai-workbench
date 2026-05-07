import os
import re
import asyncio
import secrets
import hashlib
import ipaddress
from datetime import datetime, timedelta
from typing import Optional
from fastapi import HTTPException, Security, Depends, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
import bcrypt
from backend.database import get_db
from backend.config import DATA_DIR

JWT_SECRET_FILE = DATA_DIR / ".jwt_secret"
JWT_ALGORITHM = "HS256"
ACCESS_COOKIE_NAME = os.getenv("ACCESS_COOKIE_NAME", "access_token")
REFRESH_COOKIE_NAME = os.getenv("REFRESH_COOKIE_NAME", "refresh_token")
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("ACCESS_TOKEN_EXPIRE_HOURS", os.getenv("JWT_EXPIRE_HOURS", "12")))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "14"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in {"1", "true", "yes", "on"}
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax")
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "false").lower() in {"1", "true", "yes", "on"}
TRUSTED_PROXY_IPS = [i.strip() for i in os.getenv("TRUSTED_PROXY_IPS", "127.0.0.1,::1,private").split(",") if i.strip()]
security = HTTPBearer(auto_error=False)
ACCOUNT_RE = re.compile(r"^[A-Za-z0-9_]{4,16}$")


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


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(lambda: bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode())


async def verify_password(password: str, password_hash: str) -> bool:
    return await asyncio.to_thread(lambda: bcrypt.checkpw(password.encode(), password_hash.encode()))


def normalize_account(account: str) -> str:
    return (account or "").strip()


def validate_account(account: str) -> str:
    account = normalize_account(account)
    if not ACCOUNT_RE.fullmatch(account):
        raise HTTPException(status_code=400, detail="账号需为4到16位字母、数字或下划线")
    return account


def build_user_payload(user: dict) -> dict:
    account = user.get("account") or user.get("username") or ""
    return {"id": user.get("id") or user.get("user_id"), "account": account, "username": account, "nickname": user.get("nickname"), "is_admin": bool(user.get("is_admin")), "points": user.get("points")}


def create_token(user_id: int, username: str, is_admin: bool = False) -> str:
    payload = {"user_id": user_id, "username": username, "is_admin": is_admin, "type": "access", "exp": datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Token 无效")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已过期")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token 无效")


def _hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_refresh_token(user_id: int, ip: str = "", user_agent: str = "") -> str:
    token = secrets.token_urlsafe(48)
    expires_at = (datetime.now() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    safe_ip = (ip or "")[:45]
    safe_ua = (user_agent or "")[:255]
    with get_db() as conn:
        conn.execute(
            "INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at, last_ip, user_agent) VALUES (%s, %s, %s, %s, %s)",
            (user_id, _hash_refresh_token(token), expires_at, safe_ip, safe_ua),
        )
    return token


def revoke_refresh_token(token: str):
    if not token:
        return
    with get_db() as conn:
        conn.execute("UPDATE auth_refresh_tokens SET revoked_at = %s WHERE token_hash = %s AND revoked_at IS NULL", (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), _hash_refresh_token(token)))


def rotate_refresh_token(token: str, ip: str = "", user_agent: str = "") -> Optional[dict]:
    if not token:
        return None
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_db() as conn:
        row = conn.execute(
            "SELECT rt.*,u.username,u.nickname,u.is_admin,u.points,u.is_frozen FROM auth_refresh_tokens rt JOIN users u ON rt.user_id=u.id WHERE rt.token_hash = %s AND rt.revoked_at IS NULL",
            (_hash_refresh_token(token),),
        ).fetchone()
        if not row:
            return None
        item = dict(row)
        if item["is_frozen"] or str(item["expires_at"]) < now:
            conn.execute("UPDATE auth_refresh_tokens SET revoked_at = %s WHERE id = %s AND revoked_at IS NULL", (now, item["id"]))
            return None
        conn.execute("UPDATE auth_refresh_tokens SET revoked_at = %s WHERE id = %s AND revoked_at IS NULL", (now, item["id"]))
        new_token = create_refresh_token(item["user_id"], ip=ip, user_agent=user_agent)
        return {"refresh_token": new_token, "access_token": create_token(item["user_id"], item["username"], bool(item["is_admin"])), "user": build_user_payload({"id": item["user_id"], "account": item["username"], "nickname": item["nickname"], "is_admin": item["is_admin"], "points": item["points"]})}


def _request_token(credentials: Optional[HTTPAuthorizationCredentials], request: Optional[Request]) -> Optional[str]:
    if credentials and credentials.credentials:
        return credentials.credentials
    if request:
        return request.cookies.get(ACCESS_COOKIE_NAME)
    return None
def _optional_user_from_refresh(request: Optional[Request]) -> Optional[dict]:
    if not request:
        return None
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token:
        return None
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_db() as conn:
        row = conn.execute(
            "SELECT rt.user_id,u.username,u.nickname,u.is_admin,u.is_frozen,u.points,rt.expires_at FROM auth_refresh_tokens rt JOIN users u ON rt.user_id=u.id WHERE rt.token_hash=%s AND rt.revoked_at IS NULL",
            (_hash_refresh_token(refresh_token),),
        ).fetchone()
        if not row:
            return None
        item = dict(row)
        if item["is_frozen"] or str(item["expires_at"]) < now:
            return None
        return {"user_id": item["user_id"], "account": item["username"], "username": item["username"], "nickname": item["nickname"], "is_admin": bool(item["is_admin"]), "points": item["points"]}


def get_current_user(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = Security(security)) -> dict:
    token = _request_token(credentials, request)
    if not token:
        raise HTTPException(status_code=401, detail="请先登录")
    payload = decode_token(token)
    user_id = payload["user_id"]
    with get_db() as conn:
        user = conn.execute("SELECT id,username,nickname,is_admin,is_frozen,points FROM users WHERE id = %s", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=401, detail="用户不存在")
        data = dict(user)
        if data["is_frozen"]:
            raise HTTPException(status_code=403, detail="账号已被冻结")
    return {"user_id": data["id"], "account": data["username"], "username": data["username"], "nickname": data["nickname"], "is_admin": bool(data["is_admin"]), "points": data["points"]}


def get_optional_user(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = Security(security)) -> Optional[dict]:
    token = _request_token(credentials, request)
    if not token:
        return _optional_user_from_refresh(request)
    try:
        return get_current_user(request, credentials)
    except HTTPException:
        return _optional_user_from_refresh(request)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


def record_request(user_id: int, status: str):
    with get_db() as conn:
        conn.execute("INSERT INTO user_requests (user_id, status) VALUES (%s, %s)", (user_id, status))


def _normalize_ip(value: str) -> str:
    item = (value or "").strip().strip('"').strip("'")
    if not item or item.lower() == "unknown":
        return ""
    if item.lower().startswith("for="):
        item = item[4:].strip().strip('"').strip("'")
    if ";" in item:
        item = item.split(";", 1)[0].strip()
    if item.startswith("[") and "]" in item:
        item = item[1:item.index("]")]
    elif item.count(":") == 1 and "." in item:
        item = item.rsplit(":", 1)[0]
    try:
        return str(ipaddress.ip_address(item))
    except ValueError:
        return ""


def _first_header_ip(value: str) -> str:
    for item in (value or "").split(","):
        ip = _normalize_ip(item)
        if ip:
            return ip
    return ""


def _forwarded_header_ip(value: str) -> str:
    for part in (value or "").split(","):
        for item in part.split(";"):
            key, sep, raw = item.strip().partition("=")
            if sep and key.lower() == "for":
                ip = _normalize_ip(raw)
                if ip:
                    return ip
    return ""


def _is_trusted_proxy(remote_ip: str) -> bool:
    if not TRUST_PROXY_HEADERS:
        return False
    ip = _normalize_ip(remote_ip)
    if not ip:
        return False
    if "*" in TRUSTED_PROXY_IPS:
        return True
    addr = ipaddress.ip_address(ip)
    for item in TRUSTED_PROXY_IPS:
        token = item.lower()
        if token == "loopback" and addr.is_loopback:
            return True
        if token == "private" and addr.is_private:
            return True
        exact = _normalize_ip(item)
        if exact and exact == ip:
            return True
        try:
            if addr in ipaddress.ip_network(item, strict=False):
                return True
        except ValueError:
            continue
    return False


def get_client_ip(request: Request) -> str:
    remote_host = request.client.host if request.client and request.client.host else ""
    remote_ip = _normalize_ip(remote_host)
    if _is_trusted_proxy(remote_host):
        for header_ip in (_first_header_ip(request.headers.get("cf-connecting-ip", "")), _forwarded_header_ip(request.headers.get("forwarded", "")), _first_header_ip(request.headers.get("x-forwarded-for", "")), _first_header_ip(request.headers.get("x-real-ip", ""))):
            if header_ip:
                return header_ip
    return remote_ip or remote_host


def update_user_ip(user_id: int, ip: str, conn=None):
    if conn:
        conn.execute("UPDATE users SET last_ip = %s WHERE id = %s", (ip, user_id))
    else:
        with get_db() as c:
            c.execute("UPDATE users SET last_ip = %s WHERE id = %s", (ip, user_id))


def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    options = {"httponly": True, "secure": COOKIE_SECURE, "samesite": COOKIE_SAMESITE, "path": "/"}
    response.set_cookie(ACCESS_COOKIE_NAME, access_token, max_age=ACCESS_TOKEN_EXPIRE_HOURS * 3600, **options)
    response.set_cookie(REFRESH_COOKIE_NAME, refresh_token, max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400, **options)


def clear_auth_cookies(response: Response):
    options = {"httponly": True, "secure": COOKIE_SECURE, "samesite": COOKIE_SAMESITE, "path": "/"}
    response.delete_cookie(ACCESS_COOKIE_NAME, **options)
    response.delete_cookie(REFRESH_COOKIE_NAME, **options)
