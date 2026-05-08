from fastapi import APIRouter, HTTPException, Depends, Query
import asyncio
import json
import logging
import re
from pydantic import BaseModel
from typing import Optional
from backend.database import get_db
from backend.auth import get_current_user, get_optional_user
from backend.services.image_expiry import mark_image_permanent
from backend.services.favorite_service import FavoriteService
from backend.services.classification_service import ClassificationService
from backend.services.content_audit_service import ContentAuditService
from backend.services.notification_service import NotificationService
from backend.services.title_generator import TitleGenerator
from backend.services.prompt_embedding_service import PromptEmbeddingService
from backend.config import GENERATED_IMAGES_DIR, EVO_IMAGES_DIR, EVO_IMPORTED_DIR
from backend.services.image_dimensions import get_image_dimensions


def _get_evo_image_path(image_path: str):
    p = EVO_IMPORTED_DIR / image_path
    if p.exists():
        return p
    return EVO_IMAGES_DIR / image_path

def _quick_title(prompt:str,filename:str)->str:
    s=str(prompt or "").strip().replace("\n"," ").replace("\r"," ")
    if s:
        for part in [x.strip() for x in re.split(r"[，,。；;、】【：:!?！？\s]+",s) if x.strip()]:
            part=re.sub(r"^(把|将|请|生成|制作|转化|设计|优化|提升|调整|改成|输出|做|用|让)\s*","",part)
            if 2<=len(part)<=10 and re.search(r"[\u4e00-\u9fff]",part) and not re.search(r"[A-Za-z]{3,}|\d",part):
                return part[:12]
        m=re.search(r"[\u4e00-\u9fff]{2,12}",s)
        if m:return m.group(0)[:12]
    f=str(filename or "").rsplit(".",1)[0].strip()
    return "广场作品" if not f else "广场作品"

router = APIRouter(prefix="/api/square", tags=["square"])
def _bg_task(coro):
    try:asyncio.create_task(coro)
    except Exception:logger.exception("后台任务创建失败")

_SQUARE_ORDER_MAP = {
    "likes": "si.likes_count DESC, si.id DESC",
    "time": "si.created_at DESC, si.id DESC",
}


class ShareRequest(BaseModel):
    filename: str
    prompt: Optional[str] = None
    metadata: Optional[dict] = None


@router.post("/share")
async def share_to_square(req: ShareRequest, user=Depends(get_current_user)):
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM square_images WHERE user_id = %s AND filename = %s",
            (user["user_id"], req.filename),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="该图片已分享到广场")

        cursor = conn.execute(
            "INSERT INTO square_images (user_id, filename, prompt, metadata) VALUES (%s, %s, %s, %s) RETURNING id",
            (user["user_id"], req.filename, req.prompt, json.dumps(req.metadata) if req.metadata else None),
        )
        mark_image_permanent(req.filename, conn=conn)
        image_id = cursor.fetchone()["id"]
        title = _quick_title(req.prompt or "", req.filename)
        row = conn.execute("SELECT metadata FROM square_images WHERE id = %s", (image_id,)).fetchone()
        meta = row["metadata"] if row else {}
        if isinstance(meta, str):
            try: meta = json.loads(meta) if meta else {}
            except Exception: meta = {}
        meta = meta if isinstance(meta, dict) else {}
        meta["title"] = title
        conn.execute("UPDATE square_images SET metadata = %s WHERE id = %s", (json.dumps(meta, ensure_ascii=False), image_id))
    _bg_task(_auto_square_postprocess(image_id, req.filename, req.prompt or "", str(user.get("username") or user.get("nickname") or ""), user["user_id"]))
    return {"id": image_id, "message": "分享成功"}

