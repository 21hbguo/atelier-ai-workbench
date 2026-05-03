from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from backend.config import get_generation_models, get_generation_providers, get_default_model_id
from backend.services.providers import WuyinImageProvider, GrsAIProvider

class GenGateway:
    _providers={"wuyin":WuyinImageProvider,"grsai":GrsAIProvider}
    _health: Dict[str, Dict[str, Any]]={}
    @classmethod
    def _now(cls):
        return datetime.now()
    @classmethod
    def _provider_conf(cls, provider_id: str) -> Dict[str, Any]:
        return (get_generation_providers() or {}).get(provider_id) or {}
    @classmethod
    def _provider_impl(cls, provider_conf: Dict[str, Any]):
        return cls._providers.get((provider_conf or {}).get("type") or "wuyin")
    @classmethod
    def _is_open(cls, provider_id: str, provider_conf: Dict[str, Any]) -> bool:
        h=cls._health.get(provider_id) or {}
        opened_until=h.get("opened_until")
        if opened_until and opened_until>cls._now(): return True
        if opened_until and opened_until<=cls._now():
            h["opened_until"]=None
            cls._health[provider_id]=h
        return False
    @classmethod
    def _mark_success(cls, provider_id: str):
        h=cls._health.get(provider_id) or {"fails":0}
        h["fails"]=0
        h["opened_until"]=None
        h["last_ok"]=cls._now()
        cls._health[provider_id]=h
    @classmethod
    def _mark_fail(cls, provider_id: str, provider_conf: Dict[str, Any]):
        h=cls._health.get(provider_id) or {"fails":0}
        h["fails"]=int(h.get("fails") or 0)+1
        threshold=int((provider_conf or {}).get("circuit_fail_threshold",3) or 3)
        if h["fails"]>=threshold:
            cooldown=int((provider_conf or {}).get("circuit_cooldown_seconds",60) or 60)
            h["opened_until"]=cls._now()+timedelta(seconds=cooldown)
        cls._health[provider_id]=h
    @classmethod
    def resolve_model(cls, model_id: Optional[str]) -> Dict[str, Any]:
        models=get_generation_models() or {}
        final_model_id=model_id or get_default_model_id()
        model=models.get(final_model_id)
        if model: return {"model_id":final_model_id,"model":model}
        fallback_id=get_default_model_id()
        fallback=models.get(fallback_id) or {"label":"默认模型","capability":"image","providers":[]}
        return {"model_id":fallback_id,"model":fallback}
    @classmethod
    def choose_provider_chain(cls, model_id: Optional[str]) -> Dict[str, Any]:
        resolved=cls.resolve_model(model_id)
        m=resolved["model"]
        providers=(m.get("providers") or [])[:]
        all_providers=get_generation_providers() or {}
        candidates=[]
        for pid in providers:
            conf=all_providers.get(pid) or {}
            if not conf or conf.get("enabled") is False: continue
            if cls._is_open(pid,conf): continue
            candidates.append((pid,int(conf.get("priority",100) or 100)))
        candidates.sort(key=lambda x:x[1],reverse=True)
        return {"model_id":resolved["model_id"],"model":m,"provider_ids":[x[0] for x in candidates]}
    @classmethod
    async def submit(cls, model_id: Optional[str], prompt: str, size: str="auto", image_urls: Optional[List[str]]=None) -> Dict[str, Any]:
        chain=cls.choose_provider_chain(model_id)
        tried=[]
        errors=[]
        providers=get_generation_providers() or {}
        for pid in chain["provider_ids"]:
            conf=providers.get(pid) or {}
            impl=cls._provider_impl(conf)
            if not impl: continue
            try:
                ret=await impl.submit(conf,prompt=prompt,size=size,urls=image_urls)
                cls._mark_success(pid)
                tried.append({"provider_id":pid,"ok":True})
                return {"model_id":chain["model_id"],"provider_id":pid,"external_task_id":ret["external_task_id"],"provider_trace":tried}
            except Exception as e:
                cls._mark_fail(pid,conf)
                retryable=impl.is_retryable_error(e) if hasattr(impl,"is_retryable_error") else False
                tried.append({"provider_id":pid,"ok":False,"retryable":bool(retryable),"error":str(e)})
                errors.append(str(e))
                if not retryable: break
        raise RuntimeError(f"submit_failed:{';'.join(errors) or 'no_provider_available'}")
    @classmethod
    async def poll(cls, provider_id: str, external_task_id: str) -> Dict[str, Any]:
        conf=cls._provider_conf(provider_id)
        impl=cls._provider_impl(conf)
        if not impl: raise RuntimeError("poll_no_provider_impl")
        result=await impl.poll(conf,external_task_id=external_task_id)
        state=result.get("state") or "running"
        if state=="succeeded": cls._mark_success(provider_id)
        if state=="failed": cls._mark_fail(provider_id,conf)
        return result
    @classmethod
    async def download(cls, provider_id: str, url: str, save_path: str) -> bool:
        conf=cls._provider_conf(provider_id)
        impl=cls._provider_impl(conf)
        if not impl: return False
        return await impl.download(url,save_path)
    @classmethod
    def public_models(cls) -> List[Dict[str, Any]]:
        models=get_generation_models() or {}
        out=[]
        for model_id,model in models.items():
            if model.get("enabled") is False: continue
            out.append({"model_id":model_id,"label":model.get("label") or model_id,"capability":model.get("capability") or "image"})
        out.sort(key=lambda x:x["label"])
        return out
