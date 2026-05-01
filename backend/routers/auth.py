from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from backend.database import get_db
from backend.auth import hash_password, verify_password, create_token, get_current_user, update_user_ip, get_client_ip

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=20)
    password: str = Field(..., min_length=6, max_length=50)
    nickname: str = None


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/register")
async def register(req: RegisterRequest, request: Request):
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (req.username,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="用户名已存在")

        password_hash = hash_password(req.password)
        cursor = conn.execute(
            "INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)",
            (req.username, password_hash, req.nickname or req.username),
        )
        user_id = cursor.lastrowid
        update_user_ip(user_id, get_client_ip(request), conn=conn)
        token = create_token(user_id, req.username)
        return {"token": token, "user": {"id": user_id, "username": req.username, "nickname": req.nickname or req.username, "is_admin": False}}


@router.post("/login")
async def login(req: LoginRequest, request: Request):
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = ?", (req.username,)).fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="用户名或密码错误")

        update_user_ip(user["id"], get_client_ip(request), conn=conn)
        token = create_token(user["id"], user["username"], bool(user["is_admin"]))
        return {"token": token, "user": {"id": user["id"], "username": user["username"], "nickname": user["nickname"], "is_admin": bool(user["is_admin"])}}


@router.get("/me")
async def get_me(user=Depends(get_current_user)):
    with get_db() as conn:
        u = conn.execute("SELECT id, username, nickname, avatar, is_admin, created_at FROM users WHERE id = ?", (user["user_id"],)).fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="用户不存在")
        return dict(u)
