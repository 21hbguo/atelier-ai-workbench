import os
import hashlib
from datetime import datetime
from typing import List

from fastapi import APIRouter, UploadFile, File, HTTPException

from backend.services.image_hosting import ImageHostingService
from backend.services.image_mapping import ImageUrlMapping
from backend.models.schemas import UploadResponse
from backend.config import UPLOAD_DIR

router = APIRouter(prefix="/api", tags=["upload"])


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
    existing_url = ImageUrlMapping.get_url_by_hash(content_hash)
    if existing_url:
        return UploadResponse(url=existing_url, is_duplicate=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{file.filename}"
    save_path = UPLOAD_DIR / filename
    with open(save_path, "wb") as f:
        f.write(content)

    url = await ImageHostingService.upload_image(str(save_path))
    ImageUrlMapping.save_url(str(save_path), url, content_hash)
    return UploadResponse(url=url, is_duplicate=False)


@router.post("/upload", response_model=UploadResponse)
async def upload_image(file: UploadFile = File(...)):
    try:
        return await _do_upload(file)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")


@router.post("/upload/batch", response_model=List[UploadResponse])
async def upload_images_batch(files: List[UploadFile] = File(...)):
    results = []
    for file in files:
        try:
            results.append(await _do_upload(file))
        except Exception:
            results.append(UploadResponse(url="", is_duplicate=False))
    return results
