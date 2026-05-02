import os
import json
import hashlib
import logging
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Response, Depends
from fastapi.responses import FileResponse

from backend.config import GENERATED_IMAGES_DIR, THUMBS_DIR
from backend.database import get_db
from backend.services.task_manager import TaskManager
from backend.services.image_mapping import ImageUrlMapping
from backend.auth import get_current_user, require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["images"])


def get_image_metadata(filename: str) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT metadata FROM image_metadata WHERE filename = ?", (filename,)).fetchone()
        if row and row["metadata"]:
            try:
                return json.loads(row["metadata"])
            except (json.JSONDecodeError, TypeError):
                pass
    return {}


@router.get("/images")
async def list_images(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), user_id: int = Query(None), user=Depends(get_current_user)):
    try:
        if not GENERATED_IMAGES_DIR.exists():
            return {"images": [], "total": 0, "page": page, "page_size": page_size}

        is_admin = user.get("is_admin")
        if is_admin and user_id:
            filter_uid = user_id
        elif is_admin:
            filter_uid = None
        else:
            filter_uid = user["user_id"]

        if filter_uid is not None:
            with get_db() as conn:
                rows = conn.execute("SELECT filename FROM image_metadata WHERE user_id = ?", (filter_uid,)).fetchall()
                allowed_files = {r["filename"] for r in rows}
        else:
            allowed_files = None

        image_files = []
        user_map = {}
        if is_admin:
            with get_db() as conn:
                rows = conn.execute("SELECT id, username, nickname FROM users").fetchall()
                user_map = {r["id"]: (r["nickname"] or r["username"]) for r in rows}

        for f in GENERATED_IMAGES_DIR.iterdir():
            if f.is_file() and f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
                if allowed_files is not None and f.name not in allowed_files:
                    continue
                stat = f.stat()
                metadata = get_image_metadata(f.name)
                username = ""
                if is_admin:
                    uid = metadata.get("user_id")
                    username = user_map.get(uid, "") if uid else ""
                image_files.append({
                    "filename": f.name,
                    "path": str(f),
                    "url": f"/api/images/file/{f.name}",
                    "created_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                    "metadata": metadata,
                    "username": username,
                })

        image_files.sort(key=lambda x: x["created_at"], reverse=True)

        total = len(image_files)
        start = (page - 1) * page_size
        end = start + page_size
        paginated = image_files[start:end]

        return {"images": paginated, "total": total, "page": page, "page_size": page_size}

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
    ext = url.split('.')[-1].split('?')[0][:4]
    thumb_name = f"{size}_{url_hash}.{ext}"
    thumb_path = THUMBS_DIR / thumb_name

    if thumb_path.exists():
        return FileResponse(str(thumb_path), media_type="image/jpeg")

    from backend.config import IMAGE_HOSTING_REFERER
    headers = {"Referer": IMAGE_HOSTING_REFERER(), "User-Agent": "Mozilla/5.0"}

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code != 200:
            raise Exception(f"下载失败: {resp.status_code}")

        from PIL import Image
        import io
        img = Image.open(io.BytesIO(resp.content))
        img.thumbnail((size, size), Image.LANCZOS)
        if img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        img.save(thumb_path, "JPEG", quality=80)
        return FileResponse(str(thumb_path), media_type="image/jpeg")
    except ImportError:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            resp = await client.get(url)
        return Response(content=resp.content, media_type=resp.headers.get("content-type", "image/jpeg"))
    except Exception as e:
        raise HTTPException(status_code=502, detail="缩略图生成失败")


@router.get("/images/file/{filename}")
async def serve_image(filename: str):
    image_path = GENERATED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")
    return FileResponse(str(image_path), media_type="image/png")


@router.get("/images/thumb/{filename}")
async def serve_thumbnail(filename: str, size: int = Query(400, ge=50, le=1000)):
    thumb_path = THUMBS_DIR / f"{size}_{filename}"
    if thumb_path.exists():
        return FileResponse(str(thumb_path), media_type="image/jpeg")

    image_path = GENERATED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")

    try:
        from PIL import Image
        img = Image.open(image_path)
        img.thumbnail((size, size), Image.LANCZOS)
        if img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        img.save(thumb_path, "JPEG", quality=80)
        return FileResponse(str(thumb_path), media_type="image/jpeg")
    except ImportError:
        return FileResponse(str(image_path), media_type="image/png")


@router.get("/images/{filename}")
async def get_image_info(filename: str):
    image_path = GENERATED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")

    stat = image_path.stat()
    metadata = get_image_metadata(filename)

    return {
        "filename": filename,
        "path": str(image_path),
        "url": f"/api/images/file/{filename}",
        "created_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        "metadata": metadata,
    }


@router.delete("/images/{filename}")
async def delete_image(filename: str, user=Depends(get_current_user)):
    image_path = GENERATED_IMAGES_DIR / filename

    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")

    if not user.get("is_admin"):
        with get_db() as conn:
            row = conn.execute("SELECT user_id FROM image_metadata WHERE filename = ?", (filename,)).fetchone()
            if row and row["user_id"] != user["user_id"]:
                raise HTTPException(status_code=403, detail="无权删除此图片")

    try:
        image_path.unlink()
        with get_db() as conn:
            conn.execute("DELETE FROM image_metadata WHERE filename = ?", (filename,))
        TaskManager.remove_image_from_tasks(str(image_path))
        return {"filename": filename, "message": "图片已删除"}
    except Exception as e:
        logger.exception("删除图片失败")
        raise HTTPException(status_code=500, detail="删除图片失败")


@router.post("/images/{filename}/metadata")
async def save_image_metadata_route(filename: str, metadata: dict, user=Depends(get_current_user)):
    image_path = GENERATED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")

    try:
        with get_db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO image_metadata (filename, metadata, created_at, user_id) VALUES (?, ?, ?, ?)",
                (filename, json.dumps(metadata, ensure_ascii=False), datetime.now().strftime("%Y-%m-%d %H:%M:%S"), user["user_id"]),
            )
        return {"filename": filename, "message": "元数据已保存"}
    except Exception as e:
        logger.exception("保存元数据失败")
        raise HTTPException(status_code=500, detail="保存元数据失败")


@router.get("/hosting")
async def list_hosting(user=Depends(get_current_user)):
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
