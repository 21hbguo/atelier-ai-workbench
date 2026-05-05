import httpx
from typing import Optional, Dict, Any, List
from backend.services.image_gen import get_http_client

class GrsAIProvider:
    provider_type = "grsai"

    @classmethod
    def _base_url(cls, conf: Dict[str, Any]) -> str:
        return ((conf or {}).get("api_url") or "https://grsai.dakka.com.cn").rstrip("/")

    @classmethod
    def _auth_header(cls, conf: Dict[str, Any]) -> str:
        return f"Bearer {(conf or {}).get('api_key') or ''}"

    @classmethod
    async def submit(cls, conf: Dict[str, Any], prompt: str, size: str = "auto", quality: Optional[str] = None, urls: Optional[List[str]] = None, model: Optional[str] = None) -> Dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": cls._auth_header(conf)
        }
        payload = {
            "model": model or (conf or {}).get("model") or "gpt-image-2",
            "prompt": prompt,
            "webHook": "-1",
            "shutProgress": False
        }
        if size and size != "auto":
            payload["aspectRatio"] = size
        if quality:
            payload["quality"] = quality
        if urls:
            payload["urls"] = urls

        client = get_http_client()
        response = await client.post(f"{cls._base_url(conf)}/v1/draw/completions", headers=headers, json=payload)
        if response.status_code != 200:
            raise RuntimeError(f"submit_http_{response.status_code}:{response.text}")

        result = response.json() or {}
        if result.get("code") != 0:
            raise RuntimeError(f"submit_error:{result.get('msg')}")

        task_id = (result.get("data") or {}).get("id")
        if not task_id:
            raise RuntimeError(f"submit_no_task_id:{response.text}")

        return {"external_task_id": task_id, "raw": result}

    @classmethod
    async def poll(cls, conf: Dict[str, Any], external_task_id: str) -> Dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": cls._auth_header(conf)
        }
        payload = {"id": external_task_id}

        client = get_http_client()
        try:
            response = await client.post(f"{cls._base_url(conf)}/v1/draw/result", headers=headers, json=payload)
        except Exception as e:
            raise RuntimeError(f"poll_transport:{e}")

        if response.status_code != 200:
            raise RuntimeError(f"poll_http_{response.status_code}:{response.text}")

        try:
            data = response.json()
        except Exception as e:
            raise RuntimeError(f"poll_non_json:{e}")

        if data.get("code") != 0:
            raise RuntimeError(f"poll_error:{data.get('msg')}")

        result = data.get("data") or {}
        status = result.get("status")
        progress = result.get("progress", 0)

        if status == "running":
            return {"state": "running", "progress": progress, "raw": data}

        if status == "failed":
            failure_reason = result.get("failure_reason") or "生成失败"
            error_msg = result.get("error") or failure_reason
            return {"state": "failed", "message": error_msg, "raw": data, "retryable": failure_reason == "error"}

        if status == "succeeded":
            results = result.get("results") or []
            urls = [r.get("url") for r in results if r.get("url")]
            if not urls and result.get("url"):
                urls = [result["url"]]
            return {"state": "succeeded", "urls": urls, "raw": data}

        return {"state": "running", "progress": progress, "raw": data}

    @classmethod
    async def download(cls, url: str, save_path: str) -> bool:
        client = get_http_client()
        response = await client.get(url, timeout=120.0)
        if response.status_code != 200:
            return False
        with open(save_path, "wb") as f:
            f.write(response.content)
        return True

    @classmethod
    def is_retryable_error(cls, exc: Exception) -> bool:
        msg = str(exc)
        return any(x in msg for x in ["poll_transport", "poll_http_5", "submit_http_4", "submit_http_5", "429", "timeout", "timed out", "connection", "connect", "refused"])
