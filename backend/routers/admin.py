from fastapi import APIRouter, HTTPException, Depends, Query
from backend.database import get_db
from backend.auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users")
async def list_users(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), admin=Depends(require_admin)):
    with get_db() as conn:
        offset = (page - 1) * size
        total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        rows = conn.execute(
            "SELECT id, username, nickname, is_admin, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (size, offset),
        ).fetchall()
        return {"users": [dict(r) for r in rows], "total": total}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, admin=Depends(require_admin)):
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="不能删除自己")
    with get_db() as conn:
        user = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        conn.execute("DELETE FROM square_likes WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM square_images WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return {"message": "删除成功"}


@router.get("/square")
async def list_all_square(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), admin=Depends(require_admin)):
    with get_db() as conn:
        import json
        offset = (page - 1) * size
        total = conn.execute("SELECT COUNT(*) FROM square_images").fetchone()[0]
        rows = conn.execute(
            """
            SELECT si.*, u.username, u.nickname
            FROM square_images si
            JOIN users u ON si.user_id = u.id
            ORDER BY si.created_at DESC
            LIMIT ? OFFSET ?
            """,
            (size, offset),
        ).fetchall()
        images = []
        for row in rows:
            item = dict(row)
            item["metadata"] = json.loads(item["metadata"]) if item["metadata"] else None
            images.append(item)
        return {"images": images, "total": total}


@router.delete("/square/{image_id}")
async def delete_square_image(image_id: int, admin=Depends(require_admin)):
    with get_db() as conn:
        image = conn.execute("SELECT id FROM square_images WHERE id = ?", (image_id,)).fetchone()
        if not image:
            raise HTTPException(status_code=404, detail="图片不存在")
        conn.execute("DELETE FROM square_likes WHERE image_id = ?", (image_id,))
        conn.execute("DELETE FROM square_images WHERE id = ?", (image_id,))
        return {"message": "删除成功"}
