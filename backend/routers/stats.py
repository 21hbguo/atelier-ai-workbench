import os
import time
from fastapi import APIRouter, Depends

from backend.services.stats_service import StatsService
from backend.auth import get_current_user
from backend.database import get_db

router = APIRouter(prefix="/api", tags=["stats"])

_server_start_time = time.time()


@router.get("/stats")
async def get_stats(user=Depends(get_current_user)):
    return StatsService.get_stats()


@router.get("/stats/system")
async def get_system_stats(user=Depends(get_current_user)):
    from backend.routers.auth import get_rate_limit_stats
    from backend.config import DATA_DIR

    # 存储用量
    db_path = DATA_DIR / "app.db"
    db_size = db_path.stat().st_size if db_path.exists() else 0

    images_dir = DATA_DIR / "images"
    image_count = len(list(images_dir.iterdir())) if images_dir.exists() else 0
    image_size = sum(f.stat().st_size for f in images_dir.iterdir() if f.is_file()) if images_dir.exists() else 0

    uploads_dir = DATA_DIR / "uploads"
    upload_count = len(list(uploads_dir.iterdir())) if uploads_dir.exists() else 0
    upload_size = sum(f.stat().st_size for f in uploads_dir.iterdir() if f.is_file()) if uploads_dir.exists() else 0

    # 处理中的任务数
    with get_db() as conn:
        processing = conn.execute("SELECT COUNT(*) as cnt FROM tasks WHERE status IN ('processing', 'queued')").fetchone()["cnt"]

    # API 配置状态
    from backend.config import get_config
    cfg = get_config()
    api_configured = bool(cfg.get("api_key"))

    return {
        **get_rate_limit_stats(),
        "uptime_seconds": int(time.time() - _server_start_time),
        "db_size": db_size,
        "image_count_files": image_count,
        "image_size": image_size,
        "upload_count_files": upload_count,
        "upload_size": upload_size,
        "processing_tasks": processing,
        "api_configured": api_configured,
        "limits": {
            "login_rate": "5次/分钟/IP",
            "register_rate": "3次/分钟/IP",
            "generate_concurrent": "10个/用户",
            "file_size": "10MB",
            "prompt_length": "2500字符",
            "image_upload_ext": "png,jpg,jpeg,webp",
        },
    }


@router.get("/stats/users")
async def get_user_stats(user=Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT u.id, u.username, u.nickname, u.is_admin, u.is_frozen, u.last_active, u.last_ip,
                   COUNT(CASE WHEN ur.status = 'success' THEN 1 END) as success_count,
                   COUNT(CASE WHEN ur.status = 'failed' THEN 1 END) as failed_count,
                   COUNT(CASE WHEN ur.status = 'processing' THEN 1 END) as processing_count
            FROM users u
            LEFT JOIN user_requests ur ON u.id = ur.user_id
            GROUP BY u.id
            ORDER BY u.last_active DESC
            """
        ).fetchall()
        return {"users": [dict(r) for r in rows]}
