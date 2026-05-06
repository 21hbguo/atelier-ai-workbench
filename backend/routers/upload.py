import os
import re
import io
import asyncio
import hashlib
import logging
import secrets
from typing import List
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from backend.services.image_hosting import ImageHostingService
from backend.services.github_image_hosting import GithubImageHostingService
from backend.services.image_mapping import ImageUrlMapping
from backend.config import UPLOAD_DIR, MAX_FILE_SIZE, is_github_hosting_enabled
from backend.services.upload_file_service import UploadFileService
from backend.services.image_expiry import enforce_github_repo_size_limit
from backend.models.schemas import UploadResponse
from backend.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["upload"])
_IMAGE_MIME = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}
_LOCAL_MIME = {**_IMAGE_MIME, "pdf": "application/pdf"}
_UPLOAD_IMAGE_EXTS = set(_IMAGE_MIME)
_UPLOAD_LOCAL_EXTS = set(_LOCAL_MIME)


def _safe_filename(name: str) -> str:
    name = os.path.basename(name or "")
    name = re.sub(r"[^\w.\-]", "_", name)
    return name[:100] or "upload"


def _write_file(path, content):
    with open(path, "wb") as f:
        f.write(content)


def _file_hash(content: bytes) -> str:
    return hashlib.md5(content).hexdigest()


def _detect_ext(content: bytes) -> str:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if content[:3] == b"\xff\xd8\xff":
        return "jpg"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "webp"
    if content.startswith(b"%PDF-"):
        return "pdf"
    return ""


def _verify_image(content: bytes):
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.verify()
        with Image.open(io.BytesIO(content)) as img:
            width, height = img.size
        if width <= 0 or height <= 0 or width * height > 4096 * 4096:
            raise HTTPException(status_code=400, detail="图片尺寸不合法")
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise HTTPException(status_code=400, detail="图片内容无效")


def _validate_upload(file: UploadFile, content: bytes, allowed_exts: set, mime_map: dict):
    if not content:
        raise HTTPException(status_code=400, detail="文件内容为空")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"文件大小超过{MAX_FILE_SIZE // 1024 // 1024}MB限制")
    ext = os.path.splitext(file.filename or "")[1].lower().lstrip(".")
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {ext or 'unknown'}")
    detected = _detect_ext(content)
    if not detected or detected not in allowed_exts:
        raise HTTPException(status_code=400, detail="文件头校验失败")
    if ext == "jpeg":
        ext = "jpg"
    if detected == "jpeg":
        detected = "jpg"
    if detected != ext:
        raise HTTPException(status_code=400, detail="文件扩展名与内容不匹配")
    expected_mime = mime_map[ext]
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type and content_type != expected_mime:
        raise HTTPException(status_code=400, detail="文件类型不合法")
    if ext != "pdf":
        _verify_image(content)
    return ext, expected_mime


async def _do_upload(file: UploadFile) -> UploadResponse:
    content = await file.read()
    ext, _ = _validate_upload(file, content, _UPLOAD_IMAGE_EXTS, _IMAGE_MIME)
    content_hash = _file_hash(content)
    filename = f"{secrets.token_hex(16)}.{ext}"
    save_path = UPLOAD_DIR / filename
    await asyncio.to_thread(_write_file, save_path, content)
    logger.info(f"上传文件: {filename}, github_hosting={is_github_hosting_enabled()}")
    if is_github_hosting_enabled():
        size_result = await enforce_github_repo_size_limit()
        if size_result.get("hard_over_limit"):
            logger.warning(f"github hosting repo still over hard limit after cleanup: {size_result}")
        url, delete_token = await GithubImageHostingService.upload_image(str(save_path))
    else:
        url, delete_token = await ImageHostingService.upload_image(str(save_path))
    logger.info(f"上传结果: url={url}")
    existing_url = ImageUrlMapping.save_url(str(save_path), url, content_hash, delete_token or "")
    if existing_url:
        return UploadResponse(url=existing_url, is_duplicate=True, storage_name=filename)
    return UploadResponse(url=url, is_duplicate=False, storage_name=filename)


@router.post("/upload", response_model=UploadResponse)
async def upload_image(file: UploadFile = File(...), user=Depends(get_current_user)):
    try:
        return await _do_upload(file)
    except HTTPException:
        raise
    except Exception:
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
    content = await file.read()
    ext, content_type = _validate_upload(file, content, _UPLOAD_LOCAL_EXTS, _LOCAL_MIME)
    file_key = secrets.token_urlsafe(24)
    filename = f"{secrets.token_hex(16)}.{ext}"
    save_path = UPLOAD_DIR / filename
    await asyncio.to_thread(_write_file, save_path, content)
    UploadFileService.create(file_key=file_key, owner_id=user["user_id"], original_name=_safe_filename(file.filename), storage_name=filename, content_type=content_type, category="payment_proof")
    return UploadResponse(url=f"/api/uploads/{file_key}", is_duplicate=False, storage_name=filename)


@router.get("/uploads/{file_key}")
async def download_local_upload(file_key: str, user=Depends(get_current_user)):
    item = UploadFileService.get_by_key(file_key)
    if not item:
        raise HTTPException(status_code=404, detail="文件不存在")
    if not user.get("is_admin") and item["owner_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="无权访问此文件")
    path = UPLOAD_DIR / item["storage_name"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(str(path), media_type=item["content_type"], filename=item["original_name"])
