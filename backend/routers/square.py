from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional
from backend.database import get_db
from backend.auth import get_current_user, get_optional_user

router = APIRouter(prefix="/api/square", tags=["square"])


class ShareRequest(BaseModel):
    filename: str
    prompt: Optional[str] = None
    metadata: Optional[dict] = None


@router.post("/share")
async def share_to_square(req: ShareRequest, user=Depends(get_current_user)):
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM square_images WHERE user_id = ? AND filename = ?",
            (user["user_id"], req.filename),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="该图片已分享到广场")

        import json
        cursor = conn.execute(
            "INSERT INTO square_images (user_id, filename, prompt, metadata) VALUES (?, ?, ?, ?)",
            (user["user_id"], req.filename, req.prompt, json.dumps(req.metadata) if req.metadata else None),
        )
        return {"id": cursor.lastrowid, "message": "分享成功"}


@router.get("")
async def list_square_images(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    query: str = Query(None),
    user=Depends(get_optional_user),
):
    with get_db() as conn:
        offset = (page - 1) * size
        if query:
            q = f"%{query}%"
            total = conn.execute(
                "SELECT COUNT(*) FROM square_images si JOIN users u ON si.user_id = u.id WHERE si.prompt LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?",
                (q, q, q),
            ).fetchone()[0]
            rows = conn.execute(
                """
                SELECT si.*, u.username, u.nickname, u.avatar
                FROM square_images si
                JOIN users u ON si.user_id = u.id
                WHERE si.prompt LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?
                ORDER BY si.created_at DESC
                LIMIT ? OFFSET ?
                """,
                (q, q, q, size, offset),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) FROM square_images").fetchone()[0]
            rows = conn.execute(
                """
                SELECT si.*, u.username, u.nickname, u.avatar
                FROM square_images si
                JOIN users u ON si.user_id = u.id
                ORDER BY si.created_at DESC
                LIMIT ? OFFSET ?
                """,
                (size, offset),
            ).fetchall()

        images = []
        for row in rows:
            import json
            item = dict(row)
            item["metadata"] = json.loads(item["metadata"]) if item["metadata"] else None
            item["is_liked"] = False
            if user:
                like = conn.execute(
                    "SELECT id FROM square_likes WHERE image_id = ? AND user_id = ?",
                    (item["id"], user["user_id"]),
                ).fetchone()
                item["is_liked"] = like is not None
            images.append(item)

        return {"images": images, "total": total, "page": page, "size": size}


@router.post("/like")
async def toggle_like(image_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        image = conn.execute("SELECT id FROM square_images WHERE id = ?", (image_id,)).fetchone()
        if not image:
            raise HTTPException(status_code=404, detail="图片不存在")

        existing = conn.execute(
            "SELECT id FROM square_likes WHERE image_id = ? AND user_id = ?",
            (image_id, user["user_id"]),
        ).fetchone()

        if existing:
            conn.execute("DELETE FROM square_likes WHERE id = ?", (existing["id"],))
            conn.execute(
                "UPDATE square_images SET likes_count = MAX(0, likes_count - 1) WHERE id = ?",
                (image_id,),
            )
            return {"liked": False, "message": "取消点赞"}
        else:
            conn.execute(
                "INSERT INTO square_likes (image_id, user_id) VALUES (?, ?)",
                (image_id, user["user_id"]),
            )
            conn.execute(
                "UPDATE square_images SET likes_count = likes_count + 1 WHERE id = ?",
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
            "SELECT COUNT(*) FROM square_images WHERE user_id = ?",
            (user["user_id"],),
        ).fetchone()[0]

        rows = conn.execute(
            "SELECT * FROM square_images WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (user["user_id"], size, offset),
        ).fetchall()

        import json
        images = []
        for row in rows:
            item = dict(row)
            item["metadata"] = json.loads(item["metadata"]) if item["metadata"] else None
            images.append(item)

        return {"images": images, "total": total, "page": page, "size": size}
