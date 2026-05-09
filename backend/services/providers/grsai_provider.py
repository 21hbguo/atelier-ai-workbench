import httpx
from typing import Optional, Dict, Any, List
from backend.services.image_gen import get_http_client

class GrsAIProvider:
    provider_type = "grsai"
    _vip_pixels={"low":{"1:1":"1024x1024","16:9":"1774x887","9:16":"887x1774","3:2":"1536x1024","2:3":"1024x1536","4:3":"1365x1024","3:4":"1024x1365"},"medium":{"1:1":"2048x2048","16:9":"2048x1152","9:16":"1152x2048","3:2":"2048x1360","2:3":"1360x2048","4:3":"2048x1536","3:4":"1536x2048"},"high":{"1:1":"2880x2880","16:9":"3840x2160","9:16":"2160x3840","3:2":"3504x2336","2:3":"2336x3504","4:3":"3328x2496","3:4":"2496x3328"}}
    _image_pixels={"1:1":"1024x1024","16:9":"1774x887","9:16":"887x1774","3:2":"1536x1024","2:3":"1024x1536","4:3":"1365x1024","3:4":"1024x1365"}

    @classmethod
    def _base_url(cls, conf: Dict[str, Any]) -> str:
        return ((conf or {}).get("api_url") or "https://grsai.dakka.com.cn").rstrip("/")

    @classmethod
    def _auth_header(cls, conf: Dict[str, Any]) -> str:
        return f"Bearer {(conf or {}).get('api_key') or ''}"

    @classmethod
    def _resolve_vip_aspect_pixels(cls, resolution: Optional[str], aspect_ratio: Optional[str]) -> str:
        res = str(resolution or "").strip().lower()
        ratio = str(aspect_ratio or "").strip()
        if not res or res == "auto": return ""
        return cls._vip_pixels.get(res, {}).get(ratio, "")

    @classmethod
    def _resolve_image_ratio_pixels(cls, size: Optional[str]) -> str:
        ratio = str(size or "").strip()
        if not ratio or ratio == "auto": return ""
        return cls._image_pixels.get(ratio, ratio if "x" in ratio.lower() else "")

    @classmethod
    async def submit(cls, conf: Dict[str, Any], prompt: str, size: str = "auto", resolution: Optional[str] = None, aspect_ratio: Optional[str] = None, quality: Optional[str] = None, urls: Optional[List[str]] = None, model: Optional[str] = None) -> Dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": cls._auth_header(conf)
        }
        model_name = model or (conf or {}).get("model") or "gpt-image-2"
        payload = {
            "model": model_name,
            "prompt": prompt,
            "webHook": "-1",
            "shutProgress": False
        }
        size = str(size or "").strip()
        if model_name == "gpt-image-2-vip":
            vip_ratio = size if size and size != "auto" else aspect_ratio
            vip_pixels = cls._resolve_vip_aspect_pixels(resolution, vip_ratio)
            if vip_pixels:
                payload["size"] = vip_pixels
        elif model_name == "gpt-image-2":
            image_pixels = cls._resolve_image_ratio_pixels(size)
            if image_pixels:
                payload["size"] = image_pixels
        elif size and size != "auto":
            payload["size" if "x" in size.lower() else "aspectRatio"] = size
        quality = str(quality or "").strip()
        if quality and quality != "auto":
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
