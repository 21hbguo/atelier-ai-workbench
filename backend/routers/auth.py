import time
import logging
import httpx
import os
import ipaddress
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, Field
from backend.database import get_db
from backend.auth import hash_password, verify_password, create_token, create_refresh_token, rotate_refresh_token, revoke_refresh_token, get_current_user, update_user_ip, get_client_ip, set_auth_cookies, clear_auth_cookies, REFRESH_COOKIE_NAME, validate_account, normalize_account, build_user_payload
from backend.services.points_service import PointsService
from backend.services.invite_service import InviteService
from backend.config import get_limit_config, is_register_enabled, get_turnstile_config, get_config

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)
_login_attempts = defaultdict(list)
_register_attempts = defaultdict(list)
_login_rate_hits = 0
_register_rate_hits = 0
_ALLOWED_EMAIL_DOMAINS = {"qq.com", "vip.qq.com", "foxmail.com", "163.com", "126.com", "yeah.net", "188.com", "sina.com", "sohu.com", "139.com", "189.cn", "21cn.com", "aliyun.com", "gmail.com", "outlook.com", "hotmail.com"}
_TURNSTILE_DEV_BYPASS = os.getenv("TURNSTILE_DEV_BYPASS", "false").lower() in {"1", "true", "yes", "on"}


def _check_rate(bucket, key: str, limit: int, message: str, hit_counter_name: str):
    now = time.time()
    key = key or "unknown"
    bucket[key] = [t for t in bucket[key] if now - t < 60]
    if len(bucket[key]) >= limit:
        globals()[hit_counter_name] += 1
        raise HTTPException(status_code=429, detail=message)
    bucket[key].append(now)


def _check_login_rate(ip: str, account: str):
    global _login_rate_hits
    limit_cfg = get_limit_config()
    limit = limit_cfg["login_rate_limit_per_minute_per_ip"]
    _check_rate(_login_attempts, f"ip:{ip}", limit, "登录尝试过于频繁，请稍后再试", "_login_rate_hits")
    if account:
        _check_rate(_login_attempts, f"account:{account.lower()}", limit, "登录尝试过于频繁，请稍后再试", "_login_rate_hits")


def _check_register_rate(ip: str, account: str, email: str):
    global _register_rate_hits
    limit_cfg = get_limit_config()
    limit = limit_cfg["register_rate_limit_per_minute_per_ip"]
    _check_rate(_register_attempts, f"ip:{ip}", limit, "注册过于频繁，请稍后再试", "_register_rate_hits")
    if account:
        _check_rate(_register_attempts, f"account:{account.lower()}", limit, "注册过于频繁，请稍后再试", "_register_rate_hits")
    if email:
        _check_rate(_register_attempts, f"email:{email.lower()}", limit, "注册过于频繁，请稍后再试", "_register_rate_hits")


def get_rate_limit_stats():
    return {"login_rate_hits": _login_rate_hits, "register_rate_hits": _register_rate_hits, "login_active_ips": len([k for k, v in _login_attempts.items() if v and time.time() - v[-1] < 60]), "register_active_ips": len([k for k, v in _register_attempts.items() if v and time.time() - v[-1] < 60])}


def _normalize_and_validate_email(email: str) -> str:
    value = (email or "").strip().lower()
    if "@" not in value or value.startswith("@") or value.endswith("@"):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")
    domain = value.rsplit("@", 1)[-1]
    if domain not in _ALLOWED_EMAIL_DOMAINS:
        raise HTTPException(status_code=400, detail="请使用常用邮箱地址")
    return value


def _email_send_failed_error():
    contact=(get_config().get("donation_contact") or "").strip()
    return HTTPException(status_code=500, detail=f"发送失败，请联系{contact}" if contact else "发送失败，请联系管理员")


def _is_turnstile_dev_host(host: str) -> bool:
    value = (host or "").strip().lower()
    if not value:
        return False
    hostname = value.split(":", 1)[0].strip("[]")
    if hostname in {"localhost", "127.0.0.1", "::1"} or hostname.endswith(".local") or hostname.endswith(".ts.net"):
        return True
    try:
        addr = ipaddress.ip_address(hostname)
        return addr.is_loopback or addr.is_private or addr in ipaddress.ip_network("100.64.0.0/10")
    except ValueError:
        return False


