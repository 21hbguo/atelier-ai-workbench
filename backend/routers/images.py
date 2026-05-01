import os
import json
import base64
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from backend.config import GENERATED_IMAGES_DIR

router = APIRouter(prefix="/api", tags=["images"])


def get_image_metadata(image_path: str) -> dict:
    meta_path = image_path + ".meta.json"
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


@router.get("/images")
async def list_images(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    try:
        if not GENERATED_IMAGES_DIR.exists():
            return {"images": [], "total": 0, "page": page, "page_size": page_size}

        image_files = []
        for f in GENERATED_IMAGES_DIR.iterdir():
            if f.is_file() and f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
                if not f.name.endswith(".meta.json"):
                    stat = f.stat()
                    metadata = get_image_metadata(str(f))
                    image_files.append({
                        "filename": f.name,
                        "path": str(f),
                        "url": f"/api/images/file/{f.name}",
                        "created_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                        "metadata": metadata,
                    })

        image_files.sort(key=lambda x: x["created_at"], reverse=True)

        total = len(image_files)
        start = (page - 1) * page_size
        end = start + page_size
        paginated = image_files[start:end]

        return {"images": paginated, "total": total, "page": page, "page_size": page_size}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取图片列表失败: {str(e)}")


@router.get("/images/{filename}")
async def get_image_info(filename: str):
    image_path = GENERATED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")

    stat = image_path.stat()
    metadata = get_image_metadata(str(image_path))

    return {
        "filename": filename,
        "path": str(image_path),
        "url": f"/api/images/file/{filename}",
        "created_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        "metadata": metadata,
    }


@router.get("/images/file/{filename}")
async def serve_image(filename: str):
    image_path = GENERATED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")
    return FileResponse(str(image_path), media_type="image/png")


@router.delete("/images/{filename}")
async def delete_image(filename: str):
    image_path = GENERATED_IMAGES_DIR / filename
    meta_path = str(image_path) + ".meta.json"

    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")

    try:
        image_path.unlink()
        if os.path.exists(meta_path):
            os.remove(meta_path)
        return {"filename": filename, "message": "图片已删除"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除图片失败: {str(e)}")


@router.post("/images/{filename}/metadata")
async def save_image_metadata(filename: str, metadata: dict):
    image_path = GENERATED_IMAGES_DIR / filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")

    meta_path = str(image_path) + ".meta.json"
    try:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        return {"filename": filename, "message": "元数据已保存"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存元数据失败: {str(e)}")
