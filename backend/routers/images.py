import os
import json
import hashlib
import logging
import time
from datetime import datetime, timedelta
from typing import Optional
from pydantic import BaseModel, Field

import httpx
from fastapi import APIRouter, HTTPException, Query, Response, Depends
from fastapi.responses import FileResponse

from backend.config import GENERATED_IMAGES_DIR, THUMBS_DIR, UPLOAD_DIR
from backend.database import get_db
from backend.services.task_manager import TaskManager
from backend.services.image_mapping import ImageUrlMapping
from backend.auth import get_current_user, require_admin
from backend.services.image_expiry import get_expiry_data, extend_images, RETENTION_DAYS, EXTEND_DAYS, get_extend_cost_per_image
from backend.services.points_service import PointsService
from backend.services.image_dimensions import get_image_dimensions

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["images"])
MAX_REMOTE_IMAGE_BYTES = int(os.getenv("MAX_REMOTE_IMAGE_BYTES", str(10 * 1024 * 1024)))


def get_image_metadata(filename: str) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT metadata FROM image_metadata WHERE filename = %s", (filename,)).fetchone()
        if row and row["metadata"]:
            if isinstance(row["metadata"], dict):
                return row["metadata"]
            try:
                return json.loads(row["metadata"])
            except (json.JSONDecodeError, TypeError):
                pass
    return {}


def _parse_metadata(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}