def _should_bypass_turnstile(request: Request) -> bool:
    return _TURNSTILE_DEV_BYPASS and _is_turnstile_dev_host(request.headers.get("host", ""))


class RegisterRequest(BaseModel):
    account: str = Field(..., min_length=5, max_length=16)
    password: str = Field(..., min_length=6, max_length=50)
    nickname: str = None
    email: str = Field(..., min_length=5, max_length=255)
    code: str = Field(..., min_length=6, max_length=6)
    invite_code: str = Field("", max_length=32)
    turnstile_token: str = Field(..., min_length=1, max_length=4096)


class SendCodeRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    turnstile_token: str = Field(..., min_length=1, max_length=4096)


class LoginRequest(BaseModel):
    account: str
    password: str
    turnstile_token: str = Field(..., min_length=1, max_length=4096)


class ResetPasswordRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    code: str = Field(..., min_length=6, max_length=6)
    password: str = Field(..., min_length=6, max_length=50)
    turnstile_token: str = Field(..., min_length=1, max_length=4096)


def _issue_session(response: Response, user_id: int, username: str, is_admin: bool, ip: str, user_agent: str):
    access_token = create_token(user_id, username, is_admin)
    refresh_token = create_refresh_token(user_id, ip=ip, user_agent=user_agent)
    set_auth_cookies(response, access_token, refresh_token)
    return access_token


async def _verify_turnstile(token: str, ip: str, request: Request):
    cfg = get_turnstile_config()
    if not cfg["enabled"]:
        return
    if _should_bypass_turnstile(request):
        return
    value = (token or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="请先完成人机验证")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", data={"secret": cfg["secret_key"], "response": value, "remoteip": ip})
            data = resp.json()
    except Exception as e:
        logger.exception("turnstile verify failed: %s", e)
        raise HTTPException(status_code=500, detail="人机验证服务不可用，请稍后再试")
    if not data.get("success"):
        raise HTTPException(status_code=400, detail="人机验证未通过，请重试")


@router.post("/send-code")
async def send_code(req: SendCodeRequest, request: Request):
    if not is_register_enabled():
        raise HTTPException(status_code=403, detail="当前已关闭注册")
    ip = get_client_ip(request)
    email = _normalize_and_validate_email(req.email)
    from backend.services.email_service import create_and_send_code
    try:
        await create_and_send_code(email, ip)
    except HTTPException as e:
        if e.status_code >= 500:
            raise _email_send_failed_error()
        raise
    return {"status": "ok", "message": "验证码已发送"}


