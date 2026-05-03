from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional
from backend.database import get_db
from backend.auth import get_current_user, get_optional_user
from backend.services.image_expiry import mark_image_permanent
from backend.services.favorite_service import FavoriteService

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
    sort: str = Query("likes", regex="^(likes|time)$"),
    user=Depends(get_optional_user),
):
    with get_db() as conn:
        offset = (page - 1) * size
        order = _SQUARE_ORDER_MAP.get(sort, _SQUARE_ORDER_MAP["likes"])
        if query:
            q = f"%{query}%"
            total = conn.execute(
                "SELECT COUNT(*) AS cnt FROM square_images si JOIN users u ON si.user_id = u.id WHERE si.is_frozen = FALSE AND (si.prompt LIKE %s OR u.username LIKE %s OR u.nickname LIKE %s)",
                (q, q, q),
            ).fetchone()["cnt"]
            rows = conn.execute(
                f"""
                SELECT si.*, u.username, u.nickname, u.avatar
                FROM square_images si
                JOIN users u ON si.user_id = u.id
                WHERE si.is_frozen = FALSE AND (si.prompt LIKE %s OR u.username LIKE %s OR u.nickname LIKE %s)
                ORDER BY {order}
                LIMIT %s OFFSET %s
                """,
                (q, q, q, size, offset),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) AS cnt FROM square_images si WHERE si.is_frozen = FALSE").fetchone()["cnt"]
            rows = conn.execute(
                f"""
                SELECT si.*, u.username, u.nickname, u.avatar
                FROM square_images si
                JOIN users u ON si.user_id = u.id
                WHERE si.is_frozen = FALSE
                ORDER BY {order}
                LIMIT %s OFFSET %s
                """,
                (size, offset),
            ).fetchall()

        image_ids = [str(r["id"]) for r in rows]
        liked_ids = set()
        favorited_ids = set()
        if user and image_ids:
            placeholders = ",".join("%s" for _ in image_ids)
            liked_rows = conn.execute(f"SELECT image_id FROM square_likes WHERE user_id = %s AND image_id IN ({placeholders})", [user["user_id"], *image_ids]).fetchall()
            liked_ids = {str(r["image_id"]) for r in liked_rows}
            favorited_ids = FavoriteService.get_flags(user["user_id"], "image", image_ids)
        images = []
        for row in rows:
            import json
            item = dict(row)
            if isinstance(item["metadata"], str):
                item["metadata"] = json.loads(item["metadata"]) if item["metadata"] else None
            item["is_liked"] = str(item["id"]) in liked_ids if user else False
            item["is_favorited"] = str(item["id"]) in favorited_ids if user else False
            images.append(item)

        return {"images": images, "total": total, "page": page, "size": size}


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
            "SELECT * FROM square_images WHERE user_id = %s ORDER BY created_at DESC LIMIT %s OFFSET %s",
            (user["user_id"], size, offset),
        ).fetchall()

        image_ids = [str(r["id"]) for r in rows]
        placeholders = ",".join("%s" for _ in image_ids) if image_ids else ""
        liked_ids = set()
        if image_ids:
            liked_rows = conn.execute(f"SELECT image_id FROM square_likes WHERE user_id = %s AND image_id IN ({placeholders})", [user["user_id"], *image_ids]).fetchall()
            liked_ids = {str(r["image_id"]) for r in liked_rows}
        favorited_ids = FavoriteService.get_flags(user["user_id"], "image", image_ids)
        import json
        images = []
        for row in rows:
            item = dict(row)
            if isinstance(item["metadata"], str):
                item["metadata"] = json.loads(item["metadata"]) if item["metadata"] else None
            item["is_liked"] = str(item["id"]) in liked_ids
            item["is_favorited"] = str(item["id"]) in favorited_ids
            images.append(item)

        return {"images": images, "total": total, "page": page, "size": size}