def _format_timestamp(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")


def _image_media_type(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    return {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}.get(ext, "application/octet-stream")


def _resolve_local_image_path(path: str) -> str:
    resolved = os.path.abspath(path)
    allowed = [str(UPLOAD_DIR.resolve()), str(GENERATED_IMAGES_DIR.resolve())]
    if not any(resolved == root or resolved.startswith(root + os.sep) for root in allowed):
        raise HTTPException(status_code=403, detail="不允许访问该路径")
    if not os.path.isfile(resolved):
        raise HTTPException(status_code=404, detail="本地文件不存在")
    return resolved


def _can_access_generated_image(filename: str, user: dict) -> bool:
    if user.get("is_admin"):
        return True
    with get_db() as conn:
        row = conn.execute("SELECT user_id FROM image_metadata WHERE filename = %s", (filename,)).fetchone()
        if row and row["user_id"] == user["user_id"]:
            return True
        shared = conn.execute("SELECT id FROM square_images WHERE filename = %s", (filename,)).fetchone()
        return bool(shared)


def _assert_generated_image_access(filename: str, user: dict):
    if not _can_access_generated_image(filename, user):
        raise HTTPException(status_code=403, detail="无权访问此图片")


@router.get("/images")
async def list_images(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), user_id: int = Query(None), user=Depends(get_current_user)):
    started = time.perf_counter()
    try:
        if not GENERATED_IMAGES_DIR.exists():
            return {"images": [], "total": 0, "page": page, "page_size": page_size}
        is_admin = bool(user.get("is_admin"))
        if is_admin and user_id:
            filter_uid = user_id
        elif is_admin:
            filter_uid = None
        else:
            filter_uid = user["user_id"]
        where = []
        params = []
        if filter_uid is not None:
            where.append("m.user_id = %s")
            params.append(filter_uid)
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        offset = (page - 1) * page_size
        with get_db() as conn:
            total_row = conn.execute(f"SELECT COUNT(*) AS cnt FROM image_metadata m {where_sql}", params).fetchone()
            total = total_row["cnt"] if total_row else 0
            rows = conn.execute(
                f"""
                SELECT m.filename,m.metadata,m.user_id,m.created_at,u.username,u.nickname,s.id AS square_image_id
                ,m.expires_at,m.is_permanent
                FROM image_metadata m
                LEFT JOIN users u ON m.user_id=u.id
                LEFT JOIN square_images s ON s.filename=m.filename AND s.user_id=m.user_id
                {where_sql}
                ORDER BY m.created_at DESC NULLS LAST
                LIMIT %s OFFSET %s
                """,
                params + [page_size, offset],
            ).fetchall()
        images = []
        for row in rows:
            filename = row["filename"]
            f = GENERATED_IMAGES_DIR / filename
            if not f.exists() or not f.is_file() or f.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
                continue
            stat = f.stat()
            created_at = row["created_at"] or _format_timestamp(stat.st_mtime)
            metadata = _parse_metadata(row["metadata"])
            account = (row["nickname"] or row["username"] or "") if is_admin else ""
            expiry = get_expiry_data({"created_at": row["created_at"], "expires_at": row["expires_at"], "is_permanent": row["is_permanent"]})
            width,height=get_image_dimensions(str(f))
            images.append({
                "filename": filename,
                "path": str(f) if is_admin else "",
                "url": f"/api/images/file/{filename}",
                "created_at": created_at,
                "metadata": metadata,
                "username": account,
                "account": account,
                "square_image_id": row["square_image_id"],
                "expires_at": expiry["expires_at"],
                "is_permanent": expiry["is_permanent"],
                "days_left": expiry["days_left"],
                "expired": expiry["expired"],
                "width": width,
                "height": height,
            })
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        if elapsed_ms > 1200:
            logger.warning(f"images.list slow elapsed_ms={elapsed_ms} page={page} page_size={page_size} total={total} returned={len(images)} uid={filter_uid}")
        else:
            logger.info(f"images.list elapsed_ms={elapsed_ms} page={page} page_size={page_size} total={total} returned={len(images)} uid={filter_uid}")
        return {"images": images, "total": total, "page": page, "page_size": page_size}

    except Exception as e:
        logger.exception("获取图片列表失败")
        raise HTTPException(status_code=500, detail="获取图片列表失败")


@router.get("/images/proxy-thumb")
async def proxy_thumbnail(url: str = Query(...), size: int = Query(400, ge=50, le=1000), user=Depends(get_current_user)):
    from urllib.parse import urlparse
    import socket
    import ipaddress
    from backend.config import IMAGE_HOSTING_BASE_URL

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="仅支持 http/https 协议")

    allowed_host = urlparse(IMAGE_HOSTING_BASE_URL()).hostname
    if parsed.hostname != allowed_host:
        raise HTTPException(status_code=403, detail="不允许的 URL 域名")

    try:
        ip = socket.getaddrinfo(parsed.hostname, None)[0][4][0]
        addr = ipaddress.ip_address(ip)
        if addr.is_private or addr.is_loopback or addr.is_link_local:
            raise HTTPException(status_code=403, detail="不允许访问内部地址")
    except (socket.gaierror, ValueError):
        raise HTTPException(status_code=400, detail="无法解析域名")

    url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
    thumb_name = f"{size}_{url_hash}.webp"
    thumb_path = THUMBS_DIR / thumb_name

    if thumb_path.exists():
        return FileResponse(str(thumb_path), media_type="image/webp")

    from backend.config import IMAGE_HOSTING_REFERER
    headers = {"Referer": IMAGE_HOSTING_REFERER(), "User-Agent": "Mozilla/5.0"}

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code != 200:
            raise Exception(f"下载失败: {resp.status_code}")
        if int(resp.headers.get("content-length") or 0) > MAX_REMOTE_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="远程图片过大")
        content_type = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        if content_type and not content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="远程资源不是图片")
        if len(resp.content) > MAX_REMOTE_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="远程图片过大")

        from PIL import Image
        import io
        img = Image.open(io.BytesIO(resp.content))
        img.thumbnail((size, size), Image.LANCZOS)
        if img.mode == "P":
            img = img.convert("RGBA" if "transparency" in img.info else "RGB")
        img.save(thumb_path, "WEBP", quality=80)
        return FileResponse(str(thumb_path), media_type="image/webp")
    except ImportError:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            resp = await client.get(url)
        if len(resp.content) > MAX_REMOTE_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="远程图片过大")
        return Response(content=resp.content, media_type=resp.headers.get("content-type", "image/jpeg"))
    except Exception as e:
        raise HTTPException(status_code=502, detail="缩略图生成失败")


