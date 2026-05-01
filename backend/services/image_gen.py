import httpx
from typing import Optional, Dict, Any, List

from backend.config import IMAGE_GEN_API_URL, IMAGE_GEN_API_KEY


class ImageGenService:
    @classmethod
    async def submit_task(cls, prompt: str, size: str = "auto", urls: Optional[List[str]] = None) -> Dict[str, Any]:
        headers = {"Authorization": IMAGE_GEN_API_KEY()}
        payload = {"prompt": prompt, "size": size}
        if urls:
            payload["urls"] = urls

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{IMAGE_GEN_API_URL()}/image_gpt",
                headers=headers,
                json=payload,
            )

        if response.status_code != 200:
            raise Exception(f"提交任务失败 ({response.status_code}): {response.text}")

        result = response.json()
        if not result:
            raise Exception(f"API 返回空响应: {response.text}")
        data = result.get("data", {})
        task_id = data.get("id")
        if not task_id:
            raise Exception(f"提交成功但无法获取 task_id: {response.text}")
        return {"task_id": task_id}

    @classmethod
    async def get_task_result(cls, task_id: str) -> Optional[Dict[str, Any]]:
        params = {"key": IMAGE_GEN_API_KEY(), "id": task_id}

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{IMAGE_GEN_API_URL()}/detail",
                    params=params,
                )
        except Exception:
            return None

        if response.status_code != 200:
            return None

        data = response.json()
        code = data.get("code")

        if code in (1, 200):
            return data.get("data")
        elif code == 2:
            raise Exception(f"任务失败: {data.get('msg', '未知错误')}")

        return None

    @classmethod
    async def download_image(cls, url: str, save_path: str) -> bool:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.get(url)

        if response.status_code != 200:
            return False

        with open(save_path, "wb") as f:
            f.write(response.content)

        return True
