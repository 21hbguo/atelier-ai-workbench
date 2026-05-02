import httpx
from typing import Optional, Dict, Any, List

from backend.config import IMAGE_GEN_API_URL, IMAGE_GEN_API_KEY

# 模块级单例客户端，带连接池配置
_http_client: Optional[httpx.AsyncClient] = None


def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=30.0,
            limits=httpx.Limits(
                max_connections=100,
                max_keepalive_connections=20,
                keepalive_expiry=30,
            ),
        )
    return _http_client


async def close_http_client():
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


class ImageGenService:
    @classmethod
    async def submit_task(cls, prompt: str, size: str = "auto", urls: Optional[List[str]] = None) -> Dict[str, Any]:
        headers = {"Authorization": IMAGE_GEN_API_KEY()}
        payload = {"prompt": prompt, "size": size}
        if urls:
            payload["urls"] = urls

        client = get_http_client()
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
        client = get_http_client()
        try:
            response = await client.get(f"{IMAGE_GEN_API_URL()}/detail", params=params)
        except Exception as e:
            raise Exception(f"查询任务状态失败: {str(e)}")
        if response.status_code != 200:
            raise Exception(f"查询任务状态失败 ({response.status_code}): {response.text}")
        try:
            data = response.json()
        except Exception as e:
            raise Exception(f"查询任务状态返回非JSON: {str(e)}")
        code = data.get("code")
        if code in (1, 200):
            return data.get("data")
        elif code in (0, "0"):
            return None
        elif code == 2:
            raise Exception(f"任务失败: {data.get('msg', '未知错误')}")
        elif code is not None:
            raise Exception(f"查询任务状态异常 code={code} msg={data.get('msg', '未知错误')}")
        return None

    @classmethod
    async def download_image(cls, url: str, save_path: str) -> bool:
        client = get_http_client()
        response = await client.get(url, timeout=120.0)

        if response.status_code != 200:
            return False

        with open(save_path, "wb") as f:
            f.write(response.content)

        return True