@router.get("/images/local-thumb")
async def local_thumbnail(path: str = Query(...), size: int = Query(400, ge=50, le=1000), admin=Depends(require_admin)):
    import os
    import hashlib

    abs_path = _resolve_local_image_path(path)

    url_hash = hashlib.md5(abs_path.encode()).hexdigest()[:12]
    ext = os.path.splitext(abs_path)[1].lower().lstrip('.')
    if ext not in {"png", "jpg", "jpeg", "webp", "gif"}:
        raise HTTPException(status_code=400, detail="不支持的图片格式")
    thumb_name = f"{size}_{url_hash}.webp"
    thumb_path = THUMBS_DIR / thumb_name

    if thumb_path.exists():
        return FileResponse(str(thumb_path), media_type="image/webp")

    try:
        from PIL import Image
        img = Image.open(abs_path)
        img.thumbnail((size, size), Image.LANCZOS)
        if img.mode == "P":
            img = img.convert("RGBA" if "transparency" in img.info else "RGB")
        img.save(thumb_path, "WEBP", quality=80)
        return FileResponse(str(thumb_path), media_type="image/webp")
    except ImportError:
        return FileResponse(abs_path, media_type=_image_media_type(abs_path))


@router.get("/images/file/{filename}")
async def serve_image(filename: str, user=Depends(get_current_user)):
    image_path = GENERATED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")
    _assert_generated_image_access(filename, user)
    return FileResponse(str(image_path), media_type=_image_media_type(str(image_path)))


@router.get("/images/thumb/{filename}")
async def serve_thumbnail(filename: str, size: int = Query(400, ge=50, le=1000), user=Depends(get_current_user)):
    _assert_generated_image_access(filename, user)
    import os
    thumb_name = f"{size}_{os.path.splitext(filename)[0]}.webp"
    thumb_path = THUMBS_DIR / thumb_name
    if thumb_path.exists():
        return FileResponse(str(thumb_path), media_type="image/webp")

    image_path = GENERATED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")

    try:
        from PIL import Image
        img = Image.open(image_path)
        img.thumbnail((size, size), Image.LANCZOS)
        if img.mode == "P":
            img = img.convert("RGBA" if "transparency" in img.info else "RGB")
        img.save(thumb_path, "WEBP", quality=80)
        return FileResponse(str(thumb_path), media_type="image/webp")
    except ImportError:
        return FileResponse(str(image_path), media_type="image/png")


