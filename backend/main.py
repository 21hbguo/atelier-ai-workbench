import os
import logging
import asyncio
import hashlib
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from backend.routers import generate, upload, tasks, images, prompts, stats, config, auth, square, admin, points, announcements, notifications, account, shares, favorites, prompt_optimize, vmq, chat, subscriptions, workspace, group_buys
from backend.services.image_gen import close_http_client
from backend.services.llm_client import LLMClient
from backend.services.classification_service import ClassificationService
from backend.services.content_audit_service import ContentAuditService
from backend.services.task_manager import TaskManager
from backend.services.image_expiry import expiry_cleanup_loop
from backend.services.chat_task_manager import CHAT_TASK_MANAGER
from backend.routers.chat import reconcile_chat_uploads, chat_upload_cleanup_loop, recover_interrupted_chat_messages

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.expiry_cleanup_task = asyncio.create_task(expiry_cleanup_loop(int(os.getenv("IMAGE_EXPIRY_CLEANUP_INTERVAL_SECONDS", "3600"))))
    await asyncio.to_thread(reconcile_chat_uploads)
    app.state.chat_upload_cleanup_task = asyncio.create_task(chat_upload_cleanup_loop(int(os.getenv("CHAT_UPLOAD_CLEANUP_INTERVAL_SECONDS", "3600"))))
    await TaskManager.recover_orphaned_tasks()
    ClassificationService.resume_processing_tasks()
    ContentAuditService.resume_processing_tasks()
    # 聊天任务制：服务重启后残留 streaming 消息标 failed + 按 req_id 幂等退款
    await asyncio.to_thread(recover_interrupted_chat_messages)
    yield
    # 先取消运行中的聊天生成任务（触发 stopped 分支：退款 + 标 stopped），再关 LLM/HTTP
    await CHAT_TASK_MANAGER.cancel_all()
    t = getattr(app.state, "expiry_cleanup_task", None)
    if t:
        t.cancel()
        try:
            await t
        except BaseException:
            pass
    t = getattr(app.state, "chat_upload_cleanup_task", None)
    if t:
        t.cancel()
        try:
            await t
        except BaseException:
            pass
    await close_http_client()
    await LLMClient.close()
    await ClassificationService.close()
    await ContentAuditService.close()


app = FastAPI(title="AI Image Generator", version="1.0.0", lifespan=lifespan)
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
ENABLE_HSTS = os.getenv("ENABLE_HSTS", "false").lower() in {"1", "true", "yes", "on"}

app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=True, allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type", "X-Requested-With"])


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(),microphone=(),geolocation=()"
        response.headers["Content-Security-Policy"] = "default-src 'self';img-src 'self' data: blob: https:;script-src 'self' https://challenges.cloudflare.com;style-src 'self' 'unsafe-inline';font-src 'self' data: https:;connect-src 'self' https: https://challenges.cloudflare.com;frame-src https://challenges.cloudflare.com;frame-ancestors 'none';base-uri 'self';form-action 'self'"
        if ENABLE_HSTS and request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if request.url.path.startswith("/api/uploads/"):
            response.headers["Cache-Control"] = "private, no-store"
        elif request.url.path.startswith("/api/images/"):
            response.headers["Cache-Control"] = "private, max-age=300"
        return response


app.add_middleware(SecurityHeadersMiddleware)
app.include_router(generate.router)
app.include_router(upload.router)
app.include_router(tasks.router)
app.include_router(images.router)
app.include_router(prompts.router)
app.include_router(stats.router)
app.include_router(config.router)
app.include_router(auth.router)
app.include_router(square.router)
app.include_router(admin.router)
app.include_router(points.router)
app.include_router(announcements.router)
app.include_router(notifications.router)
app.include_router(account.router)
app.include_router(shares.api_router)
app.include_router(shares.router)
app.include_router(favorites.router)
app.include_router(prompt_optimize.router)
app.include_router(vmq.router)
app.include_router(chat.router)
app.include_router(subscriptions.router)
app.include_router(subscriptions.admin_router)
app.include_router(group_buys.router)
app.include_router(workspace.router)


@app.get("/appPush")
async def app_push_compat(t: str, type: str, price: str, sign: str):
    from backend.routers.points import app_push_callback
    return await app_push_callback(t=t, type=type, price=price, sign=sign)


@app.get("/appHeart")
async def app_heart_compat(t: str, sign: str):
    from backend.config import get_config
    secret = get_config().get("vmq_notify_secret") or ""
    if not secret:
        return "fail"
    expected = hashlib.md5((t + secret).encode()).hexdigest()
    return "success" if sign == expected else "fail"


@app.get("/api/health")
async def health():
    now = datetime.now().astimezone()
    return {"status": "ok", "version": "1.0.0", "server_time": now.isoformat(), "timezone": now.tzname(), "tz_env": os.getenv("TZ", "")}
