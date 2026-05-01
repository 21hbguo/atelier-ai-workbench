import os
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from backend.routers import generate, upload, tasks, images, prompts, stats, config, auth, square, admin, points
from backend.config import GENERATED_IMAGES_DIR, UPLOAD_DIR

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

app = FastAPI(title="AI Image Generator", version="1.0.0")

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
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

app.mount("/generated_images", StaticFiles(directory=str(GENERATED_IMAGES_DIR)), name="generated_images")
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
