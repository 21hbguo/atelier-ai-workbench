import os
import re
import asyncio
import hashlib
import logging
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException

from backend.services.image_hosting import ImageHostingService
from backend.services.image_mapping import ImageUrlMapping
from backend.models.schemas import UploadResponse
from backend.config import UPLOAD_DIR
from backend.auth import get_current_user

logger = logging.getLogger(__name__)


def _safe_filename(name: str) -> str:
    name = os.path.basename(name)
    name = re.sub(r'[^\w.\-]', '_', name)
    name = name[:100]
    return name or "upload"

router = APIRouter(prefix="/api", tags=["upload"])


def _write_file(path, content):
    with open(path, "wb") as f:
        f.write(content)


def _file_hash(content: bytes) -> str:
    return hashlib.md5(content).hexdigest()


async def _do_upload(file: UploadFile) -> UploadResponse:
    file_ext = os.path.splitext(file.filename)[1].lower().lstrip(".")
    if file_ext not in {"png", "jpg", "jpeg", "webp"}:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {file_ext}")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小超过10MB限制")

    content_hash = _file_hash(content)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{_safe_filename(file.filename)}"
    save_path = UPLOAD_DIR / filename
    await asyncio.to_thread(_write_file, save_path, content)

    url, delete_token = await ImageHostingService.upload_image(str(save_path))
    existing_url = ImageUrlMapping.save_url(str(save_path), url, content_hash, delete_token or "")
    if existing_url:
        return UploadResponse(url=existing_url, is_duplicate=True)
    return UploadResponse(url=url, is_duplicate=False)


@router.post("/upload", response_model=UploadResponse)
async def upload_image(file: UploadFile = File(...), user=Depends(get_current_user)):
    try:
        return await _do_upload(file)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("上传失败")
        raise HTTPException(status_code=500, detail="上传失败")


@router.post("/upload/batch", response_model=List[UploadResponse])
async def upload_images_batch(files: List[UploadFile] = File(...), user=Depends(get_current_user)):
    results = []
    for file in files:
        try:
            results.append(await _do_upload(file))
        except Exception:
            results.append(UploadResponse(url="", is_duplicate=False))
    return results


@router.post("/upload/local", response_model=UploadResponse)
async def upload_local(file: UploadFile = File(...), user=Depends(get_current_user)):
    """本地上传，不使用图床（用于支付凭证等）"""
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小超过10MB限制")

    file_ext = os.path.splitext(file.filename)[1].lower().lstrip(".")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{_safe_filename(file.filename)}"
    save_path = UPLOAD_DIR / filename
    await asyncio.to_thread(_write_file, save_path, content)

    url = f"/uploads/{filename}"
    return UploadResponse(url=url, is_duplicate=False)
