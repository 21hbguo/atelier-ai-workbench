import os
import logging
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from backend.routers import generate, upload, tasks, images, prompts, stats, config, auth, square, admin, points, announcements, notifications, account, shares, favorites, prompt_optimize
from backend.services.image_gen import close_http_client
from backend.services.prompt_optimizer import PromptOptimizer
from backend.services.classification_service import ClassificationService
from backend.services.task_manager import TaskManager
from backend.services.image_expiry import expiry_cleanup_loop

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.expiry_cleanup_task = asyncio.create_task(expiry_cleanup_loop(int(os.getenv("IMAGE_EXPIRY_CLEANUP_INTERVAL_SECONDS", "3600"))))
    await TaskManager.recover_orphaned_tasks()
    yield
    t = getattr(app.state, "expiry_cleanup_task", None)
    if t:
        t.cancel()
        try:
            await t
        except BaseException:
            pass
    await close_http_client()
    await PromptOptimizer.close()
    await ClassificationService.close()


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
        response.headers["Content-Security-Policy"] = "default-src 'self';img-src 'self' data: blob: https:;script-src 'self';style-src 'self' 'unsafe-inline';font-src 'self' data: https:;connect-src 'self' https:;frame-ancestors 'none';base-uri 'self';form-action 'self'"
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


@app.get("/api/health")
async def health():
    now = datetime.now().astimezone()
    return {"status": "ok", "version": "1.0.0", "server_time": now.isoformat(), "timezone": now.tzname(), "tz_env": os.getenv("TZ", "")}