@router.get("/images/{filename}")
async def get_image_info(filename: str, user=Depends(get_current_user)):
    image_path = GENERATED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")
    _assert_generated_image_access(filename, user)

    stat = image_path.stat()
    with get_db() as conn:
        row = conn.execute("SELECT metadata,created_at,expires_at,is_permanent FROM image_metadata WHERE filename = %s", (filename,)).fetchone()
    metadata = _parse_metadata(row["metadata"] if row else {})
    expiry = get_expiry_data({"created_at": (row["created_at"] if row else None) or datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"), "expires_at": row["expires_at"] if row else None, "is_permanent": row["is_permanent"] if row else False})
    return {
        "filename": filename,
        "path": str(image_path) if user.get("is_admin") else "",
        "url": f"/api/images/file/{filename}",
        "created_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        "metadata": metadata,
        "expires_at": expiry["expires_at"],
        "is_permanent": expiry["is_permanent"],
        "days_left": expiry["days_left"],
        "expired": expiry["expired"],
    }


@router.delete("/images/{filename}")
async def delete_image(filename: str, user=Depends(get_current_user)):
    image_path = GENERATED_IMAGES_DIR / filename

    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")

    if not user.get("is_admin"):
        with get_db() as conn:
            row = conn.execute("SELECT user_id FROM image_metadata WHERE filename = %s", (filename,)).fetchone()
            if row and row["user_id"] != user["user_id"]:
                raise HTTPException(status_code=403, detail="无权删除此图片")

    try:
        image_path.unlink()
        with get_db() as conn:
            conn.execute("DELETE FROM image_metadata WHERE filename = %s", (filename,))
        TaskManager.remove_image_from_tasks(str(image_path))
        return {"filename": filename, "message": "图片已删除"}
    except Exception as e:
        logger.exception("删除图片失败")
        raise HTTPException(status_code=500, detail="删除图片失败")

@router.post("/images/{filename}/delete")
async def delete_image_post(filename: str, user=Depends(get_current_user)):
    return await delete_image(filename, user)


@router.post("/images/{filename}/metadata")
async def save_image_metadata_route(filename: str, metadata: dict, user=Depends(get_current_user)):
    image_path = GENERATED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")

    try:
        with get_db() as conn:
            row = conn.execute("SELECT expires_at,is_permanent FROM image_metadata WHERE filename = %s", (filename,)).fetchone()
            expires_at = row["expires_at"] if row else None
            is_permanent = row["is_permanent"] if row else False
            conn.execute(
                "INSERT INTO image_metadata (filename, metadata, created_at, user_id, expires_at, is_permanent) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT(filename) DO UPDATE SET metadata=EXCLUDED.metadata, created_at=EXCLUDED.created_at, user_id=EXCLUDED.user_id, expires_at=COALESCE(image_metadata.expires_at, EXCLUDED.expires_at), is_permanent=COALESCE(image_metadata.is_permanent, EXCLUDED.is_permanent)",
                (filename, json.dumps(metadata, ensure_ascii=False), datetime.now().strftime("%Y-%m-%d %H:%M:%S"), user["user_id"], expires_at or ((datetime.now() + timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")), bool(is_permanent)),
            )
        return {"filename": filename, "message": "元数据已保存"}
    except Exception as e:
        logger.exception("保存元数据失败")
        raise HTTPException(status_code=500, detail="保存元数据失败")


@router.get("/hosting")
async def list_hosting(admin=Depends(require_admin)):
    mapping = ImageUrlMapping.load_mapping()
    items = []
    for local_path, url in mapping.items():
        filename = os.path.basename(local_path)
        items.append({
            "local_path": local_path,
            "url": url,
            "filename": filename,
            "exists": os.path.exists(local_path),
        })
    items.reverse()
    return {"items": items, "total": len(items)}


@router.delete("/hosting")
async def delete_hosting(body: dict, admin=Depends(require_admin)):
    urls = body.get("urls", [])
    if not urls:
        raise HTTPException(status_code=400, detail="未提供要删除的 URL")
    count = ImageUrlMapping.delete_urls(urls)
    return {"deleted": count}

class ExtendImagesRequest(BaseModel):
    filenames: list[str] = Field(default_factory=list, max_length=300)

@router.post("/images/extend")
async def extend_image_expiry(req: ExtendImagesRequest, user=Depends(get_current_user)):
    try:
        result = extend_images(req.filenames, user["user_id"])
    except ValueError as e:
        if str(e) == "积分不足":
            raise HTTPException(status_code=402, detail="积分不足")
        raise HTTPException(status_code=400, detail=str(e))
    points = result.get("points")
    if points is None:
        points = PointsService.get_balance(user["user_id"])
    return {"message": "操作完成", "success_count": len(result["success"]), "skipped_count": len(result["skipped"]), "failed_count": len(result["failed"]), "total_cost": result["total_cost"], "points": points, "retention_days": RETENTION_DAYS, "extend_days": EXTEND_DAYS, "extend_cost_per_image": get_extend_cost_per_image(), **result}
