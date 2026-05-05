from typing import Any, Dict, List, Optional
from backend.database import get_db
from backend.config import GENERATED_IMAGES_DIR, EVO_IMAGES_DIR, EVO_IMPORTED_DIR, UPLOAD_DIR
from backend.services.image_dimensions import get_image_dimensions


def _get_evo_image_path(image_path: str):
    p = EVO_IMPORTED_DIR / image_path
    if p.exists():
        return p
    return EVO_IMAGES_DIR / image_path

_ALLOWED_TYPES={"image","prompt"}

class FavoriteService:
    @classmethod
    def _create_initial_like(cls,user_id:int,target_type:str,target_id:str,conn)->None:
        if target_type=="image":
            try:iid=int(target_id)
            except: return
            row=conn.execute("INSERT INTO square_likes(image_id,user_id) VALUES(%s,%s) ON CONFLICT(image_id,user_id) DO NOTHING RETURNING id",(iid,user_id)).fetchone()
            if row:conn.execute("UPDATE square_images SET likes_count=likes_count+1 WHERE id=%s",(iid,))
            return
        row=conn.execute("INSERT INTO prompt_likes(prompt_id,user_id) VALUES(%s,%s) ON CONFLICT(prompt_id,user_id) DO NOTHING RETURNING id",(str(target_id),user_id)).fetchone()
        if row:conn.execute("UPDATE prompts SET likes_count=likes_count+1 WHERE id=%s",(str(target_id),))

    @classmethod
    def toggle(cls,user_id:int,target_type:str,target_id:str)->bool:
        t=(target_type or "").strip()
        if t not in _ALLOWED_TYPES:raise ValueError("不支持的收藏类型")
        with get_db() as conn:
            row=conn.execute("SELECT id FROM favorites WHERE user_id=%s AND target_type=%s AND target_id=%s",(user_id,t,str(target_id))).fetchone()
            if row:
                conn.execute("DELETE FROM favorites WHERE id=%s",(row["id"],))
                return False
            if t=="image":
                try:
                    image_id=int(target_id)
                except:
                    raise ValueError("收藏目标不存在")
                exists=conn.execute("SELECT id FROM square_images WHERE id=%s AND COALESCE(is_frozen,FALSE)=FALSE",(image_id,)).fetchone()
            else:
                exists=conn.execute("SELECT id FROM prompts WHERE id=%s AND COALESCE(is_frozen,FALSE)=FALSE",(str(target_id),)).fetchone()
            if not exists:raise ValueError("收藏目标不存在")
            conn.execute("INSERT INTO favorites(user_id,target_type,target_id) VALUES(%s,%s,%s)",(user_id,t,str(target_id)))
            cls._create_initial_like(user_id,t,str(target_id),conn)
            return True

    @classmethod
    def get_flags(cls,user_id:int,target_type:str,target_ids:List[str],conn=None)->set:
        if not user_id or not target_ids:return set()
        def _run(conn):
            placeholders=",".join("%s" for _ in target_ids)
            rows=conn.execute(f"SELECT target_id FROM favorites WHERE user_id=%s AND target_type=%s AND target_id IN ({placeholders})",[user_id,target_type,*[str(i) for i in target_ids]]).fetchall()
            return {str(r["target_id"]) for r in rows}
        if conn is not None:return _run(conn)
        with get_db() as conn:return _run(conn)

    @classmethod
    def list(cls,user_id:int,favorite_type:str="all",page:int=1,size:int=20)->Dict[str,Any]:
        f=(favorite_type or "all").strip()
        if f not in {"all","image","prompt"}:raise ValueError("不支持的收藏筛选")
        where=["user_id=%s"];params:[Any]=[user_id]
        if f in {"image","prompt"}:
            where.append("target_type=%s")
            params.append(f)
        where_sql=" AND ".join(where)
        offset=(page-1)*size
        with get_db() as conn:
            total=conn.execute(f"SELECT COUNT(*) AS cnt FROM favorites WHERE {where_sql}",params).fetchone()["cnt"]
            refs=conn.execute(f"SELECT target_type,target_id,created_at FROM favorites WHERE {where_sql} ORDER BY created_at DESC,id DESC LIMIT %s OFFSET %s",params+[size,offset]).fetchall()
            image_ids=[int(r["target_id"]) for r in refs if r["target_type"]=="image" and str(r["target_id"]).isdigit()]
            prompt_ids=[str(r["target_id"]) for r in refs if r["target_type"]=="prompt"]
            image_liked_ids=set()
            prompt_liked_ids=set()
            if image_ids:
                placeholders=",".join("%s" for _ in image_ids)
                image_liked_ids={str(r["image_id"]) for r in conn.execute(f"SELECT image_id FROM square_likes WHERE user_id=%s AND image_id IN ({placeholders})",[user_id,*image_ids]).fetchall()}
            if prompt_ids:
                placeholders=",".join("%s" for _ in prompt_ids)
                prompt_liked_ids={str(r["prompt_id"]) for r in conn.execute(f"SELECT prompt_id FROM prompt_likes WHERE user_id=%s AND prompt_id IN ({placeholders})",[user_id,*prompt_ids]).fetchall()}
            image_map={}
            prompt_map={}
            if image_ids:
                placeholders=",".join("%s" for _ in image_ids)
                rows=conn.execute(f"SELECT si.*,u.username,u.nickname FROM square_images si JOIN users u ON si.user_id=u.id WHERE si.id IN ({placeholders}) AND COALESCE(si.is_frozen,FALSE)=FALSE",image_ids).fetchall()
                image_map={str(r["id"]):dict(r) for r in rows}
                for k,v in image_map.items():
                    v["is_liked"]=k in image_liked_ids
                    w,h=get_image_dimensions(str(GENERATED_IMAGES_DIR / v["filename"]))
                    v["width"]=w;v["height"]=h
            if prompt_ids:
                placeholders=",".join("%s" for _ in prompt_ids)
                rows=conn.execute(f"SELECT p.*,u.username,u.nickname,cat.label AS category_label FROM prompts p LEFT JOIN users u ON p.user_id=u.id LEFT JOIN categories cat ON p.category=cat.slug WHERE p.id IN ({placeholders}) AND COALESCE(p.is_frozen,FALSE)=FALSE",prompt_ids).fetchall()
                prompt_map={str(r["id"]):dict(r) for r in rows}
                for k,v in prompt_map.items():
                    v["is_liked"]=k in prompt_liked_ids
                    if v.get("image_path"):
                        w,h=get_image_dimensions(str(_get_evo_image_path(v["image_path"]) if "/" in str(v["image_path"]) else UPLOAD_DIR / v["image_path"]))
                        v["width"]=w;v["height"]=h
            images=[];prompts=[]
            for r in refs:
                tid=str(r["target_id"])
                if r["target_type"]=="image":
                    item=image_map.get(tid)
                    if item:
                        item["is_favorited"]=True
                        item["favorite_created_at"]=r["created_at"]
                        images.append(item)
                else:
                    item=prompt_map.get(tid)
                    if item:
                        item["is_favorited"]=True
                        item["favorite_created_at"]=r["created_at"]
                        prompts.append(item)
            return {"images":images,"prompts":prompts,"total":total,"page":page,"size":size}
