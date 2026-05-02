import time
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, Field
from backend.database import get_db
from backend.auth import hash_password, verify_password, create_token, create_refresh_token, rotate_refresh_token, revoke_refresh_token, get_current_user, update_user_ip, get_client_ip, set_auth_cookies, clear_auth_cookies, REFRESH_COOKIE_NAME
from backend.services.points_service import PointsService

router = APIRouter(prefix="/api/auth", tags=["auth"])
_login_attempts = defaultdict(list)
_register_attempts = defaultdict(list)
_login_rate_hits = 0
_register_rate_hits = 0


def _check_login_rate(ip: str):
    global _login_rate_hits
    now = time.time()
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < 60]
    if len(_login_attempts[ip]) >= 5:
        _login_rate_hits += 1
        raise HTTPException(status_code=429, detail="登录尝试过于频繁，请稍后再试")
    _login_attempts[ip].append(now)


def _check_register_rate(ip: str):
    global _register_rate_hits
    now = time.time()
    _register_attempts[ip] = [t for t in _register_attempts[ip] if now - t < 60]
    if len(_register_attempts[ip]) >= 3:
        _register_rate_hits += 1
        raise HTTPException(status_code=429, detail="注册过于频繁，请稍后再试")
    _register_attempts[ip].append(now)


def get_rate_limit_stats():
    return {"login_rate_hits": _login_rate_hits, "register_rate_hits": _register_rate_hits, "login_active_ips": len([k for k, v in _login_attempts.items() if v and time.time() - v[-1] < 60]), "register_active_ips": len([k for k, v in _register_attempts.items() if v and time.time() - v[-1] < 60])}


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=20)
    password: str = Field(..., min_length=6, max_length=50)
    nickname: str = None


class LoginRequest(BaseModel):
    username: str
    password: str


def _issue_session(response: Response, user_id: int, username: str, is_admin: bool, ip: str, user_agent: str):
    access_token = create_token(user_id, username, is_admin)
    refresh_token = create_refresh_token(user_id, ip=ip, user_agent=user_agent)
    set_auth_cookies(response, access_token, refresh_token)


@router.post("/register")
async def register(req: RegisterRequest, request: Request, response: Response):
    ip = get_client_ip(request)
    _check_register_rate(ip)
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = %s", (req.username,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="用户名已存在")
        password_hash = await hash_password(req.password)
        cursor = conn.execute("INSERT INTO users (username, password_hash, nickname) VALUES (%s, %s, %s) RETURNING id", (req.username, password_hash, req.nickname or req.username))
        user_id = cursor.fetchone()["id"]
        update_user_ip(user_id, ip, conn=conn)
        PointsService.add_points(user_id, PointsService.REGISTER_BONUS, "register_bonus", "注册赠送")
    _issue_session(response, user_id, req.username, False, ip, request.headers.get("user-agent", ""))
    return {"user": {"id": user_id, "username": req.username, "nickname": req.nickname or req.username, "is_admin": False, "points": PointsService.REGISTER_BONUS}}


@router.post("/login")
async def login(req: LoginRequest, request: Request, response: Response):
    ip = get_client_ip(request)
    _check_login_rate(ip)
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = %s", (req.username,)).fetchone()
        if not user or not await verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        update_user_ip(user["id"], ip, conn=conn)
        conn.execute("UPDATE users SET last_active = %s WHERE id = %s", (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), user["id"]))
        payload = {"id": user["id"], "username": user["username"], "nickname": user["nickname"], "is_admin": bool(user["is_admin"]), "points": user["points"]}
    _issue_session(response, payload["id"], payload["username"], payload["is_admin"], ip, request.headers.get("user-agent", ""))
    return {"user": payload}


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    session = rotate_refresh_token(token, ip=get_client_ip(request), user_agent=request.headers.get("user-agent", ""))
    if not session:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="登录已失效")
    set_auth_cookies(response, session["access_token"], session["refresh_token"])
    return {"user": session["user"]}


@router.post("/logout")
async def logout(request: Request, response: Response):
    revoke_refresh_token(request.cookies.get(REFRESH_COOKIE_NAME))
    clear_auth_cookies(response)
    return {"status": "ok"}


@router.get("/me")
async def get_me(user=Depends(get_current_user)):
    with get_db() as conn:
        u = conn.execute("SELECT id, username, nickname, avatar, is_admin, points, created_at FROM users WHERE id = %s", (user["user_id"],)).fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="用户不存在")
        d = dict(u)
        d["is_admin"] = bool(d.get("is_admin"))
        return d
