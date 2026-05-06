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
GITHUB_REPO_SOFT_LIMIT_MB = 180
GITHUB_REPO_HARD_LIMIT_MB = 195


class GithubImageHostingService:
    @classmethod
    async def get_repo_size_mb(cls) -> Optional[float]:
        size_kb = await cls.get_repo_size_kb()
        return round(size_kb / 1024, 1) if size_kb is not None else None

    @classmethod
    async def can_upload_with_size(cls, file_size_bytes: int) -> tuple[bool, dict]:
        size_mb = await cls.get_repo_size_mb()
        if size_mb is None:
            return True, {"checked": False, "reason": "repo_size_unknown"}
        projected_mb = size_mb + file_size_bytes / 1024 / 1024
        if projected_mb >= GITHUB_REPO_HARD_LIMIT_MB:
            return False, {"checked": True, "size_mb": size_mb, "projected_mb": round(projected_mb, 1), "hard_limit_mb": GITHUB_REPO_HARD_LIMIT_MB}
        return True, {"checked": True, "size_mb": size_mb, "projected_mb": round(projected_mb, 1), "soft_limit_mb": GITHUB_REPO_SOFT_LIMIT_MB, "hard_limit_mb": GITHUB_REPO_HARD_LIMIT_MB}

    @classmethod
    async def ensure_upload_capacity(cls, file_size_bytes: int) -> tuple[bool, dict]:
        allowed, info = await cls.can_upload_with_size(file_size_bytes)
        if allowed:
            return True, {**info, "cleaned_before_upload": 0}
        from backend.services.image_expiry import enforce_github_repo_size_limit
        cleanup_result = await enforce_github_repo_size_limit(target_size_mb=GITHUB_REPO_SOFT_LIMIT_MB)
        allowed_after, info_after = await cls.can_upload_with_size(file_size_bytes)
        return allowed_after, {**info_after, "cleaned_before_upload": cleanup_result.get("github_deleted", 0), "cleanup_result": cleanup_result}

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
        allowed, info = await cls.ensure_upload_capacity(file_size)
        if not allowed:
            raise ValueError(f"GitHub 图床仓库容量不足，已后台尝试清理，当前约 {info.get('size_mb')}MB，预计上传后 {info.get('projected_mb')}MB，仍无法上传")

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
        return cdn_url, file_path

    @classmethod
    async def _get_file_sha(cls, file_path: str) -> Optional[str]:
        """获取 GitHub 仓库中文件的 SHA"""
        repo = GITHUB_HOSTING_REPO()
        token = GITHUB_HOSTING_TOKEN()
        branch = GITHUB_HOSTING_BRANCH()
        if not repo or not token:
            return None
        api_url = f"{GITHUB_API}/repos/{repo}/contents/{file_path}"
        headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(api_url, headers=headers, params={"ref": branch})
            if resp.status_code == 200:
                return resp.json().get("sha")
        return None

    @classmethod
    async def delete_image(cls, delete_token: str) -> bool:
        """删除 GitHub 仓库中的图片，delete_token 为文件路径"""
        if not delete_token:
            return False
        file_path = delete_token
        repo = GITHUB_HOSTING_REPO()
        token = GITHUB_HOSTING_TOKEN()
        branch = GITHUB_HOSTING_BRANCH()
        if not repo or not token:
            logger.warning("GitHub hosting not configured, cannot delete")
            return False
        sha = await cls._get_file_sha(file_path)
        if not sha:
            logger.warning(f"Cannot get SHA for {file_path}, file may not exist")
            return False
        api_url = f"{GITHUB_API}/repos/{repo}/contents/{file_path}"
        headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
        payload = {"message": f"delete {file_path}", "sha": sha, "branch": branch}
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(api_url, json=payload, headers=headers)
        if response.status_code == 200:
            logger.info(f"GitHub delete success: {file_path}")
            return True
        logger.warning(f"GitHub delete failed ({response.status_code}): {response.text}")
        return False

    @classmethod
    async def get_repo_size_kb(cls) -> Optional[int]:
        """获取 GitHub 仓库大小（KB）"""
        repo = GITHUB_HOSTING_REPO()
        token = GITHUB_HOSTING_TOKEN()
        if not repo or not token:
            return None
        api_url = f"{GITHUB_API}/repos/{repo}"
        headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(api_url, headers=headers)
        if resp.status_code == 200:
            return resp.json().get("size")
        return None