async def _auto_square_postprocess(image_id:int, filename:str, prompt:str, author:str, user_id:int):
    try:
        PromptEmbeddingService.upsert_square(image_id)
    except Exception:
        logger.exception("广场向量更新失败")
    try:
        title=await TitleGenerator.generate(prompt, filename)
        with get_db() as conn:
            row=conn.execute("SELECT metadata FROM square_images WHERE id = %s",(image_id,)).fetchone()
            if row:
                meta=row["metadata"]
                if isinstance(meta,str):
                    try:meta=json.loads(meta) if meta else {}
                    except Exception:meta={}
                meta=meta if isinstance(meta,dict) else {}
                meta["title"]=title
                conn.execute("UPDATE square_images SET metadata = %s WHERE id = %s",(json.dumps(meta,ensure_ascii=False),image_id))
    except Exception:
        logger.exception("广场标题生成失败")
        NotificationService.create(user_id, "square_auto_title_failed", "广场标题生成失败", f"作品 {filename} 中文标题生成失败，已保留原内容", str(image_id))
    try:
        await ClassificationService.auto_classify_single("image", str(image_id))
    except Exception:
        logger.exception("广场自动分类失败")
        NotificationService.create(user_id, "square_auto_classify_failed", "广场自动分类失败", f"作品 {filename} 自动分类失败，已保留原分享", str(image_id))
    try:
        audit=await ContentAuditService.auto_audit_single("image", str(image_id), prompt=prompt, author=author)
        if audit.get("risk_level")=="high":
            with get_db() as conn:
                conn.execute("DELETE FROM favorites WHERE target_type = 'image' AND target_id = %s", (str(image_id),))
                conn.execute("DELETE FROM square_likes WHERE image_id = %s", (image_id,))
                conn.execute("DELETE FROM square_images WHERE id = %s", (image_id,))
                from backend.services.image_expiry import refresh_permanent_flags_by_filenames
                refresh_permanent_flags_by_filenames([filename], conn=conn)
            try:
                PromptEmbeddingService.remove_item("image", image_id)
            except Exception:
                logger.exception("广场向量删除失败")
            NotificationService.create(user_id, "square_auto_high_risk", "广场内容高风险", f"作品 {filename} 命中高风险，已自动撤回分享", str(image_id))
        elif audit.get("risk_level") in ("medium","low") and audit.get("suggested_action") in ("review","keep","freeze","delete"):
            pass
    except Exception:
        logger.exception("广场自动审核失败")
        NotificationService.create(user_id, "square_auto_audit_failed", "广场自动审核失败", f"作品 {filename} 自动审核失败，已保留原分享", str(image_id))


