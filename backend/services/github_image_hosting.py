import os
import base64
import hashlib
import logging
import httpx
from typing import Optional

from backend.config import (
    GITHUB_HOSTING_REPO,
    GITHUB_HOSTING_TOKEN,
    GITHUB_HOSTING_BRANCH,
    MAX_FILE_SIZE,
    ALLOWED_EXTENSIONS,
)

logger = logging.getLogger(__name__)

GITHUB_API = "https://api.github.com"


class GithubImageHostingService:
    @classmethod
    async def upload_image(cls, image_path: str) -> tuple[Optional[str], Optional[str]]:
        """上传图片到 GitHub 仓库，返回 (jsdelivr_url, None)"""
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"文件不存在: {image_path}")

        ext = os.path.splitext(image_path)[1].lower().lstrip(".")
        if ext not in ALLOWED_EXTENSIONS:
            raise ValueError(f"不支持的文件格式: {ext}")

        file_size = os.path.getsize(image_path)
        if file_size > MAX_FILE_SIZE:
            raise ValueError(f"文件大小 {file_size / 1024 / 1024:.2f}MB 超过限制")

        with open(image_path, "rb") as f:
            content = f.read()
        content_hash = hashlib.md5(content).hexdigest()
        b64_content = base64.b64encode(content).decode()

        repo = GITHUB_HOSTING_REPO()
        token = GITHUB_HOSTING_TOKEN()
        branch = GITHUB_HOSTING_BRANCH()

        if not repo or not token:
            raise ValueError("未配置 GitHub 仓库或 Token")

        file_path = f"images/{content_hash}.{ext}"
        api_url = f"{GITHUB_API}/repos/{repo}/contents/{file_path}"
        headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
        }
        payload = {
            "message": f"upload {content_hash}.{ext}",
            "content": b64_content,
            "branch": branch,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.put(api_url, json=payload, headers=headers)

            if response.status_code == 422:
                get_resp = await client.get(api_url, headers=headers)
                if get_resp.status_code == 200:
                    sha = get_resp.json().get("sha")
                    if sha:
                        payload["sha"] = sha
                        response = await client.put(api_url, json=payload, headers=headers)

        if response.status_code in (200, 201):
            logger.info(f"GitHub 图床上传成功: {file_path}")
        elif response.status_code == 409:
            logger.info(f"GitHub 图床文件已存在: {file_path}")
        else:
            raise Exception(f"GitHub 上传失败（{response.status_code}）: {response.text}")

        cdn_url = f"https://cdn.jsdelivr.net/gh/{repo}@{branch}/{file_path}"
        return cdn_url, None

    @classmethod
    async def delete_image(cls, delete_token: str) -> bool:
        return False
