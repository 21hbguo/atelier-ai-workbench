import os
import asyncio
import logging
import httpx
from typing import Optional

logger = logging.getLogger(__name__)

from backend.config import (
    IMAGE_HOSTING_UPLOAD_URL,
    IMAGE_HOSTING_BASE_URL,
    IMAGE_HOSTING_REFERER,
    MAX_FILE_SIZE,
    ALLOWED_EXTENSIONS,
)


def _read_file(path):
    with open(path, "rb") as f:
        return f.read()


class ImageHostingService:
    @classmethod
    async def upload_image(cls, image_path: str) -> tuple[Optional[str], Optional[str]]:
        """上传图片到图床，返回 (url, delete_token)"""
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"文件不存在: {image_path}")

        ext = os.path.splitext(image_path)[1].lower().lstrip(".")
        if ext not in ALLOWED_EXTENSIONS:
            raise ValueError(f"不支持的文件格式: {ext}，仅支持 {', '.join(ALLOWED_EXTENSIONS)}")

        file_size = os.path.getsize(image_path)
        if file_size > MAX_FILE_SIZE:
            raise ValueError(f"文件大小 {file_size / 1024 / 1024:.2f}MB 超过限制（{MAX_FILE_SIZE / 1024 / 1024:.0f}MB）")

        headers = {
            "Referer": IMAGE_HOSTING_REFERER(),
            "Origin": IMAGE_HOSTING_BASE_URL(),
        }

        content_type = f"image/{ext}"
        if ext == "jpg":
            content_type = "image/jpeg"

        content = await asyncio.to_thread(_read_file, image_path)
        async with httpx.AsyncClient(timeout=60.0) as client:
            files = {"file": (os.path.basename(image_path), content, content_type)}
            response = await client.post(IMAGE_HOSTING_UPLOAD_URL(), headers=headers, files=files)

        if response.status_code != 200:
            raise Exception(f"上传失败（状态码 {response.status_code}）: {response.text}")

        data = response.json()
        logger.info(f"图床上传响应: {data}")

        if isinstance(data, list) and len(data) > 0:
            item = data[0]
            src = item.get("src")
            delete_token = item.get("delete_token") or item.get("delete")
            if src:
                url = src if src.startswith("http") else f"{IMAGE_HOSTING_BASE_URL()}{src}"
                return url, delete_token
            raise Exception(f"上传成功但无法获取URL: {data}")
        raise Exception(f"上传失败: {response.text}")

    @classmethod
    async def delete_image(cls, delete_token: str) -> bool:
        """删除图床上的图片"""
        if not delete_token:
            return False

        try:
            headers = {
                "Referer": IMAGE_HOSTING_REFERER(),
                "Origin": IMAGE_HOSTING_BASE_URL(),
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                # 尝试 SM.MS 格式的删除API
                delete_url = f"{IMAGE_HOSTING_BASE_URL()}/api/v2/delete/{delete_token}"
                response = await client.get(delete_url, headers=headers)

                if response.status_code == 200:
                    result = response.json()
                    if result.get("success"):
                        logger.info(f"删除成功: {delete_token}")
                        return True
                    logger.warning(f"删除响应: {result}")
                    return False
                else:
                    logger.warning(f"删除失败（状态码 {response.status_code}）: {response.text}")
                    return False
        except Exception as e:
            logger.error(f"删除异常: {e}")
            return False
