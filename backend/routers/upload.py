import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import List

from fastapi import APIRouter, UploadFile, File, HTTPException

from backend.services.image_hosting import ImageHostingService
from backend.services.image_mapping import ImageUrlMapping
from backend.models.schemas import UploadResponse
from backend.config import UPLOAD_DIR

router = APIRouter(prefix="/api", tags=["upload"])


@router.post("/upload", response_model=UploadResponse)
async def upload_image(file: UploadFile = File(...)):
    try:
        file_ext = os.path.splitext(file.filename)[1].lower().lstrip(".")
        if file_ext not in {"png", "jpg", "jpeg", "webp"}:
            raise HTTPException(status_code=400, detail=f"不支持的文件格式: {file_ext}")

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{file.filename}"
        save_path = UPLOAD_DIR / filename

        content = await file.read()
        file_size = len(content)
        if file_size > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="文件大小超过10MB限制")

        with open(save_path, "wb") as f:
            f.write(content)

        existing_url = ImageUrlMapping.get_url(str(save_path))
        if existing_url:
            return UploadResponse(url=existing_url, is_duplicate=True)

        try:
            url = await ImageHostingService.upload_image(str(save_path))
            ImageUrlMapping.save_url(str(save_path), url)
            return UploadResponse(url=url, is_duplicate=False)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"图床上传失败: {str(e)}")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")


@router.post("/upload/batch", response_model=List[UploadResponse])
async def upload_images_batch(files: List[UploadFile] = File(...)):
    results = []
    for file in files:
        try:
            file_ext = os.path.splitext(file.filename)[1].lower().lstrip(".")
            if file_ext not in {"png", "jpg", "jpeg", "webp"}:
                results.append(UploadResponse(url="", is_duplicate=False))
                continue

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{timestamp}_{file.filename}"
            save_path = UPLOAD_DIR / filename

            content = await file.read()
            if len(content) > 10 * 1024 * 1024:
                results.append(UploadResponse(url="", is_duplicate=False))
                continue

            with open(save_path, "wb") as f:
                f.write(content)

            existing_url = ImageUrlMapping.get_url(str(save_path))
            if existing_url:
                results.append(UploadResponse(url=existing_url, is_duplicate=True))
                continue

            url = await ImageHostingService.upload_image(str(save_path))
            ImageUrlMapping.save_url(str(save_path), url)
            results.append(UploadResponse(url=url, is_duplicate=False))
        except Exception:
            results.append(UploadResponse(url="", is_duplicate=False))

    return results
