import httpx
from typing import Optional, Dict, Any, List
from backend.config import IMAGE_GEN_API_URL, IMAGE_GEN_API_KEY
from backend.services.image_gen import get_http_client

class WuyinImageProvider:
    provider_type="wuyin"
    @classmethod
    def _auth_value(cls, conf: Dict[str, Any]) -> str:
        return (conf or {}).get("api_key") or IMAGE_GEN_API_KEY()
    @classmethod
    def _base_url(cls, conf: Dict[str, Any]) -> str:
        return ((conf or {}).get("api_url") or IMAGE_GEN_API_URL()).rstrip("/")
    @classmethod
    async def submit(cls, conf: Dict[str, Any], prompt: str, size: str="auto", urls: Optional[List[str]]=None) -> Dict[str, Any]:
        headers={"Authorization":cls._auth_value(conf)}
        payload={"prompt":prompt,"size":size}
        if urls: payload["urls"]=urls
        client=get_http_client()
        response=await client.post(f"{cls._base_url(conf)}/image_gpt",headers=headers,json=payload)
        if response.status_code!=200: raise RuntimeError(f"submit_http_{response.status_code}:{response.text}")
        result=response.json() or {}
        code=result.get("code")
        if code not in (None,0,"0",200):
            raise RuntimeError(f"submit_biz_error:{code}:{result.get('msg','')}")
        data=result.get("data") or {}
        task_id=data.get("id")
        if not task_id: raise RuntimeError(f"submit_no_task_id:{response.text}")
        return {"external_task_id":task_id,"raw":result}
    @classmethod
    async def poll(cls, conf: Dict[str, Any], external_task_id: str) -> Dict[str, Any]:
        params={"key":cls._auth_value(conf),"id":external_task_id}
        client=get_http_client()
        try:
            response=await client.get(f"{cls._base_url(conf)}/detail",params=params)
        except Exception as e:
            raise RuntimeError(f"poll_transport:{e}")
        if response.status_code!=200: raise RuntimeError(f"poll_http_{response.status_code}:{response.text}")
        try:
            data=response.json()
        except Exception as e:
            raise RuntimeError(f"poll_non_json:{e}")
        code=data.get("code")
        if code in (0,"0"): return {"state":"running","raw":data}
        if code==2: return {"state":"failed","message":data.get("msg") or "生成失败","raw":data,"retryable":False}
        if code not in (1,200): return {"state":"running","raw":data}
        result=data.get("data")
        if result is None: return {"state":"running","raw":data}
        if isinstance(result,dict) and str(result.get("status")) in {"0","1"}: return {"state":"running","raw":data}
        if isinstance(result,dict) and str(result.get("status")) in {"3","4","5","failed","error"}: return {"state":"failed","message":(result.get("message") or result.get("msg") or "生成失败").strip(),"raw":data,"retryable":False}
        raw_urls=result.get("result") if isinstance(result,dict) else result
        if isinstance(result,dict) and raw_urls is None: raw_urls=result.get("urls") or result.get("images")
        if raw_urls is None: raw_urls=[result]
        if not isinstance(raw_urls,list): raw_urls=[raw_urls]
        urls=[]
        for item in raw_urls:
            url=item.get("url") or item.get("image") or item.get("img") if isinstance(item,dict) else str(item).strip().strip("`").strip()
            if not url: continue
            if not str(url).startswith(("http://","https://")): url=f"https://{url}"
            urls.append(url)
        if not urls: return {"state":"running","raw":data}
        return {"state":"succeeded","urls":urls,"raw":data}
    @classmethod
    async def download(cls, url: str, save_path: str) -> bool:
        client=get_http_client()
        response=await client.get(url,timeout=120.0)
        if response.status_code!=200: return False
        with open(save_path,"wb") as f:
            f.write(response.content)
        return True
    @classmethod
    def is_retryable_error(cls, exc: Exception) -> bool:
        msg=str(exc)
        return any(x in msg for x in ["poll_transport","poll_http_5","submit_http_4","submit_http_5","submit_biz_error","submit_no_task_id","429","timeout","timed out","connection","connect","refused"])
