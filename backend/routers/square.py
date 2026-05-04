from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional
from backend.database import get_db
from backend.auth import get_current_user, get_optional_user
from backend.services.image_expiry import mark_image_permanent
from backend.services.favorite_service import FavoriteService
from backend.config import GENERATED_IMAGES_DIR, EVO_IMAGES_DIR
from backend.services.image_dimensions import get_image_dimensions

router = APIRouter(prefix="/api/square", tags=["square"])

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

        import json
        cursor = conn.execute(
            "INSERT INTO square_images (user_id, filename, prompt, metadata) VALUES (%s, %s, %s, %s) RETURNING id",
            (user["user_id"], req.filename, req.prompt, json.dumps(req.metadata) if req.metadata else None),
        )
        mark_image_permanent(req.filename, conn=conn)
        return {"id": cursor.fetchone()["id"], "message": "分享成功"}


@router.post("/unshare")
async def unshare_from_square(image_id: int = Query(...), user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, filename FROM square_images WHERE id = %s AND user_id = %s",
            (image_id, user["user_id"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="记录不存在或无权限")
        conn.execute("DELETE FROM square_images WHERE id = %s", (image_id,))
        from backend.services.image_expiry import refresh_permanent_flags_by_filenames
        refresh_permanent_flags_by_filenames([row["filename"]], conn=conn)
        return {"message": "已撤回分享"}


@router.get("")
async def list_square_images(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    query: str = Query(None),
    author_id: int = Query(None),
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
        if query:
            q = f"%{query}%"
            where.append("(si.prompt LIKE %s OR u.username LIKE %s OR u.nickname LIKE %s)")
            params.extend([q, q, q])
        where_sql = " AND ".join(where)
        total = conn.execute(f"SELECT COUNT(*) AS cnt FROM square_images si JOIN users u ON si.user_id = u.id WHERE {where_sql}", params).fetchone()["cnt"]
        rows = conn.execute(
            f"""
            SELECT si.*, u.username, u.nickname, u.avatar
            FROM square_images si
            JOIN users u ON si.user_id = u.id
            WHERE {where_sql}
            ORDER BY {order}
            LIMIT %s OFFSET %s
            """,
            [*params, size, offset],
        ).fetchall()

        image_ids = [str(r["id"]) for r in rows]
        liked_ids = set()
        favorited_ids = set()
        fixed_ids = set()
        if user and image_ids:
            favorited_ids = FavoriteService.get_flags(user["user_id"], "image", image_ids, conn=conn)
            fixed_ids = FavoriteService.ensure_like_links(user["user_id"], "image", list(favorited_ids), conn=conn)
            placeholders = ",".join("%s" for _ in image_ids)
            liked_rows = conn.execute(f"SELECT image_id FROM square_likes WHERE user_id = %s AND image_id IN ({placeholders})", [user["user_id"], *image_ids]).fetchall()
            liked_ids = {str(r["image_id"]) for r in liked_rows} | fixed_ids
        images = []
        for row in rows:
            import json
            item = dict(row)
            if isinstance(item["metadata"], str):
                item["metadata"] = json.loads(item["metadata"]) if item["metadata"] else None
            if str(item["id"]) in fixed_ids:item["likes_count"]=(item.get("likes_count") or 0)+1
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
        favorited_image_ids = [str(r["target_id"]) for r in refs if r["target_type"] == "image" and r["is_favorited"]]
        favorited_prompt_ids = [str(r["target_id"]) for r in refs if r["target_type"] == "prompt" and r["is_favorited"]]
        image_fixed_ids = FavoriteService.ensure_like_links(uid, "image", favorited_image_ids, conn=conn) if favorited_image_ids else set()
        prompt_fixed_ids = FavoriteService.ensure_like_links(uid, "prompt", favorited_prompt_ids, conn=conn) if favorited_prompt_ids else set()
        image_liked_ids = set()
        prompt_liked_ids = set()
        if image_ids:
            placeholders = ",".join("%s" for _ in image_ids)
            image_liked_ids = {str(r["image_id"]) for r in conn.execute(f"SELECT image_id FROM square_likes WHERE user_id = %s AND image_id IN ({placeholders})", [uid, *image_ids]).fetchall()} | image_fixed_ids
        if prompt_ids:
            placeholders = ",".join("%s" for _ in prompt_ids)
            prompt_liked_ids = {str(r["prompt_id"]) for r in conn.execute(f"SELECT prompt_id FROM prompt_likes WHERE user_id = %s AND prompt_id IN ({placeholders})", [uid, *prompt_ids]).fetchall()} | prompt_fixed_ids
        image_map = {}
        prompt_map = {}
        if image_ids:
            placeholders = ",".join("%s" for _ in image_ids)
            rows = conn.execute(
                f"""
                SELECT si.*, u.username, u.nickname, u.avatar
                FROM square_images si
                JOIN users u ON si.user_id = u.id
                WHERE si.id IN ({placeholders}) AND (si.user_id = %s OR COALESCE(si.is_frozen, FALSE) = FALSE)
                """,
                [*image_ids, uid],
            ).fetchall()
            for row in rows:
                import json
                item = dict(row)
                if isinstance(item["metadata"], str):
                    item["metadata"] = json.loads(item["metadata"]) if item["metadata"] else None
                if str(item["id"]) in image_fixed_ids:item["likes_count"]=(item.get("likes_count") or 0)+1
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
                if str(item["id"]) in prompt_fixed_ids:item["likes_count"]=(item.get("likes_count") or 0)+1
                item["is_liked"] = str(item["id"]) in prompt_liked_ids
                if item.get("image_path"):
                    width,height=get_image_dimensions(str(EVO_IMAGES_DIR / item["image_path"]))
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
            "SELECT si.*, u.username, u.nickname, u.avatar FROM square_images si JOIN users u ON si.user_id = u.id WHERE si.user_id = %s ORDER BY si.created_at DESC LIMIT %s OFFSET %s",
            (user["user_id"], size, offset),
        ).fetchall()

        image_ids = [str(r["id"]) for r in rows]
        placeholders = ",".join("%s" for _ in image_ids) if image_ids else ""
        liked_ids = set()
        fixed_ids = set()
        if image_ids:
            favorited_ids = FavoriteService.get_flags(user["user_id"], "image", image_ids, conn=conn)
            fixed_ids = FavoriteService.ensure_like_links(user["user_id"], "image", list(favorited_ids), conn=conn)
            liked_rows = conn.execute(f"SELECT image_id FROM square_likes WHERE user_id = %s AND image_id IN ({placeholders})", [user["user_id"], *image_ids]).fetchall()
            liked_ids = {str(r["image_id"]) for r in liked_rows} | fixed_ids
        else:
            favorited_ids = set()
        import json
        images = []
        for row in rows:
            item = dict(row)
            if isinstance(item["metadata"], str):
                item["metadata"] = json.loads(item["metadata"]) if item["metadata"] else None
            if str(item["id"]) in fixed_ids:item["likes_count"]=(item.get("likes_count") or 0)+1
            item["is_liked"] = str(item["id"]) in liked_ids
            item["is_favorited"] = str(item["id"]) in favorited_ids
            width,height=get_image_dimensions(str(GENERATED_IMAGES_DIR / item["filename"]))
            item["width"]=width
            item["height"]=height
            images.append(item)

        return {"images": images, "total": total, "page": page, "size": size}
