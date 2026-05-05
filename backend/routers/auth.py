import time
import logging
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, Field
from backend.database import get_db
from backend.auth import hash_password, verify_password, create_token, create_refresh_token, rotate_refresh_token, revoke_refresh_token, get_current_user, update_user_ip, get_client_ip, set_auth_cookies, clear_auth_cookies, REFRESH_COOKIE_NAME, validate_account, normalize_account, build_user_payload
from backend.services.points_service import PointsService
from backend.services.invite_service import InviteService
from backend.config import get_limit_config, is_register_enabled

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)
_login_attempts = defaultdict(list)
_register_attempts = defaultdict(list)
_login_rate_hits = 0
_register_rate_hits = 0
_ALLOWED_EMAIL_DOMAINS = {"qq.com", "vip.qq.com", "foxmail.com", "163.com", "126.com", "yeah.net", "188.com", "sina.com", "sohu.com", "139.com", "189.cn", "21cn.com", "aliyun.com", "gmail.com", "outlook.com", "hotmail.com"}


def _check_login_rate(ip: str):
    global _login_rate_hits
    now = time.time()
    limit_cfg = get_limit_config()
    limit = limit_cfg["login_rate_limit_per_minute_per_ip"]
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < 60]
    if len(_login_attempts[ip]) >= limit:
        _login_rate_hits += 1
        raise HTTPException(status_code=429, detail="登录尝试过于频繁，请稍后再试")
    _login_attempts[ip].append(now)


def _check_register_rate(ip: str):
    global _register_rate_hits
    now = time.time()
    limit_cfg = get_limit_config()
    limit = limit_cfg["register_rate_limit_per_minute_per_ip"]
    _register_attempts[ip] = [t for t in _register_attempts[ip] if now - t < 60]
    if len(_register_attempts[ip]) >= limit:
        _register_rate_hits += 1
        raise HTTPException(status_code=429, detail="注册过于频繁，请稍后再试")
    _register_attempts[ip].append(now)


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


class RegisterRequest(BaseModel):
    account: str = Field(..., min_length=5, max_length=16)
    password: str = Field(..., min_length=6, max_length=50)
    nickname: str = None
    email: str = Field(..., min_length=5, max_length=255)
    code: str = Field(..., min_length=6, max_length=6)
    invite_code: str = Field("", max_length=32)


class SendCodeRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)


class LoginRequest(BaseModel):
    account: str
    password: str


def _issue_session(response: Response, user_id: int, username: str, is_admin: bool, ip: str, user_agent: str):
    access_token = create_token(user_id, username, is_admin)
    refresh_token = create_refresh_token(user_id, ip=ip, user_agent=user_agent)
    set_auth_cookies(response, access_token, refresh_token)
    return access_token


@router.post("/send-code")
async def send_code(req: SendCodeRequest, request: Request):
    if not is_register_enabled():
        raise HTTPException(status_code=403, detail="当前已关闭注册")
    ip = get_client_ip(request)
    email = _normalize_and_validate_email(req.email)
    from backend.services.email_service import create_and_send_code
    await create_and_send_code(email, ip)
    return {"status": "ok", "message": "验证码已发送"}


@router.post("/register")
async def register(req: RegisterRequest, request: Request, response: Response):
    if not is_register_enabled():
        raise HTTPException(status_code=403, detail="当前已关闭注册")
    account = validate_account(req.account)
    nickname = (req.nickname or "").strip() or account
    email = _normalize_and_validate_email(req.email)
    ip = get_client_ip(request)
    _check_register_rate(ip)
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
    _check_login_rate(ip)
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
