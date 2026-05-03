from typing import Any, Dict, List, Optional
from backend.database import get_db

_ALLOWED_TYPES={"image","prompt"}

class FavoriteService:
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
                exists=conn.execute("SELECT id FROM square_images WHERE id=%s AND COALESCE(is_frozen,FALSE)=FALSE",(int(target_id),)).fetchone()
            else:
                exists=conn.execute("SELECT id FROM prompts WHERE id=%s AND COALESCE(is_frozen,FALSE)=FALSE",(str(target_id),)).fetchone()
            if not exists:raise ValueError("收藏目标不存在")
            conn.execute("INSERT INTO favorites(user_id,target_type,target_id) VALUES(%s,%s,%s)",(user_id,t,str(target_id)))
            return True

    @classmethod
    def get_flags(cls,user_id:int,target_type:str,target_ids:List[str])->set:
        if not user_id or not target_ids:return set()
        with get_db() as conn:
            placeholders=",".join("%s" for _ in target_ids)
            rows=conn.execute(f"SELECT target_id FROM favorites WHERE user_id=%s AND target_type=%s AND target_id IN ({placeholders})",[user_id,target_type,*[str(i) for i in target_ids]]).fetchall()
            return {str(r["target_id"]) for r in rows}

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
            image_map={}
            prompt_map={}
            if image_ids:
                placeholders=",".join("%s" for _ in image_ids)
                rows=conn.execute(f"SELECT si.*,u.username,u.nickname FROM square_images si JOIN users u ON si.user_id=u.id WHERE si.id IN ({placeholders}) AND COALESCE(si.is_frozen,FALSE)=FALSE",image_ids).fetchall()
                image_map={str(r["id"]):dict(r) for r in rows}
            if prompt_ids:
                placeholders=",".join("%s" for _ in prompt_ids)
                rows=conn.execute(f"SELECT p.*,u.username,u.nickname,cat.label AS category_label FROM prompts p LEFT JOIN users u ON p.user_id=u.id LEFT JOIN categories cat ON p.category=cat.slug WHERE p.id IN ({placeholders}) AND COALESCE(p.is_frozen,FALSE)=FALSE",prompt_ids).fetchall()
                prompt_map={str(r["id"]):dict(r) for r in rows}
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
