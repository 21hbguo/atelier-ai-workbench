import json
import logging
import threading
from pathlib import Path
from typing import Any
import numpy as np
from backend.config import get_prompt_embedding_config
from backend.database import get_db
logger=logging.getLogger(__name__)
class PromptEmbeddingService:
    _model=None
    _index=None
    _lock=threading.RLock()
    _model_lock=threading.RLock()
    _items_name="items.json"
    _vectors_name="vectors.npy"
    @classmethod
    def _cfg(cls)->dict[str,Any]:
        return get_prompt_embedding_config()
    @classmethod
    def _dir(cls)->Path:
        return cls._cfg()["dir"]
    @classmethod
    def _items_path(cls)->Path:
        return cls._dir()/cls._items_name
    @classmethod
    def _vectors_path(cls)->Path:
        return cls._dir()/cls._vectors_name
    @classmethod
    def _cache_dir(cls)->Path:
        p=cls._dir()/"model_cache";p.mkdir(parents=True,exist_ok=True);return p
    @classmethod
    def _local_model_snapshot_dir(cls)->Path|None:
        base=cls._cache_dir()/"models--qdrant--paraphrase-multilingual-MiniLM-L12-v2-onnx-Q"
        ref=base/"refs"/"main"
        if not ref.exists():return None
        snap=base/"snapshots"/ref.read_text(encoding="utf-8").strip()
        return snap if snap.exists() else None
    @classmethod
    def _prepare_local_model_dir(cls)->Path|None:
        snap=cls._local_model_snapshot_dir()
        if snap is None:return None
        local_onnx=cls._cache_dir()/"model_qint8_avx512.onnx"
        if local_onnx.exists():
            target=snap/"model_optimized.onnx"
            try:
                if target.exists() or target.is_symlink():target.unlink()
            except Exception:
                pass
            try:
                target.symlink_to(local_onnx.resolve())
            except Exception:
                try:
                    import shutil
                    shutil.copy2(local_onnx,target)
                except Exception:
                    logger.exception("[prompt_embedding] failed to inject local onnx file")
        if not (snap/"tokenizer.json").exists():
            logger.warning("[prompt_embedding] local model dir missing tokenizer.json: %s",snap)
        return snap
    @classmethod
    def is_enabled(cls)->bool:
        return bool(cls._cfg()["enabled"])
    @classmethod
    def _load_model(cls):
        if cls._model is not None:return cls._model
        with cls._model_lock:
            if cls._model is not None:return cls._model
            from fastembed import TextEmbedding
            local_model_dir=cls._prepare_local_model_dir()
            cls._model=TextEmbedding(model_name=cls._cfg()["model"],cache_dir=str(cls._cache_dir()),providers=["CPUExecutionProvider"],specific_model_path=str(local_model_dir) if local_model_dir else None)
            return cls._model
    @classmethod
    def _normalize_vectors(cls,vectors:np.ndarray)->np.ndarray:
        if vectors.size==0:return vectors.astype(np.float32)
        arr=np.asarray(vectors,dtype=np.float32)
        norms=np.linalg.norm(arr,axis=1,keepdims=True)
        norms=np.where(norms==0,1.0,norms)
        return (arr/norms).astype(np.float32)
    @classmethod
    def _encode(cls,texts:list[str],batch_size:int|None=None)->np.ndarray:
        rows=[str(t or "").strip() for t in texts]
        if not rows:return np.zeros((0,0),dtype=np.float32)
        model=cls._load_model()
        sizes=[];start=max(1,int(batch_size or cls._cfg()["batch_size"]))
        cur=start
        while cur>=1:
            if cur not in sizes:sizes.append(cur)
            if cur==1:break
            cur=max(1,cur//2)
        last_err=None
        for size in sizes:
            try:
                vectors=list(model.embed(rows,batch_size=size))
                if not vectors:return np.zeros((0,0),dtype=np.float32)
                return cls._normalize_vectors(np.vstack([np.asarray(v,dtype=np.float32) for v in vectors]))
            except Exception as e:
                last_err=e
                logger.warning("[prompt_embedding] batch_size=%s failed: %s",size,e)
        if last_err:raise last_err
        return np.zeros((0,0),dtype=np.float32)
    @classmethod
    def _read_index(cls)->dict[str,Any]:
        items_path=cls._items_path();vectors_path=cls._vectors_path()
        if not items_path.exists() or not vectors_path.exists():return {"items":[],"vectors":np.zeros((0,0),dtype=np.float32),"updated_at":0.0}
        try:
            items=json.loads(items_path.read_text(encoding="utf-8"))
            items=items if isinstance(items,list) else []
            vectors=np.load(vectors_path,allow_pickle=False)
            vectors=np.asarray(vectors,dtype=np.float32)
            if len(items)!=len(vectors):
                logger.warning("[prompt_embedding] index size mismatch items=%s vectors=%s",len(items),len(vectors))
                return {"items":[],"vectors":np.zeros((0,0),dtype=np.float32),"updated_at":0.0}
            ts=max(items_path.stat().st_mtime if items_path.exists() else 0.0,vectors_path.stat().st_mtime if vectors_path.exists() else 0.0)
            return {"items":items,"vectors":vectors,"updated_at":ts}
        except Exception:
            logger.exception("[prompt_embedding] read index failed")
            return {"items":[],"vectors":np.zeros((0,0),dtype=np.float32),"updated_at":0.0}
    @classmethod
    def _ensure_index_loaded(cls,force:bool=False)->dict[str,Any]:
        with cls._lock:
            items_path=cls._items_path();vectors_path=cls._vectors_path()
            ts=max(items_path.stat().st_mtime if items_path.exists() else 0.0,vectors_path.stat().st_mtime if vectors_path.exists() else 0.0)
            if force or cls._index is None or ts>(cls._index.get("updated_at") or 0.0):
                cls._index=cls._read_index()
            return cls._index
    @classmethod
    def _save_index(cls,items:list[dict[str,Any]],vectors:np.ndarray):
        items_path=cls._items_path();vectors_path=cls._vectors_path()
        items_path.write_text(json.dumps(items,ensure_ascii=False),encoding="utf-8")
        np.save(vectors_path,cls._normalize_vectors(vectors))
        cls._index={"items":items,"vectors":cls._normalize_vectors(vectors),"updated_at":max(items_path.stat().st_mtime,vectors_path.stat().st_mtime)}
    @classmethod
    def collect_all_items(cls)->list[dict[str,Any]]:
        with get_db() as conn:
            prompt_rows=conn.execute("SELECT id,name,prompt,category,author,created_at FROM prompts WHERE COALESCE(is_frozen,FALSE)=FALSE AND COALESCE(TRIM(prompt),'')<>'' ORDER BY created_at DESC,id").fetchall()
            square_rows=conn.execute("SELECT si.id,si.prompt,si.category,COALESCE(u.nickname,u.username,'') author,si.created_at FROM square_images si LEFT JOIN users u ON si.user_id=u.id WHERE COALESCE(si.is_frozen,FALSE)=FALSE AND COALESCE(TRIM(si.prompt),'')<>'' ORDER BY si.created_at DESC,si.id DESC").fetchall()
        items=[]
        for r in prompt_rows:items.append({"key":f"prompt:{r['id']}","item_id":str(r["id"]),"item_type":"prompt","prompt":str(r["prompt"] or "").strip(),"name":str(r["name"] or "").strip(),"category":str(r["category"] or "").strip(),"author":str(r["author"] or "").strip(),"updated_at":str(r["created_at"] or "")})
        for r in square_rows:items.append({"key":f"image:{r['id']}","item_id":str(r["id"]),"item_type":"image","prompt":str(r["prompt"] or "").strip(),"name":"","category":str(r["category"] or "").strip(),"author":str(r["author"] or "").strip(),"updated_at":str(r["created_at"] or "")})
        return [item for item in items if item["prompt"]]
    @classmethod
    def rebuild_index(cls)->dict[str,int]:
        items=cls.collect_all_items()
        vectors=cls._encode([item["prompt"] for item in items]) if items else np.zeros((0,0),dtype=np.float32)
        with cls._lock:
            cls._save_index(items,vectors)
        return {"count":len(items)}
    @classmethod
    def ensure_index_ready(cls)->dict[str,int]:
        if not cls.is_enabled():return {"count":0,"rebuilt":0,"added":0,"removed":0}
        latest_items=cls.collect_all_items()
        latest_map={item["key"]:item for item in latest_items}
        with cls._lock:
            idx=cls._ensure_index_loaded()
            items=list(idx["items"]);vectors=np.asarray(idx["vectors"],dtype=np.float32)
            if not items or len(vectors)==0:
                if not latest_items:
                    cls._save_index([],np.zeros((0,0),dtype=np.float32))
                    return {"count":0,"rebuilt":0,"added":0,"removed":0}
                new_vectors=cls._encode([item["prompt"] for item in latest_items])
                cls._save_index(latest_items,new_vectors)
                return {"count":len(latest_items),"rebuilt":1,"added":len(latest_items),"removed":0}
            current_keys=[str(item.get("key") or "") for item in items]
            current_set=set(current_keys)
            latest_set=set(latest_map.keys())
            missing_keys=[key for key in latest_map.keys() if key not in current_set]
            removed_keys=[key for key in current_keys if key not in latest_set]
            changed_keys=[key for key in latest_map.keys() if key in current_set and latest_map[key].get("prompt")!=items[current_keys.index(key)].get("prompt")]
            if not missing_keys and not removed_keys and not changed_keys:return {"count":len(items),"rebuilt":0,"added":0,"removed":0}
            next_items=[];reencode_items=[];reencode_pos=[];removed=0
            for i,item in enumerate(items):
                key=str(item.get("key") or "")
                if key in removed_keys:
                    removed+=1
                    continue
                latest_item=latest_map.get(key)
                if latest_item is None:
                    removed+=1
                    continue
                next_items.append(latest_item)
                if key in changed_keys:
                    reencode_items.append(latest_item["prompt"]);reencode_pos.append(len(next_items)-1)
            next_vectors=np.asarray([vectors[i] for i,key in enumerate(current_keys) if key not in removed_keys and key in latest_set],dtype=np.float32) if len(next_items) else np.zeros((0,vectors.shape[1] if vectors.ndim==2 and vectors.shape[0]>0 else 0),dtype=np.float32)
            if reencode_items:
                changed_vectors=cls._encode(reencode_items)
                for i,pos in enumerate(reencode_pos):next_vectors[pos]=changed_vectors[i]
            if missing_keys:
                add_items=[latest_map[key] for key in missing_keys]
                add_vectors=cls._encode([item["prompt"] for item in add_items])
                next_items.extend(add_items)
                next_vectors=add_vectors if len(next_vectors)==0 else np.vstack([next_vectors,add_vectors])
            cls._save_index(next_items,next_vectors if len(next_items) else np.zeros((0,0),dtype=np.float32))
            return {"count":len(next_items),"rebuilt":0,"added":len(missing_keys)+len(changed_keys),"removed":removed}
    @classmethod
    def _fetch_prompt_item(cls,prompt_id:str)->dict[str,Any]|None:
        with get_db() as conn:
            r=conn.execute("SELECT id,name,prompt,category,author,created_at,is_frozen FROM prompts WHERE id=%s",(prompt_id,)).fetchone()
        if not r or bool(r.get("is_frozen")) or not str(r.get("prompt") or "").strip():return None
        return {"key":f"prompt:{r['id']}","item_id":str(r["id"]),"item_type":"prompt","prompt":str(r["prompt"] or "").strip(),"name":str(r["name"] or "").strip(),"category":str(r["category"] or "").strip(),"author":str(r["author"] or "").strip(),"updated_at":str(r["created_at"] or "")}
    @classmethod
    def _fetch_square_item(cls,image_id:int|str)->dict[str,Any]|None:
        with get_db() as conn:
            r=conn.execute("SELECT si.id,si.prompt,si.category,si.created_at,si.is_frozen,COALESCE(u.nickname,u.username,'') author FROM square_images si LEFT JOIN users u ON si.user_id=u.id WHERE si.id=%s",(int(image_id),)).fetchone()
        if not r or bool(r.get("is_frozen")) or not str(r.get("prompt") or "").strip():return None
        return {"key":f"image:{r['id']}","item_id":str(r["id"]),"item_type":"image","prompt":str(r["prompt"] or "").strip(),"name":"","category":str(r["category"] or "").strip(),"author":str(r["author"] or "").strip(),"updated_at":str(r["created_at"] or "")}
    @classmethod
    def upsert_prompt(cls,prompt_id:str):
        if not cls.is_enabled():return
        item=cls._fetch_prompt_item(prompt_id)
        if item is None:return cls.remove_item("prompt",prompt_id)
        vec=cls._encode([item["prompt"]])
        with cls._lock:
            idx=cls._ensure_index_loaded()
            items=list(idx["items"]);vectors=np.asarray(idx["vectors"],dtype=np.float32)
            pos=next((i for i,v in enumerate(items) if v.get("key")==item["key"]),-1)
            if pos>=0:
                items[pos]=item
                if len(vectors)==0:vectors=vec
                else:vectors[pos]=vec[0]
            else:
                items.append(item)
                vectors=vec if len(vectors)==0 else np.vstack([vectors,vec])
            cls._save_index(items,vectors)
    @classmethod
    def upsert_square(cls,image_id:int|str):
        if not cls.is_enabled():return
        item=cls._fetch_square_item(image_id)
        if item is None:return cls.remove_item("image",image_id)
        vec=cls._encode([item["prompt"]])
        with cls._lock:
            idx=cls._ensure_index_loaded()
            items=list(idx["items"]);vectors=np.asarray(idx["vectors"],dtype=np.float32)
            pos=next((i for i,v in enumerate(items) if v.get("key")==item["key"]),-1)
            if pos>=0:
                items[pos]=item
                if len(vectors)==0:vectors=vec
                else:vectors[pos]=vec[0]
            else:
                items.append(item)
                vectors=vec if len(vectors)==0 else np.vstack([vectors,vec])
            cls._save_index(items,vectors)
    @classmethod
    def remove_item(cls,item_type:str,item_id:int|str):
        if not cls.is_enabled():return
        key=f"{'prompt' if item_type=='prompt' else 'image'}:{item_id}"
        with cls._lock:
            idx=cls._ensure_index_loaded()
            items=list(idx["items"]);vectors=np.asarray(idx["vectors"],dtype=np.float32)
            pos=next((i for i,v in enumerate(items) if v.get("key")==key),-1)
            if pos<0:return
            items.pop(pos)
            vectors=np.delete(vectors,pos,axis=0) if len(vectors) else np.zeros((0,0),dtype=np.float32)
            cls._save_index(items,vectors if len(items) else np.zeros((0,vectors.shape[1] if vectors.ndim==2 and vectors.shape[0]>0 else 0),dtype=np.float32))
    @classmethod
    def search_similar(cls,prompt:str,top_k:int=2)->list[dict[str,Any]]:
        if not cls.is_enabled():return []
        text=str(prompt or "").strip()
        if not text:return []
        try:
            cls.ensure_index_ready()
        except Exception:
            logger.exception("[prompt_embedding] ensure index ready failed")
        idx=cls._ensure_index_loaded()
        items=idx["items"];vectors=np.asarray(idx["vectors"],dtype=np.float32)
        if not items or len(vectors)==0:return []
        q=cls._encode([text],batch_size=1)
        scores=vectors@q[0]
        order=np.argsort(scores)[::-1][:max(1,int(top_k or 2))]
        out=[]
        for i in order.tolist():
            if i<0 or i>=len(items):continue
            item=dict(items[i]);item["score"]=float(scores[i]);out.append(item)
        return out
