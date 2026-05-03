import json
import os
import secrets
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Depends, Query
from backend.database import get_db
from backend.auth import require_admin, hash_password
from backend.services.task_manager import TaskManager
from backend.services.banned_words import BannedWordsService
from backend.services.image_mapping import ImageUrlMapping
from backend.services.points_service import PointsService
from backend.services.notification_service import NotificationService
from backend.services.image_expiry import refresh_permanent_flags_by_filenames

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger(__name__)
ACTIVE_TASK_TIMEOUT_MINUTES = 20

def _normalize_banned_word(word: str) -> str:
    return " ".join((word or "").replace("\u3000", " ").strip().split())


@router.get("/users")
async def list_users(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(None), admin=Depends(require_admin)):
    with get_db() as conn:
        conn.execute(
            """
            UPDATE tasks
            SET status='failed', error=COALESCE(NULLIF(error,''),'任务超时未完成'), completed_at=COALESCE(completed_at,NOW()), updated_at=NOW()
            WHERE LOWER(status) IN ('pending','queued','processing','running','generating')
              AND COALESCE(updated_at,created_at,NOW()) < NOW() - (%s || ' minutes')::interval
            """,
            (str(ACTIVE_TASK_TIMEOUT_MINUTES),),
        )
        offset = (page - 1) * size
        if query:
            q = f"%{query}%"
            total = conn.execute("SELECT COUNT(*) as cnt FROM users WHERE username LIKE %s OR nickname LIKE %s", (q, q)).fetchone()["cnt"]
            rows = conn.execute(
                """
                SELECT u.id, u.username, u.nickname, u.is_admin, u.is_frozen, u.points, u.last_ip, u.last_active, u.created_at,
                       COALESCE(img.cnt, 0) as success_count,
                       COUNT(CASE WHEN ur.status = 'failed' THEN 1 END) as failed_count,
                       COALESCE(proc.cnt, 0) as processing_count
                FROM users u
                LEFT JOIN user_requests ur ON u.id = ur.user_id
                LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM image_metadata GROUP BY user_id) img ON u.id = img.user_id
                LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM tasks WHERE LOWER(status) IN ('pending', 'queued', 'processing', 'running', 'generating') AND completed_at IS NULL AND COALESCE(updated_at,created_at,NOW()) >= NOW() - (%s || ' minutes')::interval GROUP BY user_id) proc ON u.id = proc.user_id
                WHERE u.username LIKE %s OR u.nickname LIKE %s
                GROUP BY u.id, img.cnt, proc.cnt
                ORDER BY u.last_active DESC
                LIMIT %s OFFSET %s
                """,
                (str(ACTIVE_TASK_TIMEOUT_MINUTES), q, q, size, offset),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) as cnt FROM users").fetchone()["cnt"]
            rows = conn.execute(
                """
                SELECT u.id, u.username, u.nickname, u.is_admin, u.is_frozen, u.points, u.last_ip, u.last_active, u.created_at,
                       COALESCE(img.cnt, 0) as success_count,
                       COUNT(CASE WHEN ur.status = 'failed' THEN 1 END) as failed_count,
                       COALESCE(proc.cnt, 0) as processing_count
                FROM users u
                LEFT JOIN user_requests ur ON u.id = ur.user_id
                LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM image_metadata GROUP BY user_id) img ON u.id = img.user_id
                LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM tasks WHERE LOWER(status) IN ('pending', 'queued', 'processing', 'running', 'generating') AND completed_at IS NULL AND COALESCE(updated_at,created_at,NOW()) >= NOW() - (%s || ' minutes')::interval GROUP BY user_id) proc ON u.id = proc.user_id
                GROUP BY u.id, img.cnt, proc.cnt
                ORDER BY u.last_active DESC
                LIMIT %s OFFSET %s
                """,
                (str(ACTIVE_TASK_TIMEOUT_MINUTES), size, offset),
            ).fetchall()

        users = []
        for row in rows:
            user = dict(row)
            user["is_admin"] = bool(user.get("is_admin"))
            user["is_frozen"] = bool(user.get("is_frozen"))
            # 获取最近一次请求时间
            last_request = conn.execute(
                "SELECT created_at FROM user_requests WHERE user_id = %s ORDER BY created_at DESC LIMIT 1",
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
        user = conn.execute("SELECT id, is_frozen FROM users WHERE id = %s", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        new_status = not user["is_frozen"]
        conn.execute("UPDATE users SET is_frozen = %s WHERE id = %s", (new_status, user_id))
        return {"is_frozen": bool(new_status), "message": "已冻结" if new_status else "已启用"}


@router.delete("/users/{user_id}")
@router.post("/users/{user_id}/delete")
async def delete_user(user_id: int, admin=Depends(require_admin)):
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="不能删除自己")
    with get_db() as conn:
        user = conn.execute("SELECT id FROM users WHERE id = %s", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        recharge_ids = [r["id"] for r in conn.execute("SELECT id FROM recharge_requests WHERE user_id = %s", (user_id,)).fetchall()]
        if recharge_ids:
            conn.execute("UPDATE point_transactions SET recharge_request_id = NULL WHERE recharge_request_id = ANY(%s)", (recharge_ids,))
            conn.execute("UPDATE redemption_codes SET recharge_request_id = NULL WHERE recharge_request_id = ANY(%s)", (recharge_ids,))
            conn.execute("DELETE FROM recharge_requests WHERE id = ANY(%s)", (recharge_ids,))
        conn.execute("UPDATE redemption_codes SET used_by = NULL, used_by_ip = '', used_at = NULL WHERE used_by = %s", (user_id,))
        prompt_ids = [r["id"] for r in conn.execute("SELECT id FROM prompts WHERE user_id = %s", (user_id,)).fetchall()]
        if prompt_ids:
            conn.execute("DELETE FROM prompt_likes WHERE prompt_id = ANY(%s)", (prompt_ids,))
        square_rows = conn.execute("SELECT id,filename FROM square_images WHERE user_id = %s", (user_id,)).fetchall()
        square_image_ids = [r["id"] for r in square_rows]
        square_filenames = [r["filename"] for r in square_rows]
        if square_image_ids:
            conn.execute("DELETE FROM square_likes WHERE image_id = ANY(%s)", (square_image_ids,))
        conn.execute("DELETE FROM upload_files WHERE owner_id = %s", (user_id,))
        conn.execute("DELETE FROM image_metadata WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM tasks WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM prompts WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM user_requests WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM square_likes WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM prompt_likes WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM announcement_reads WHERE user_id = %s", (user_id,))
        conn.execute("UPDATE announcements SET created_by = %s WHERE created_by = %s", (admin["user_id"], user_id))
        conn.execute("DELETE FROM auth_refresh_tokens WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM square_images WHERE user_id = %s", (user_id,))
        if square_filenames:
            refresh_permanent_flags_by_filenames(square_filenames, conn=conn)
        conn.execute("DELETE FROM point_transactions WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM daily_checkins WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM users WHERE id = %s", (user_id,))
        return {"message": "删除成功"}


@router.get("/square")
async def list_all_square(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(None), status: str = Query("all"), admin=Depends(require_admin)):
    with get_db() as conn:
        import json
        offset = (page - 1) * size
        where = []
        params = []
        if query:
            q = f"%{query}%"
            where.append("(si.prompt LIKE %s OR u.username LIKE %s OR u.nickname LIKE %s)")
            params.extend([q, q, q])
        if status == "frozen":
            where.append("si.is_frozen = TRUE")
        elif status == "active":
            where.append("si.is_frozen = FALSE")
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""

        total = conn.execute(
            f"SELECT COUNT(*) as cnt FROM square_images si JOIN users u ON si.user_id = u.id {where_sql}",
            params,
        ).fetchone()["cnt"]
        rows = conn.execute(
            f"""
            SELECT si.*, u.username, u.nickname
            FROM square_images si
            JOIN users u ON si.user_id = u.id
            {where_sql}
            ORDER BY si.created_at DESC, si.id DESC
            LIMIT %s OFFSET %s
            """,
            params + [size, offset],
        ).fetchall()
        images = []
        for row in rows:
            item = dict(row)
            meta = item["metadata"]
            item["metadata"] = json.loads(meta) if isinstance(meta, str) else meta
            item["is_frozen"] = bool(item.get("is_frozen"))
            images.append(item)
        return {"images": images, "total": total}


@router.post("/square/freeze")
async def batch_freeze_square(body: dict, admin=Depends(require_admin)):
    ids = body.get("ids", [])
    frozen = body.get("frozen", True)
    if not ids:
        raise HTTPException(status_code=400, detail="未提供要操作的ID")
    ids = [int(i) for i in ids]
    with get_db() as conn:
        conn.execute("UPDATE square_images SET is_frozen = %s WHERE id = ANY(%s)", [frozen, ids])
        return {"message": f"已{'冻结' if frozen else '解冻'} {len(ids)} 张图片", "updated": len(ids)}


@router.post("/square/batch-delete")
async def batch_delete_square(body: dict, admin=Depends(require_admin)):
    ids = body.get("ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="未提供要删除的ID")
    ids = [int(i) for i in ids]
    with get_db() as conn:
        rows = conn.execute("SELECT filename FROM square_images WHERE id = ANY(%s)", (ids,)).fetchall()
        filenames = [r["filename"] for r in rows]
        conn.execute("DELETE FROM square_likes WHERE image_id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM square_images WHERE id = ANY(%s)", (ids,))
        if filenames:
            refresh_permanent_flags_by_filenames(filenames, conn=conn)
        return {"message": f"已删除 {len(ids)} 张图片", "deleted": len(ids)}


@router.delete("/square/{image_id}")
@router.post("/square/{image_id}/delete")
async def delete_square_image(image_id: int, admin=Depends(require_admin)):
    with get_db() as conn:
        image = conn.execute("SELECT id FROM square_images WHERE id = %s", (image_id,)).fetchone()
        if not image:
            raise HTTPException(status_code=404, detail="图片不存在")
        row = conn.execute("SELECT filename FROM square_images WHERE id = %s", (image_id,)).fetchone()
        conn.execute("DELETE FROM square_likes WHERE image_id = %s", (image_id,))
        conn.execute("DELETE FROM square_images WHERE id = %s", (image_id,))
        if row:
            refresh_permanent_flags_by_filenames([row["filename"]], conn=conn)
        return {"message": "删除成功"}


@router.get("/history")
async def list_history(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(None), admin=Depends(require_admin)):
    offset = (page - 1) * size
    with get_db() as conn:
        if query:
            q = f"%{query}%"
            total = conn.execute(
                "SELECT COUNT(*) as cnt FROM tasks t LEFT JOIN users u ON t.user_id = u.id WHERE t.params::text LIKE %s OR u.username LIKE %s OR u.nickname LIKE %s",
                (q, q, q),
            ).fetchone()["cnt"]
            summary_rows = conn.execute(
                """
                SELECT LOWER(COALESCE(t.status, 'pending')) AS status, COUNT(*) AS cnt
                FROM tasks t
                LEFT JOIN users u ON t.user_id = u.id
                WHERE t.params::text LIKE %s OR u.username LIKE %s OR u.nickname LIKE %s
                GROUP BY LOWER(COALESCE(t.status, 'pending'))
                """,
                (q, q, q),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) as cnt FROM tasks").fetchone()["cnt"]
            rows = conn.execute(
                """
                SELECT t.task_id, t.type, t.status, t.params, t.created_at, t.updated_at,
                       t.started_at, t.completed_at, t.result_urls, t.error, t.user_id,
                       u.username, u.nickname, u.last_ip, t.points_cost, t.points_balance_after
                FROM tasks t
                LEFT JOIN users u ON t.user_id = u.id
                ORDER BY t.updated_at DESC
                LIMIT %s OFFSET %s
                """,
                (size, offset),
            ).fetchall()
            summary_rows = conn.execute(
                """
                SELECT LOWER(COALESCE(status, 'pending')) AS status, COUNT(*) AS cnt
                FROM tasks
                GROUP BY LOWER(COALESCE(status, 'pending'))
                """
            ).fetchall()
        if query:
            rows = conn.execute(
                """
                SELECT t.task_id, t.type, t.status, t.params, t.created_at, t.updated_at,
                       t.started_at, t.completed_at, t.result_urls, t.error, t.user_id,
                       u.username, u.nickname, u.last_ip, t.points_cost, t.points_balance_after
                FROM tasks t
                LEFT JOIN users u ON t.user_id = u.id
                WHERE t.params::text LIKE %s OR u.username LIKE %s OR u.nickname LIKE %s
                ORDER BY t.updated_at DESC
                LIMIT %s OFFSET %s
                """,
                (q, q, q, size, offset),
            ).fetchall()

        items = []
        for row in rows:
            d = dict(row)
            raw_params = d.get("params")
            if isinstance(raw_params, dict):
                params = raw_params
            elif isinstance(raw_params, str):
                try:
                    params = json.loads(raw_params or "{}")
                except (json.JSONDecodeError, TypeError):
                    params = {}
            else:
                params = {}
            d["prompt"] = params.get("prompt", "")
            d["size"] = params.get("size", "")
            d["params"] = params
            try:
                d["result_urls"] = json.loads(d.get("result_urls") or "[]")
            except (json.JSONDecodeError, TypeError):
                d["result_urls"] = []
            items.append(d)
        summary = {"total": int(total or 0), "pending": 0, "queued": 0, "processing": 0, "running": 0, "generating": 0, "completed": 0, "failed": 0}
        for r in summary_rows:
            s = str(r.get("status") or "pending").lower()
            if s in summary:
                summary[s] = int(r.get("cnt") or 0)
        return {"items": items, "total": total, "summary": summary}


@router.delete("/history/{task_id}")
@router.post("/history/{task_id}/delete")
async def delete_history(task_id: str, admin=Depends(require_admin)):
    success = TaskManager.delete_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"task_id": task_id, "message": "任务已删除"}


# ============ 图床管理 ============

def _format_size(size_bytes):
    for unit in ("B", "KB", "MB", "GB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def _get_local_file_size(local_path):
    """获取本地文件大小，不存在返回0"""
    try:
        import os
        if os.path.exists(local_path):
            return os.path.getsize(local_path)
    except Exception:
        pass
    return 0


@router.get("/hosting/stats")
async def get_hosting_stats(admin=Depends(require_admin)):
    mapping = ImageUrlMapping.load_mapping()
    total_count = len(mapping)
    total_size = sum(_get_local_file_size(p) for p in mapping.keys())
    return {
        "total_count": total_count,
        "total_size": total_size,
        "total_size_fmt": _format_size(total_size),
    }


@router.get("/hosting")
async def list_hosting_images(page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=200), admin=Depends(require_admin)):
    mapping = ImageUrlMapping.load_mapping()
    items = []
    for local_path, url in mapping.items():
        filename = os.path.basename(local_path)
        file_size = _get_local_file_size(local_path)
        items.append({
            "filename": filename,
            "local_path": local_path,
            "url": url,
            "size": file_size,
            "size_fmt": _format_size(file_size),
            "exists": os.path.exists(local_path),
        })
    items.reverse()
    total = len(items)
    start = (page - 1) * size
    page_items = items[start:start + size]
    return {"items": page_items, "total": total, "page": page, "size": size}


@router.post("/hosting/batch-delete")
async def batch_delete_hosting(body: dict, admin=Depends(require_admin)):
    urls = body.get("urls", [])
    if not urls:
        raise HTTPException(status_code=400, detail="未提供要删除的URL")

    # 获取删除token
    tokens = ImageUrlMapping.get_delete_tokens(urls)

    # 删除图床上的图片
    from backend.services.image_hosting import ImageHostingService
    deleted_hosting = 0
    for url, token in tokens.items():
        if token:
            try:
                success = await ImageHostingService.delete_image(token)
                if success:
                    deleted_hosting += 1
            except Exception:
                pass

    # 删除映射记录
    count = ImageUrlMapping.delete_urls(urls)
    return {"deleted": count, "deleted_hosting": deleted_hosting}


@router.post("/hosting/clean-duplicates")
async def clean_duplicate_hosting(admin=Depends(require_admin)):
    """清理重复的图床映射，基于URL去重"""
    with get_db() as conn:
        # 找出重复的URL（保留id最小的，删除其他的）
        duplicates = conn.execute("""
            SELECT url, COUNT(*) as cnt, MIN(id) as keep_id
            FROM image_mappings
            GROUP BY url
            HAVING cnt > 1
        """).fetchall()

        deleted = 0
        for row in duplicates:
            url = row["url"]
            keep_id = row["keep_id"]
            # 删除除keep_id以外的所有重复记录
            cur = conn.execute("DELETE FROM image_mappings WHERE url = %s AND id != %s", (url, keep_id))
            deleted += cur.rowcount

        return {"deleted": deleted, "duplicate_urls": len(duplicates)}


# ============ 违禁词管理 ============

@router.get("/banned-words")
async def list_banned_words(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(None), admin=Depends(require_admin)):
    return BannedWordsService.list_words(page, size, query)


@router.post("/banned-words")
async def add_banned_word(body: dict, admin=Depends(require_admin)):
    word = _normalize_banned_word(body.get("word", ""))
    if not word:
        raise HTTPException(status_code=400, detail="违禁词不能为空")
    if len(word) < 2:
        raise HTTPException(status_code=400, detail="违禁词至少2个字符")
    if len(word) > 50:
        raise HTTPException(status_code=400, detail="违禁词长度不能超过50个字符")
    if not BannedWordsService.add(word):
        raise HTTPException(status_code=400, detail="该违禁词已存在")
    return {"message": "添加成功"}


@router.delete("/banned-words/{word_id}")
@router.post("/banned-words/{word_id}/delete")
async def delete_banned_word(word_id: int, admin=Depends(require_admin)):
    if not BannedWordsService.remove(word_id):
        raise HTTPException(status_code=404, detail="违禁词不存在")
    return {"message": "删除成功"}


@router.post("/banned-words/batch-import")
async def batch_import_banned_words(body: dict, admin=Depends(require_admin)):
    text = body.get("text", "")
    if not text.strip():
        raise HTTPException(status_code=400, detail="内容不能为空")
    words = [_normalize_banned_word(line) for line in text.splitlines()]
    words = [w for w in words if 2 <= len(w) <= 50]
    if not words:
        raise HTTPException(status_code=400, detail="未解析到有效违禁词")
    result = BannedWordsService.batch_add(words)
    return {"message": f"导入完成：新增 {result['added']} 个，跳过 {result['skipped']} 个", **result}


# ============ 提示词管理 ============

@router.get("/prompts")
async def list_all_prompts(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(None), category: str = Query(None), status: str = Query("all"), admin=Depends(require_admin)):
    offset = (page - 1) * size
    with get_db() as conn:
        where = ["p.user_id IS NULL"]
        params = []
        if query:
            q = f"%{query}%"
            where.append("(p.name LIKE %s OR p.prompt LIKE %s OR u.username LIKE %s OR u.nickname LIKE %s)")
            params.extend([q, q, q, q])
        if category:
            where.append("p.category = %s")
            params.append(category)
        if status == "frozen":
            where.append("COALESCE(p.is_frozen, FALSE) = TRUE")
        elif status == "active":
            where.append("COALESCE(p.is_frozen, FALSE) = FALSE")
        where_sql = "WHERE " + " AND ".join(where)
        total = conn.execute(f"SELECT COUNT(*) as cnt FROM prompts p LEFT JOIN users u ON p.user_id = u.id {where_sql}", params).fetchone()["cnt"]
        rows = conn.execute(
            f"""
            SELECT p.*, u.username, u.nickname
            FROM prompts p
            LEFT JOIN users u ON p.user_id = u.id
            {where_sql}
            ORDER BY p.created_at DESC, p.id DESC
            LIMIT %s OFFSET %s
            """,
            params + [size, offset],
        ).fetchall()
        items = []
        for row in rows:
            d = dict(row)
            try:
                d["tags"] = json.loads(d.get("tags") or "[]")
            except (json.JSONDecodeError, TypeError):
                d["tags"] = []
            d["is_frozen"] = bool(d.get("is_frozen"))
            items.append(d)
        return {"items": items, "total": total}


@router.post("/prompts/freeze")
async def batch_freeze_prompts(body: dict, admin=Depends(require_admin)):
    ids = body.get("ids", [])
    frozen = body.get("frozen", True)
    if not ids:
        raise HTTPException(status_code=400, detail="未提供要操作的ID")
    ids = [str(i) for i in ids]
    with get_db() as conn:
        conn.execute("UPDATE prompts SET is_frozen = %s WHERE id = ANY(%s)", (frozen, ids))
        return {"message": f"已{'冻结' if frozen else '解冻'} {len(ids)} 条提示词", "updated": len(ids), "frozen": bool(frozen)}


@router.delete("/prompts/{prompt_id}")
@router.post("/prompts/{prompt_id}/delete")
async def delete_prompt(prompt_id: str, admin=Depends(require_admin)):
    with get_db() as conn:
        prompt = conn.execute("SELECT id FROM prompts WHERE id = %s", (prompt_id,)).fetchone()
        if not prompt:
            raise HTTPException(status_code=404, detail="提示词不存在")
        conn.execute("DELETE FROM prompt_likes WHERE prompt_id = %s", (prompt_id,))
        conn.execute("DELETE FROM prompts WHERE id = %s", (prompt_id,))
        return {"message": "删除成功"}


@router.post("/prompts/batch-delete")
async def batch_delete_prompts(body: dict, admin=Depends(require_admin)):
    ids = body.get("ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="未提供要删除的ID")
    ids = [str(i) for i in ids]
    with get_db() as conn:
        conn.execute("DELETE FROM prompt_likes WHERE prompt_id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM prompts WHERE id = ANY(%s)", (ids,))
        return {"message": f"已删除 {len(ids)} 条提示词"}


# ============ 兑换码管理 ============

@router.get("/codes")
async def list_codes(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), sort: str = Query("created_at"), order: str = Query("desc"), admin=Depends(require_admin)):
    allowed_sorts = {"created_at", "is_used", "points"}
    if sort not in allowed_sorts:
        sort = "created_at"
    order_dir = "ASC" if order.lower() == "asc" else "DESC"
    offset = (page - 1) * size
    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) as cnt FROM redemption_codes").fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT rc.*, u.username as used_by_name,
                rr.id as recharge_id, rr.channel as recharge_channel, rr.amount as recharge_amount,
                rr.tx_no as recharge_tx_no, rr.status as recharge_status, rr.review_note as recharge_review_note,
                rr.proof_url as recharge_proof_url, rr.payer_name as recharge_payer_name, rr.remark as recharge_remark,
                ru.username as recharge_username, ru.nickname as recharge_nickname
                FROM redemption_codes rc
                LEFT JOIN users u ON rc.used_by = u.id
                LEFT JOIN recharge_requests rr ON rc.recharge_request_id = rr.id
                LEFT JOIN users ru ON rr.user_id = ru.id
                ORDER BY rc.{sort} {order_dir}
                LIMIT %s OFFSET %s""",
            (size, offset),
        ).fetchall()
        return {"items": [dict(r) for r in rows], "total": total, "page": page, "size": size}


@router.post("/codes")
async def generate_codes(body: dict, admin=Depends(require_admin)):
    count = body.get("count", 1)
    points = body.get("points")
    custom_code = body.get("custom_code", "").strip().upper()
    if not points or points <= 0:
        raise HTTPException(status_code=400, detail="积分额度必须大于 0")
    if count < 1 or count > 100:
        raise HTTPException(status_code=400, detail="数量范围 1-100")
    if custom_code and len(custom_code) > 20:
        raise HTTPException(status_code=400, detail="自定义兑换码长度不能超过 20")
    with get_db() as conn:
        if custom_code:
            existing = conn.execute("SELECT id FROM redemption_codes WHERE code = %s", (custom_code,)).fetchone()
            if existing:
                raise HTTPException(status_code=400, detail="兑换码已存在")
            conn.execute("INSERT INTO redemption_codes (code, points) VALUES (%s, %s)", (custom_code, points))
            return {"generated": 1, "codes": [custom_code]}
        codes = []
        for _ in range(count):
            while True:
                code = secrets.token_urlsafe(8).upper()
                if not conn.execute("SELECT id FROM redemption_codes WHERE code = %s", (code,)).fetchone():
                    break
            conn.execute("INSERT INTO redemption_codes (code, points) VALUES (%s, %s)", (code, points))
            codes.append(code)
        return {"generated": len(codes), "codes": codes}


@router.delete("/codes/{code_id}")
@router.post("/codes/{code_id}/delete")
async def delete_code(code_id: int, admin=Depends(require_admin)):
    with get_db() as conn:
        row = conn.execute("SELECT id, is_used FROM redemption_codes WHERE id = %s", (code_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="兑换码不存在")
        if row["is_used"]:
            raise HTTPException(status_code=400, detail="已使用的兑换码不能删除")
        conn.execute("DELETE FROM redemption_codes WHERE id = %s", (code_id,))
    return {"message": "删除成功"}


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(user_id: int, body: dict, admin=Depends(require_admin)):
    new_password = (body.get("password") or "").strip()
    if not new_password or len(new_password) < 6:
        raise HTTPException(status_code=400, detail="密码长度至少6位")
    if len(new_password) > 50:
        raise HTTPException(status_code=400, detail="密码长度不能超过50位")
    with get_db() as conn:
        user = conn.execute("SELECT id FROM users WHERE id = %s", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        password_hash = await hash_password(new_password)
        conn.execute("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id))
    return {"message": "密码重置成功"}


@router.post("/users/{user_id}/points")
async def adjust_points(user_id: int, body: dict, admin=Depends(require_admin)):
    amount = body.get("amount", 0)
    description = body.get("description", "管理员调整")
    if amount == 0:
        raise HTTPException(status_code=400, detail="积分调整量不能为 0")
    with get_db() as conn:
        user = conn.execute("SELECT id FROM users WHERE id = %s", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
    if amount > 0:
        new_balance = PointsService.add_points(user_id, amount, "admin_grant", description)
    else:
        new_balance = PointsService.consume(user_id, -amount, description)
    return {"message": "调整成功", "points": new_balance}


@router.post("/migrate-points")
async def migrate_points(admin=Depends(require_admin)):
    result = PointsService.migrate_existing_users()
    return {"message": f"已为 {result['migrated']} 个用户补发积分", **result}


# ============ 人工充值审核 ============

@router.get("/recharge-requests")
async def list_recharge_requests(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), status: str = Query("all"), query: str = Query(None), sort: str = Query("created_at"), order: str = Query("desc"), admin=Depends(require_admin)):
    offset = (page - 1) * size
    where = []
    params = []
    if status in {"pending", "approved", "rejected"}:
        where.append("rr.status = %s")
        params.append(status)
    if query:
        q = f"%{query}%"
        where.append("(u.username LIKE %s OR u.nickname LIKE %s OR rr.tx_no LIKE %s)")
        params.extend([q, q, q])
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    allowed_sort = {"created_at", "amount", "points", "status"}
    sort_field = f"rr.{sort}" if sort in allowed_sort else "rr.created_at"
    sort_order = "ASC" if order == "asc" else "DESC"
    with get_db() as conn:
        total = conn.execute(
            f"""SELECT COUNT(*) as cnt FROM recharge_requests rr
                LEFT JOIN users u ON rr.user_id = u.id
                {where_sql}""",
            params,
        ).fetchone()["cnt"]
        rows = conn.execute(
            f"""SELECT rr.*, u.username, u.nickname, au.username as reviewed_by_name
                FROM recharge_requests rr
                LEFT JOIN users u ON rr.user_id = u.id
                LEFT JOIN users au ON rr.reviewed_by = au.id
                {where_sql}
                ORDER BY {sort_field} {sort_order}
                LIMIT %s OFFSET %s""",
            params + [size, offset],
        ).fetchall()
        return {"items": [dict(r) for r in rows], "total": total, "page": page, "size": size}


@router.post("/recharge-requests/{request_id}/approve")
async def approve_recharge_request(request_id: int, body: dict, admin=Depends(require_admin)):
    review_note = (body.get("review_note") or "").strip()[:500]
    with get_db() as conn:
        row = conn.execute("SELECT * FROM recharge_requests WHERE id = %s", (request_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="充值申请不存在")
        item = dict(row)
        if item["status"] == "approved":
            return {"message": "该申请已审核通过", "code": item.get("redeem_code"), "points": item.get("points")}
        if item["status"] != "pending":
            raise HTTPException(status_code=400, detail="仅待审核申请可通过")
        points = int(body.get("points") or item["points"])
        if points <= 0:
            raise HTTPException(status_code=400, detail="发放积分必须大于0")
        user_id = item["user_id"]
        while True:
            code = secrets.token_urlsafe(8).upper()
            if not conn.execute("SELECT id FROM redemption_codes WHERE code = %s", (code,)).fetchone():
                break
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute("INSERT INTO redemption_codes (code, points, recharge_request_id) VALUES (%s, %s, %s)", (code, points, request_id))
        code_id = conn.execute("SELECT id FROM redemption_codes WHERE code = %s", (code,)).fetchone()["id"]
        conn.execute(
            "UPDATE redemption_codes SET is_used = true, used_by = %s, used_at = %s WHERE id = %s",
            (user_id, now, code_id),
        )
        conn.execute("UPDATE users SET points = points + %s WHERE id = %s", (points, user_id))
        new_balance = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()["points"]
        conn.execute(
            "INSERT INTO point_transactions (user_id, amount, balance_after, type, description, recharge_request_id, request_key) VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
            (user_id, points, new_balance, "redeem_code", f"充值审核通过 (¥{item['amount']})", request_id, f"recharge-approve:{request_id}"),
        )
        conn.execute(
            "UPDATE recharge_requests SET status = 'approved', points = %s, redeem_code = %s, review_note = %s, reviewed_at = %s, reviewed_by = %s WHERE id = %s",
            (points, code, review_note, now, admin["user_id"], request_id),
        )
        try:
            NotificationService.create(user_id, "recharge_approved", "充值审核通过", f"你的充值申请已通过，到账 {points} 积分", str(request_id))
        except Exception:
            pass
        logger.info(f"[audit.recharge.approve] request={request_id} admin={admin['user_id']} user={user_id} points={points} amount={item['amount']}")
        return {"message": "审核通过，积分已发放", "code": code, "points": points}


@router.post("/recharge-requests/{request_id}/reject")
async def reject_recharge_request(request_id: int, body: dict, admin=Depends(require_admin)):
    review_note = (body.get("review_note") or "").strip()[:500]
    if not review_note:
        raise HTTPException(status_code=400, detail="拒绝原因不能为空")
    with get_db() as conn:
        row = conn.execute("SELECT status FROM recharge_requests WHERE id = %s", (request_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="充值申请不存在")
        if row["status"] != "pending":
            raise HTTPException(status_code=400, detail="仅待审核申请可拒绝")
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "UPDATE recharge_requests SET status = 'rejected', review_note = %s, reviewed_at = %s, reviewed_by = %s WHERE id = %s",
            (review_note, now, admin["user_id"], request_id),
        )
        user_row = conn.execute("SELECT user_id FROM recharge_requests WHERE id = %s", (request_id,)).fetchone()
        if user_row:
            try:
                NotificationService.create(user_row["user_id"], "recharge_rejected", "充值审核未通过", f"你的充值申请未通过：{review_note}", str(request_id))
            except Exception:
                pass
        logger.info(f"[audit.recharge.reject] request={request_id} admin={admin['user_id']} reason={review_note[:120]}")
        return {"message": "已拒绝该充值申请"}


@router.get("/stats/overview")
async def admin_stats_overview(time_range: str = Query("7d", alias="range"), admin=Depends(require_admin)):
    from datetime import timedelta as _td
    now = datetime.now()
    today_start = datetime(now.year, now.month, now.day)
    start_dt = today_start - _td(days=6)
    if time_range == "all":
        with get_db() as conn:
            first_row = conn.execute(
                """
                SELECT MIN(ts) AS first_ts FROM (
                    SELECT MIN(created_at) AS ts FROM user_requests
                    UNION ALL SELECT MIN(created_at) AS ts FROM image_metadata
                    UNION ALL SELECT MIN(created_at) AS ts FROM users
                    UNION ALL SELECT MIN(created_at) AS ts FROM tasks
                    UNION ALL SELECT MIN(created_at) AS ts FROM recharge_requests
                ) t
                """
            ).fetchone()
            first_ts = first_row["first_ts"] if first_row else None
        if first_ts:
            start_dt = datetime(first_ts.year, first_ts.month, first_ts.day)
    elif time_range == "today":
        start_dt = today_start
    elif time_range == "30d":
        start_dt = today_start - _td(days=29)
    elif time_range == "7d":
        start_dt = today_start - _td(days=6)
    else:
        time_range = "7d"
        start_dt = today_start - _td(days=6)
    end_dt = now
    start_s = start_dt.strftime("%Y-%m-%d %H:%M:%S")
    end_s = end_dt.strftime("%Y-%m-%d %H:%M:%S")
    t7_start = (today_start - _td(days=6)).strftime("%Y-%m-%d %H:%M:%S")
    t30_start = (today_start - _td(days=29)).strftime("%Y-%m-%d %H:%M:%S")
    d30 = [(today_start - _td(days=i)).strftime("%Y-%m-%d") for i in range(29, -1, -1)]
    with get_db() as conn:
        req = conn.execute("SELECT COUNT(*) cnt FROM user_requests WHERE created_at >= %s AND created_at <= %s", (start_s, end_s)).fetchone()["cnt"]
        suc = conn.execute("SELECT COUNT(*) cnt FROM image_metadata WHERE created_at >= %s AND created_at <= %s", (start_s, end_s)).fetchone()["cnt"]
        fail = conn.execute("SELECT COUNT(*) cnt FROM user_requests WHERE status='failed' AND created_at >= %s AND created_at <= %s", (start_s, end_s)).fetchone()["cnt"]
        avg_latency_row = conn.execute("SELECT AVG(EXTRACT(EPOCH FROM (completed_at-started_at))) avg_sec FROM tasks WHERE status='completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= %s AND completed_at <= %s", (start_s, end_s)).fetchone()
        processing = conn.execute("SELECT COUNT(*) cnt FROM tasks WHERE LOWER(status) IN ('pending','queued','processing','running','generating')").fetchone()["cnt"]
        new_users = conn.execute("SELECT COUNT(*) cnt FROM users WHERE created_at >= %s AND created_at <= %s", (start_s, end_s)).fetchone()["cnt"]
        active_users = conn.execute("SELECT COUNT(DISTINCT user_id) cnt FROM tasks WHERE user_id IS NOT NULL AND created_at >= %s AND created_at <= %s", (start_s, end_s)).fetchone()["cnt"]
        total_users = conn.execute("SELECT COUNT(*) cnt FROM users").fetchone()["cnt"]
        frozen_users = conn.execute("SELECT COUNT(*) cnt FROM users WHERE is_frozen = TRUE").fetchone()["cnt"]
        admin_users = conn.execute("SELECT COUNT(*) cnt FROM users WHERE is_admin = TRUE").fetchone()["cnt"]
        rev_t = conn.execute("SELECT COALESCE(SUM(amount),0) amt, COUNT(*) cnt FROM recharge_requests WHERE status='approved' AND created_at >= %s AND created_at <= %s", (today_start.strftime("%Y-%m-%d %H:%M:%S"), end_s)).fetchone()
        rev_7 = conn.execute("SELECT COALESCE(SUM(amount),0) amt, COUNT(*) cnt FROM recharge_requests WHERE status='approved' AND created_at >= %s AND created_at <= %s", (t7_start, end_s)).fetchone()
        rev_30 = conn.execute("SELECT COALESCE(SUM(amount),0) amt, COUNT(*) cnt FROM recharge_requests WHERE status='approved' AND created_at >= %s AND created_at <= %s", (t30_start, end_s)).fetchone()
        req_rows = conn.execute("SELECT to_char(created_at,'YYYY-MM-DD') d, COUNT(*) cnt FROM user_requests WHERE created_at >= %s AND created_at <= %s GROUP BY d", (t30_start, end_s)).fetchall()
        suc_rows = conn.execute("SELECT to_char(created_at,'YYYY-MM-DD') d, COUNT(*) cnt FROM image_metadata WHERE created_at >= %s AND created_at <= %s GROUP BY d", (t30_start, end_s)).fetchall()
        user_rows = conn.execute("SELECT to_char(created_at,'YYYY-MM-DD') d, COUNT(*) cnt FROM users WHERE created_at >= %s AND created_at <= %s GROUP BY d", (t30_start, end_s)).fetchall()
        rev_rows = conn.execute("SELECT to_char(created_at,'YYYY-MM-DD') d, COALESCE(SUM(amount),0) amt FROM recharge_requests WHERE status='approved' AND created_at >= %s AND created_at <= %s GROUP BY d", (t30_start, end_s)).fetchall()
        points_rows = conn.execute("SELECT to_char(created_at,'YYYY-MM-DD') d, COALESCE(SUM(ABS(amount)),0) amt FROM point_transactions WHERE type='generate_consume' AND created_at >= %s AND created_at <= %s GROUP BY d", (t30_start, end_s)).fetchall()
        req_map = {r["d"]: int(r["cnt"] or 0) for r in req_rows}
        suc_map = {r["d"]: int(r["cnt"] or 0) for r in suc_rows}
        user_map = {r["d"]: int(r["cnt"] or 0) for r in user_rows}
        rev_map = {r["d"]: float(r["amt"] or 0) for r in rev_rows}
        points_map = {r["d"]: int(r["amt"] or 0) for r in points_rows}
        trends = [{"date": d, "requests": req_map.get(d, 0), "success": suc_map.get(d, 0), "new_users": user_map.get(d, 0), "revenue": round(rev_map.get(d, 0), 2), "points_spent": points_map.get(d, 0)} for d in d30]
        top_success_rows = conn.execute("SELECT u.id user_id, u.username, u.nickname, COUNT(im.id) success_count FROM users u LEFT JOIN image_metadata im ON im.user_id=u.id AND im.created_at >= %s AND im.created_at <= %s GROUP BY u.id ORDER BY success_count DESC, u.id ASC LIMIT 10", (t30_start, end_s)).fetchall()
        top_recharge_rows = conn.execute("SELECT u.id user_id, u.username, u.nickname, COALESCE(SUM(rr.amount),0) amount, COUNT(rr.id) orders FROM users u LEFT JOIN recharge_requests rr ON rr.user_id=u.id AND rr.status='approved' AND rr.created_at >= %s AND rr.created_at <= %s GROUP BY u.id ORDER BY amount DESC, u.id ASC LIMIT 10", (t30_start, end_s)).fetchall()
        top_success = [{"user_id": r["user_id"], "username": r["username"], "nickname": r["nickname"], "success_count": int(r["success_count"] or 0)} for r in top_success_rows if int(r["success_count"] or 0) > 0]
        top_recharge = [{"user_id": r["user_id"], "username": r["username"], "nickname": r["nickname"], "amount": round(float(r["amount"] or 0), 2), "orders": int(r["orders"] or 0)} for r in top_recharge_rows if float(r["amount"] or 0) > 0]
        cat_all_rows = conn.execute("SELECT COALESCE(NULLIF(TRIM(category),''),'未分类') category, COUNT(*) cnt FROM prompts GROUP BY category ORDER BY cnt DESC").fetchall()
        cat_visible_rows = conn.execute("SELECT COALESCE(NULLIF(TRIM(category),''),'未分类') category, COUNT(*) cnt FROM prompts WHERE COALESCE(is_frozen,FALSE)=FALSE GROUP BY category ORDER BY cnt DESC").fetchall()
    success_rate = round((suc / req) * 100, 1) if req > 0 else 0
    avg_duration_seconds = round(float(avg_latency_row["avg_sec"] or 0), 1) if avg_latency_row else 0
    return {
        "range": time_range,
        "start_date": start_dt.strftime("%Y-%m-%d"),
        "end_date": now.strftime("%Y-%m-%d"),
        "kpi": {"requests": int(req), "success": int(suc), "failed": int(fail), "success_rate": success_rate, "processing_tasks": int(processing), "new_users": int(new_users), "active_users": int(active_users), "avg_duration_seconds": avg_duration_seconds},
        "users": {"total": int(total_users), "frozen": int(frozen_users), "admins": int(admin_users), "frozen_rate": round((frozen_users / total_users) * 100, 1) if total_users > 0 else 0},
        "revenue": {"today_amount": round(float(rev_t["amt"] or 0), 2), "today_orders": int(rev_t["cnt"] or 0), "days7_amount": round(float(rev_7["amt"] or 0), 2), "days7_orders": int(rev_7["cnt"] or 0), "days30_amount": round(float(rev_30["amt"] or 0), 2), "days30_orders": int(rev_30["cnt"] or 0)},
        "trends_30d": trends,
        "leaderboards": {"success_top": top_success, "recharge_top": top_recharge},
        "categories": {"admin_all": [{"category": r["category"], "count": int(r["cnt"] or 0)} for r in cat_all_rows], "user_visible": [{"category": r["category"], "count": int(r["cnt"] or 0)} for r in cat_visible_rows]},
    }