@router.post("/unshare")
async def unshare_from_square(image_id: int = Query(...), user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, filename FROM square_images WHERE id = %s AND user_id = %s",
            (image_id, user["user_id"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="记录不存在或无权限")
        conn.execute("DELETE FROM favorites WHERE target_type = 'image' AND target_id = %s", (str(image_id),))
        conn.execute("DELETE FROM square_likes WHERE image_id = %s", (image_id,))
        conn.execute("DELETE FROM square_images WHERE id = %s", (image_id,))
        from backend.services.image_expiry import refresh_permanent_flags_by_filenames
        refresh_permanent_flags_by_filenames([row["filename"]], conn=conn)
        try:
            PromptEmbeddingService.remove_item("image", image_id)
        except Exception:
            logger.exception("广场向量删除失败")
        return {"message": "已撤回分享"}


@router.get("")
async def list_square_images(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    query: str = Query(None),
    author_id: int = Query(None),
    category: str = Query(None),
    sort: str = Query("likes", regex="^(likes|time)$"),
    user=Depends(get_optional_user),
):
    with get_db() as conn:
        offset = (page - 1) * size
        order = _SQUARE_ORDER_MAP.get(sort, _SQUARE_ORDER_MAP["likes"])
        where = ["si.is_frozen = FALSE"]
        params = []
        if author_id is not None:
            where.append("si.user_id = %s")
            params.append(author_id)
        if category:
            where.append("si.category = %s")
            params.append(category)
        if query:
            q = f"%{query}%"
            where.append("(si.prompt LIKE %s OR u.username LIKE %s OR u.nickname LIKE %s)")
            params.extend([q, q, q])
        where_sql = " AND ".join(where)
        total = conn.execute(f"SELECT COUNT(*) AS cnt FROM square_images si JOIN users u ON si.user_id = u.id WHERE {where_sql}", params).fetchone()["cnt"]
        rows = conn.execute(
            f"""
            SELECT si.*, u.username, u.nickname, u.avatar, cat.label AS category_label
            FROM square_images si
            JOIN users u ON si.user_id = u.id
            LEFT JOIN categories cat ON si.category = cat.slug
            WHERE {where_sql}
            ORDER BY {order}
            LIMIT %s OFFSET %s
            """,
            [*params, size, offset],
        ).fetchall()

        image_ids = [str(r["id"]) for r in rows]
        liked_ids = set()
        favorited_ids = set()
        if user and image_ids:
            favorited_ids = FavoriteService.get_flags(user["user_id"], "image", image_ids, conn=conn)
            placeholders = ",".join("%s" for _ in image_ids)
            liked_rows = conn.execute(f"SELECT image_id FROM square_likes WHERE user_id = %s AND image_id IN ({placeholders})", [user["user_id"], *image_ids]).fetchall()
            liked_ids = {str(r["image_id"]) for r in liked_rows}
        images = []
        for row in rows:
            import json
            item = dict(row)
            item["account"] = item.get("username", "")
            if isinstance(item["metadata"], str):
                item["metadata"] = json.loads(item["metadata"]) if item["metadata"] else None
            item["is_liked"] = str(item["id"]) in liked_ids if user else False
            item["is_favorited"] = str(item["id"]) in favorited_ids if user else False
            width,height=get_image_dimensions(str(GENERATED_IMAGES_DIR / item["filename"]))
            item["width"]=width
            item["height"]=height
            images.append(item)

        return {"images": images, "total": total, "page": page, "size": size}


@router.get("/shared")
async def list_shared_items(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
):
    with get_db() as conn:
        uid = user["user_id"]
        offset = (page - 1) * size
        total = conn.execute(
            """
            SELECT COUNT(*) AS cnt FROM (
                SELECT target_type, target_id FROM favorites WHERE user_id = %s
                UNION
                SELECT 'image' AS target_type, id::text AS target_id FROM square_images WHERE user_id = %s
            ) t
            """,
            (uid, uid),
        ).fetchone()["cnt"]
        refs = conn.execute(
            """
            SELECT target_type, target_id, sort_at, is_my_share, is_favorited FROM (
                SELECT target_type, target_id, MAX(sort_at) AS sort_at, BOOL_OR(is_my_share) AS is_my_share, BOOL_OR(is_favorited) AS is_favorited
                FROM (
                    SELECT f.target_type, f.target_id, f.created_at AS sort_at, FALSE AS is_my_share, TRUE AS is_favorited
                    FROM favorites f
                    WHERE f.user_id = %s
                    UNION ALL
                    SELECT 'image' AS target_type, si.id::text AS target_id, si.created_at AS sort_at, TRUE AS is_my_share,
                           EXISTS(SELECT 1 FROM favorites f WHERE f.user_id = %s AND f.target_type = 'image' AND f.target_id = si.id::text) AS is_favorited
                    FROM square_images si
                    WHERE si.user_id = %s
                ) s
                GROUP BY target_type, target_id
            ) t
            ORDER BY sort_at DESC, target_type DESC, target_id DESC
            LIMIT %s OFFSET %s
            """,
            (uid, uid, uid, size, offset),
        ).fetchall()
        image_ids = [int(r["target_id"]) for r in refs if r["target_type"] == "image" and str(r["target_id"]).isdigit()]
        prompt_ids = [str(r["target_id"]) for r in refs if r["target_type"] == "prompt"]
        image_liked_ids = set()
        prompt_liked_ids = set()
        if image_ids:
            placeholders = ",".join("%s" for _ in image_ids)
            image_liked_ids = {str(r["image_id"]) for r in conn.execute(f"SELECT image_id FROM square_likes WHERE user_id = %s AND image_id IN ({placeholders})", [uid, *image_ids]).fetchall()}
        if prompt_ids:
            placeholders = ",".join("%s" for _ in prompt_ids)
            prompt_liked_ids = {str(r["prompt_id"]) for r in conn.execute(f"SELECT prompt_id FROM prompt_likes WHERE user_id = %s AND prompt_id IN ({placeholders})", [uid, *prompt_ids]).fetchall()}
        image_map = {}
        prompt_map = {}
        if image_ids:
            placeholders = ",".join("%s" for _ in image_ids)
            rows = conn.execute(
                f"""
                SELECT si.*, u.username, u.nickname, u.avatar, cat.label AS category_label
                FROM square_images si
                JOIN users u ON si.user_id = u.id
                LEFT JOIN categories cat ON si.category = cat.slug
                WHERE si.id IN ({placeholders}) AND (si.user_id = %s OR COALESCE(si.is_frozen, FALSE) = FALSE)
                """,
                [*image_ids, uid],
            ).fetchall()
            for row in rows:
                import json
                item = dict(row)
                item["account"] = item.get("username", "")
                if isinstance(item["metadata"], str):
                    item["metadata"] = json.loads(item["metadata"]) if item["metadata"] else None
                item["is_liked"] = str(item["id"]) in image_liked_ids
                width,height=get_image_dimensions(str(GENERATED_IMAGES_DIR / item["filename"]))
                item["width"]=width
                item["height"]=height
                image_map[str(item["id"])] = item
        if prompt_ids:
            placeholders = ",".join("%s" for _ in prompt_ids)
            rows = conn.execute(
                f"""
                SELECT p.*, u.username, u.nickname, cat.label AS category_label
                FROM prompts p
                LEFT JOIN users u ON p.user_id = u.id
                LEFT JOIN categories cat ON p.category = cat.slug
                WHERE p.id IN ({placeholders}) AND COALESCE(p.is_frozen, FALSE) = FALSE
                """,
                prompt_ids,
            ).fetchall()
            for row in rows:
                item = dict(row)
                item["account"] = item.get("username", "")
                item["is_liked"] = str(item["id"]) in prompt_liked_ids
                if item.get("image_path"):
                    width,height=get_image_dimensions(str(_get_evo_image_path(item["image_path"]) if "/" in str(item["image_path"]) else UPLOAD_DIR / item["image_path"]))
                    item["width"]=width
                    item["height"]=height
                prompt_map[str(item["id"])] = item
        items = []
        for ref in refs:
            tid = str(ref["target_id"])
            item = image_map.get(tid) if ref["target_type"] == "image" else prompt_map.get(tid)
            if not item:
                continue
            item["is_favorited"] = bool(ref["is_favorited"])
            item["is_my_share"] = bool(ref["is_my_share"])
            item["mix_created_at"] = ref["sort_at"]
            item["_mix_type"] = ref["target_type"]
            items.append(item)
        return {"images": items, "total": total, "page": page, "size": size}


@router.post("/like")
async def toggle_like(image_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        image = conn.execute("SELECT id FROM square_images WHERE id = %s", (image_id,)).fetchone()
        if not image:
            raise HTTPException(status_code=404, detail="图片不存在")

        existing = conn.execute(
            "SELECT id FROM square_likes WHERE image_id = %s AND user_id = %s",
            (image_id, user["user_id"]),
        ).fetchone()

        if existing:
            conn.execute("DELETE FROM square_likes WHERE id = %s", (existing["id"],))
            conn.execute(
                "UPDATE square_images SET likes_count = GREATEST(0, likes_count - 1) WHERE id = %s",
                (image_id,),
            )
            return {"liked": False, "message": "取消点赞"}
        else:
            conn.execute(
                "INSERT INTO square_likes (image_id, user_id) VALUES (%s, %s)",
                (image_id, user["user_id"]),
            )
            conn.execute(
                "UPDATE square_images SET likes_count = likes_count + 1 WHERE id = %s",
                (image_id,),
            )
            return {"liked": True, "message": "点赞成功"}


@router.get("/my")
async def my_shares(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
):
    with get_db() as conn:
        offset = (page - 1) * size
        total = conn.execute(
            "SELECT COUNT(*) AS cnt FROM square_images WHERE user_id = %s",
            (user["user_id"],),
        ).fetchone()["cnt"]

        rows = conn.execute(
            "SELECT si.*, u.username, u.nickname, u.avatar, cat.label AS category_label FROM square_images si JOIN users u ON si.user_id = u.id LEFT JOIN categories cat ON si.category = cat.slug WHERE si.user_id = %s ORDER BY si.created_at DESC LIMIT %s OFFSET %s",
            (user["user_id"], size, offset),
        ).fetchall()

        image_ids = [str(r["id"]) for r in rows]
        placeholders = ",".join("%s" for _ in image_ids) if image_ids else ""
        liked_ids = set()
        if image_ids:
            favorited_ids = FavoriteService.get_flags(user["user_id"], "image", image_ids, conn=conn)
            liked_rows = conn.execute(f"SELECT image_id FROM square_likes WHERE user_id = %s AND image_id IN ({placeholders})", [user["user_id"], *image_ids]).fetchall()
            liked_ids = {str(r["image_id"]) for r in liked_rows}
        else:
            favorited_ids = set()
        import json
        images = []
        for row in rows:
            item = dict(row)
            item["account"] = item.get("username", "")
            if isinstance(item["metadata"], str):
                item["metadata"] = json.loads(item["metadata"]) if item["metadata"] else None
            item["is_liked"] = str(item["id"]) in liked_ids
            item["is_favorited"] = str(item["id"]) in favorited_ids
            width,height=get_image_dimensions(str(GENERATED_IMAGES_DIR / item["filename"]))
            item["width"]=width
            item["height"]=height
            images.append(item)

        return {"images": images, "total": total, "page": page, "size": size}
logger=logging.getLogger(__name__)
