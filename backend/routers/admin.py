import json
from fastapi import APIRouter, HTTPException, Depends, Query
from backend.database import get_db
from backend.auth import require_admin
from backend.services.task_manager import TaskManager

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users")
async def list_users(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), admin=Depends(require_admin)):
    with get_db() as conn:
        offset = (page - 1) * size
        total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

        rows = conn.execute(
            """
            SELECT u.id, u.username, u.nickname, u.is_admin, u.is_frozen, u.last_ip, u.created_at,
                   COUNT(CASE WHEN ur.status = 'success' THEN 1 END) as success_count,
                   COUNT(CASE WHEN ur.status = 'failed' THEN 1 END) as failed_count,
                   COUNT(CASE WHEN ur.status = 'processing' THEN 1 END) as processing_count
            FROM users u
            LEFT JOIN user_requests ur ON u.id = ur.user_id
            GROUP BY u.id
            ORDER BY u.created_at DESC
            LIMIT ? OFFSET ?
            """,
            (size, offset),
        ).fetchall()

        users = []
        for row in rows:
            user = dict(row)
            # 获取最近一次请求时间
            last_request = conn.execute(
                "SELECT created_at FROM user_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
                (user["id"],),
            ).fetchone()
            user["last_request_at"] = last_request["created_at"] if last_request else None
            users.append(user)

        return {"users": users, "total": total}


@router.post("/users/{user_id}/freeze")
async def freeze_user(user_id: int, admin=Depends(require_admin)):
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="不能冻结自己")
    with get_db() as conn:
        user = conn.execute("SELECT id, is_frozen FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        new_status = 0 if user["is_frozen"] else 1
        conn.execute("UPDATE users SET is_frozen = ? WHERE id = ?", (new_status, user_id))
        return {"is_frozen": bool(new_status), "message": "已冻结" if new_status else "已启用"}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, admin=Depends(require_admin)):
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="不能删除自己")
    with get_db() as conn:
        user = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        conn.execute("DELETE FROM user_requests WHERE user_id = ?", (user_id,))
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


@router.get("/history")
async def list_history(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), admin=Depends(require_admin)):
    offset = (page - 1) * size
    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        rows = conn.execute(
            """
            SELECT t.task_id, t.type, t.status, t.params, t.created_at, t.updated_at,
                   t.result_urls, t.error, t.user_id,
                   u.username, u.nickname, u.last_ip
            FROM tasks t
            LEFT JOIN users u ON t.user_id = u.id
            ORDER BY t.updated_at DESC
            LIMIT ? OFFSET ?
            """,
            (size, offset),
        ).fetchall()

        items = []
        for row in rows:
            d = dict(row)
            try:
                params = json.loads(d.get("params") or "{}")
            except (json.JSONDecodeError, TypeError):
                params = {}
            d["prompt"] = params.get("prompt", "")
            d["size"] = params.get("size", "")
            d["params"] = params
            try:
                d["result_urls"] = json.loads(d.get("result_urls") or "[]")
            except (json.JSONDecodeError, TypeError):
                d["result_urls"] = []
            items.append(d)

        return {"items": items, "total": total}


@router.delete("/history/{task_id}")
async def delete_history(task_id: str, admin=Depends(require_admin)):
    success = TaskManager.delete_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"task_id": task_id, "message": "任务已删除"}