@router.post("/send-reset-code")
async def send_reset_code(req: SendCodeRequest, request: Request):
    ip = get_client_ip(request)
    email = _normalize_and_validate_email(req.email)
    with get_db() as conn:
        user = conn.execute("SELECT id FROM users WHERE LOWER(email) = %s", (email,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="该邮箱未注册")
    from backend.services.email_service import create_and_send_code
    try:
        await create_and_send_code(email, ip)
    except HTTPException as e:
        if e.status_code >= 500:
            raise _email_send_failed_error()
        raise
    return {"status": "ok", "message": "验证码已发送"}


@router.post("/register")
async def register(req: RegisterRequest, request: Request, response: Response):
    if not is_register_enabled():
        raise HTTPException(status_code=403, detail="当前已关闭注册")
    account = validate_account(req.account)
    nickname = (req.nickname or "").strip() or account
    email = _normalize_and_validate_email(req.email)
    ip = get_client_ip(request)
    await _verify_turnstile(req.turnstile_token, ip, request)
    _check_register_rate(ip, account, email)
    from backend.services.email_service import verify_code, mark_registered
    verify_code(email, req.code)
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = %s", (account,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="账号已存在")
        nickname_existing = conn.execute("SELECT id FROM users WHERE nickname = %s", (nickname,)).fetchone()
        if nickname_existing:
            raise HTTPException(status_code=400, detail="昵称已存在")
        email_existing = conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
        if email_existing:
            raise HTTPException(status_code=400, detail="邮箱已被注册")
        password_hash = await hash_password(req.password)
        cursor = conn.execute("INSERT INTO users (username, password_hash, nickname, email) VALUES (%s, %s, %s, %s) RETURNING id", (account, password_hash, nickname, email))
        user_id = cursor.fetchone()["id"]
        update_user_ip(user_id, ip, conn=conn)
        register_bonus = PointsService.register_bonus()
        PointsService.add_points(user_id, register_bonus, "register_bonus", "注册赠送", conn=conn)
        invite_result = None
        if InviteService.is_enabled() and (req.invite_code or "").strip():
            invite_result = InviteService.apply_register_invite(conn, user_id, req.invite_code, ip)
        mark_registered(email)
    access_token = _issue_session(response, user_id, account, False, ip, request.headers.get("user-agent", ""))
    logger.info(f"[audit.register] user={user_id} username={account} ip={ip}")
    return {"token": access_token, "user": build_user_payload({"id": user_id, "account": account, "nickname": nickname, "is_admin": False, "points": register_bonus, "invite_code": "", "inviter_user_id": invite_result["inviter_user_id"] if invite_result else None})}


@router.post("/login")
async def login(req: LoginRequest, request: Request, response: Response):
    ip = get_client_ip(request)
    account = normalize_account(req.account)
    account_lower = account.lower()
    await _verify_turnstile(req.turnstile_token, ip, request)
    _check_login_rate(ip, account_lower)
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = %s OR LOWER(email) = %s", (account, account_lower)).fetchone()
        if not user or not await verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="账号/邮箱或密码错误")
        update_user_ip(user["id"], ip, conn=conn)
        conn.execute("UPDATE users SET last_active = %s WHERE id = %s", (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), user["id"]))
        payload = build_user_payload({"id": user["id"], "account": user["username"], "nickname": user["nickname"], "is_admin": user["is_admin"], "points": user["points"]})
    access_token = _issue_session(response, payload["id"], payload["account"], payload["is_admin"], ip, request.headers.get("user-agent", ""))
    logger.info(f"[audit.login] user={payload['id']} username={payload['account']} ip={ip}")
    return {"token": access_token, "user": payload}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest, request: Request, response: Response):
    await _verify_turnstile(req.turnstile_token, get_client_ip(request), request)
    email = _normalize_and_validate_email(req.email)
    from backend.services.email_service import verify_code
    verify_code(email, req.code)
    with get_db() as conn:
        user = conn.execute("SELECT id,username,nickname,is_admin,points,is_frozen FROM users WHERE LOWER(email) = %s", (email,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="该邮箱未注册")
        password_hash = await hash_password(req.password)
        conn.execute("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user["id"]))
        conn.execute("DELETE FROM auth_refresh_tokens WHERE user_id = %s", (user["id"],))
        update_user_ip(user["id"], get_client_ip(request), conn=conn)
        payload = build_user_payload({"id": user["id"], "account": user["username"], "nickname": user["nickname"], "is_admin": user["is_admin"], "points": user["points"]})
    access_token = _issue_session(response, payload["id"], payload["account"], payload["is_admin"], get_client_ip(request), request.headers.get("user-agent", ""))
    logger.info(f"[audit.reset_password] user={payload['id']} username={payload['account']} ip={get_client_ip(request)}")
    return {"token": access_token, "user": payload}


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    session = rotate_refresh_token(token, ip=get_client_ip(request), user_agent=request.headers.get("user-agent", ""))
    if not session:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="登录已失效")
    set_auth_cookies(response, session["access_token"], session["refresh_token"])
    logger.info(f"[audit.refresh] user={session['user']['id']} ip={get_client_ip(request)}")
    return {"token": session["access_token"], "user": session["user"]}


@router.post("/logout")
async def logout(request: Request, response: Response):
    revoke_refresh_token(request.cookies.get(REFRESH_COOKIE_NAME))
    clear_auth_cookies(response)
    logger.info(f"[audit.logout] ip={get_client_ip(request)}")
    return {"status": "ok"}


@router.get("/me")
async def get_me(user=Depends(get_current_user)):
    with get_db() as conn:
        u = conn.execute("SELECT id, username, nickname, avatar, is_admin, points, created_at, invite_code, inviter_user_id, register_invite_code, invited_at FROM users WHERE id = %s", (user["user_id"],)).fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="用户不存在")
        d = dict(u)
        d["is_admin"] = bool(d.get("is_admin"))
        d["account"] = d.get("username", "")
        return d
