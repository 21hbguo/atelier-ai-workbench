from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.routers import generate, upload, tasks, images, prompts, stats, config
from backend.config import GENERATED_IMAGES_DIR, UPLOAD_DIR

app = FastAPI(title="AI Image Generator", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(generate.router)
app.include_router(upload.router)
app.include_router(tasks.router)
app.include_router(images.router)
app.include_router(prompts.router)
app.include_router(stats.router)
app.include_router(config.router)

app.mount("/generated_images", StaticFiles(directory=str(GENERATED_IMAGES_DIR)), name="generated_images")
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
