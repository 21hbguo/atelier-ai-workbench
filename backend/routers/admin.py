import json
import os
import secrets
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Query
from backend.database import get_db
from backend.auth import require_admin, hash_password
from backend.services.task_manager import TaskManager
from backend.services.banned_words import BannedWordsService
from backend.services.image_mapping import ImageUrlMapping
from backend.services.points_service import PointsService

router = APIRouter(prefix="/api/admin", tags=["admin"])

def _normalize_banned_word(word: str) -> str:
    return " ".join((word or "").replace("\u3000", " ").strip().split())


@router.get("/users")
async def list_users(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(None), admin=Depends(require_admin)):
    with get_db() as conn:
        offset = (page - 1) * size
        if query:
            q = f"%{query}%"
            total = conn.execute("SELECT COUNT(*) FROM users WHERE username LIKE ? OR nickname LIKE ?", (q, q)).fetchone()[0]
            rows = conn.execute(
                """
                SELECT u.id, u.username, u.nickname, u.is_admin, u.is_frozen, u.points, u.last_ip, u.last_active, u.created_at,
                       COALESCE(img.cnt, 0) as success_count,
                       COUNT(CASE WHEN ur.status = 'failed' THEN 1 END) as failed_count,
                       COUNT(CASE WHEN ur.status = 'processing' THEN 1 END) as processing_count
                FROM users u
                LEFT JOIN user_requests ur ON u.id = ur.user_id
                LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM image_metadata GROUP BY user_id) img ON u.id = img.user_id
                WHERE u.username LIKE ? OR u.nickname LIKE ?
                GROUP BY u.id
                ORDER BY u.last_active DESC
                LIMIT ? OFFSET ?
                """,
                (q, q, size, offset),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            rows = conn.execute(
                """
                SELECT u.id, u.username, u.nickname, u.is_admin, u.is_frozen, u.points, u.last_ip, u.last_active, u.created_at,
                       COALESCE(img.cnt, 0) as success_count,
                       COUNT(CASE WHEN ur.status = 'failed' THEN 1 END) as failed_count,
                       COUNT(CASE WHEN ur.status = 'processing' THEN 1 END) as processing_count
                FROM users u
                LEFT JOIN user_requests ur ON u.id = ur.user_id
                LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM image_metadata GROUP BY user_id) img ON u.id = img.user_id
                GROUP BY u.id
                ORDER BY u.last_active DESC
                LIMIT ? OFFSET ?
                """,
                (size, offset),
            ).fetchall()

        users = []
        for row in rows:
            user = dict(row)
            user["is_admin"] = bool(user.get("is_admin"))
            user["is_frozen"] = bool(user.get("is_frozen"))
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
        conn.execute("DELETE FROM point_transactions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM daily_checkins WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return {"message": "删除成功"}


@router.get("/square")
async def list_all_square(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(None), admin=Depends(require_admin)):
    with get_db() as conn:
        import json
        offset = (page - 1) * size
        if query:
            q = f"%{query}%"
            total = conn.execute(
                "SELECT COUNT(*) FROM square_images si JOIN users u ON si.user_id = u.id WHERE si.prompt LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?",
                (q, q, q),
            ).fetchone()[0]
            rows = conn.execute(
                """
                SELECT si.*, u.username, u.nickname
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
async def list_history(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(None), admin=Depends(require_admin)):
    offset = (page - 1) * size
    with get_db() as conn:
        if query:
            q = f"%{query}%"
            total = conn.execute(
                "SELECT COUNT(*) FROM tasks t LEFT JOIN users u ON t.user_id = u.id WHERE t.params LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?",
                (q, q, q),
            ).fetchone()[0]
            rows = conn.execute(
                """
                SELECT t.task_id, t.type, t.status, t.params, t.created_at, t.updated_at,
                       t.started_at, t.completed_at, t.result_urls, t.error, t.user_id,
                       u.username, u.nickname, u.last_ip
                FROM tasks t
                LEFT JOIN users u ON t.user_id = u.id
                WHERE t.params LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?
                ORDER BY t.updated_at DESC
                LIMIT ? OFFSET ?
                """,
                (q, q, q, size, offset),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
            rows = conn.execute(
                """
                SELECT t.task_id, t.type, t.status, t.params, t.created_at, t.updated_at,
                       t.started_at, t.completed_at, t.result_urls, t.error, t.user_id,
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
            cur = conn.execute("DELETE FROM image_mappings WHERE url = ? AND id != ?", (url, keep_id))
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
async def list_all_prompts(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(None), admin=Depends(require_admin)):
    offset = (page - 1) * size
    with get_db() as conn:
        if query:
            q = f"%{query}%"
            total = conn.execute(
                "SELECT COUNT(*) FROM prompts p LEFT JOIN users u ON p.user_id = u.id WHERE p.user_id IS NULL AND (p.name LIKE ? OR p.prompt LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?)",
                (q, q, q, q),
            ).fetchone()[0]
            rows = conn.execute(
                """
                SELECT p.*, u.username, u.nickname
                FROM prompts p
                LEFT JOIN users u ON p.user_id = u.id
                WHERE p.user_id IS NULL AND (p.name LIKE ? OR p.prompt LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?)
                ORDER BY p.created_at DESC
                LIMIT ? OFFSET ?
                """,
                (q, q, q, q, size, offset),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) FROM prompts WHERE user_id IS NULL").fetchone()[0]
            rows = conn.execute(
                """
                SELECT p.*, u.username, u.nickname
                FROM prompts p
                LEFT JOIN users u ON p.user_id = u.id
                WHERE p.user_id IS NULL
                ORDER BY p.created_at DESC
                LIMIT ? OFFSET ?
                """,
                (size, offset),
            ).fetchall()
        items = []
        for row in rows:
            d = dict(row)
            try:
                d["tags"] = json.loads(d.get("tags") or "[]")
            except (json.JSONDecodeError, TypeError):
                d["tags"] = []
            items.append(d)
        return {"items": items, "total": total}


@router.delete("/prompts/{prompt_id}")
async def delete_prompt(prompt_id: str, admin=Depends(require_admin)):
    with get_db() as conn:
        prompt = conn.execute("SELECT id FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        if not prompt:
            raise HTTPException(status_code=404, detail="提示词不存在")
        conn.execute("DELETE FROM prompt_likes WHERE prompt_id = ?", (prompt_id,))
        conn.execute("DELETE FROM prompts WHERE id = ?", (prompt_id,))
        return {"message": "删除成功"}


@router.post("/prompts/batch-delete")
async def batch_delete_prompts(body: dict, admin=Depends(require_admin)):
    ids = body.get("ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="未提供要删除的ID")
    with get_db() as conn:
        placeholders = ",".join("?" * len(ids))
        conn.execute(f"DELETE FROM prompt_likes WHERE prompt_id IN ({placeholders})", ids)
        conn.execute(f"DELETE FROM prompts WHERE id IN ({placeholders})", ids)
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
        total = conn.execute("SELECT COUNT(*) FROM redemption_codes").fetchone()[0]
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
                LIMIT ? OFFSET ?""",
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
            existing = conn.execute("SELECT id FROM redemption_codes WHERE code = ?", (custom_code,)).fetchone()
            if existing:
                raise HTTPException(status_code=400, detail="兑换码已存在")
            conn.execute("INSERT INTO redemption_codes (code, points) VALUES (?, ?)", (custom_code, points))
            return {"generated": 1, "codes": [custom_code]}
        codes = []
        for _ in range(count):
            while True:
                code = secrets.token_urlsafe(8).upper()
                if not conn.execute("SELECT id FROM redemption_codes WHERE code = ?", (code,)).fetchone():
                    break
            conn.execute("INSERT INTO redemption_codes (code, points) VALUES (?, ?)", (code, points))
            codes.append(code)
        return {"generated": len(codes), "codes": codes}


@router.delete("/codes/{code_id}")
async def delete_code(code_id: int, admin=Depends(require_admin)):
    with get_db() as conn:
        row = conn.execute("SELECT id, is_used FROM redemption_codes WHERE id = ?", (code_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="兑换码不存在")
        if row["is_used"]:
            raise HTTPException(status_code=400, detail="已使用的兑换码不能删除")
        conn.execute("DELETE FROM redemption_codes WHERE id = ?", (code_id,))
    return {"message": "删除成功"}


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(user_id: int, body: dict, admin=Depends(require_admin)):
    new_password = (body.get("password") or "").strip()
    if not new_password or len(new_password) < 6:
        raise HTTPException(status_code=400, detail="密码长度至少6位")
    if len(new_password) > 50:
        raise HTTPException(status_code=400, detail="密码长度不能超过50位")
    with get_db() as conn:
        user = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        password_hash = await hash_password(new_password)
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
    return {"message": "密码重置成功"}


@router.post("/users/{user_id}/points")
async def adjust_points(user_id: int, body: dict, admin=Depends(require_admin)):
    amount = body.get("amount", 0)
    description = body.get("description", "管理员调整")
    if amount == 0:
        raise HTTPException(status_code=400, detail="积分调整量不能为 0")
    with get_db() as conn:
        user = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
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
        where.append("rr.status = ?")
        params.append(status)
    if query:
        q = f"%{query}%"
        where.append("(u.username LIKE ? OR u.nickname LIKE ? OR rr.tx_no LIKE ?)")
        params.extend([q, q, q])
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    allowed_sort = {"created_at", "amount", "points", "status"}
    sort_field = f"rr.{sort}" if sort in allowed_sort else "rr.created_at"
    sort_order = "ASC" if order == "asc" else "DESC"
    with get_db() as conn:
        total = conn.execute(
            f"""SELECT COUNT(*) FROM recharge_requests rr
                LEFT JOIN users u ON rr.user_id = u.id
                {where_sql}""",
            params,
        ).fetchone()[0]
        rows = conn.execute(
            f"""SELECT rr.*, u.username, u.nickname, au.username as reviewed_by_name
                FROM recharge_requests rr
                LEFT JOIN users u ON rr.user_id = u.id
                LEFT JOIN users au ON rr.reviewed_by = au.id
                {where_sql}
                ORDER BY {sort_field} {sort_order}
                LIMIT ? OFFSET ?""",
            params + [size, offset],
        ).fetchall()
        return {"items": [dict(r) for r in rows], "total": total, "page": page, "size": size}


@router.post("/recharge-requests/{request_id}/approve")
async def approve_recharge_request(request_id: int, body: dict, admin=Depends(require_admin)):
    review_note = (body.get("review_note") or "").strip()[:500]
    with get_db() as conn:
        row = conn.execute("SELECT * FROM recharge_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="充值申请不存在")
        item = dict(row)
        if item["status"] != "pending":
            raise HTTPException(status_code=400, detail="仅待审核申请可通过")
        points = int(body.get("points") or item["points"])
        if points <= 0:
            raise HTTPException(status_code=400, detail="发放积分必须大于0")
        user_id = item["user_id"]
        while True:
            code = secrets.token_urlsafe(8).upper()
            if not conn.execute("SELECT id FROM redemption_codes WHERE code = ?", (code,)).fetchone():
                break
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute("INSERT INTO redemption_codes (code, points, recharge_request_id) VALUES (?, ?, ?)", (code, points, request_id))
        code_id = conn.execute("SELECT id FROM redemption_codes WHERE code = ?", (code,)).fetchone()["id"]
        conn.execute(
            "UPDATE redemption_codes SET is_used = 1, used_by = ?, used_at = ? WHERE id = ?",
            (user_id, now, code_id),
        )
        conn.execute("UPDATE users SET points = points + ? WHERE id = ?", (points, user_id))
        new_balance = conn.execute("SELECT points FROM users WHERE id = ?", (user_id,)).fetchone()["points"]
        conn.execute(
            "INSERT INTO point_transactions (user_id, amount, balance_after, type, description, recharge_request_id) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, points, new_balance, "redeem_code", f"充值审核通过 (¥{item['amount']})", request_id),
        )
        conn.execute(
            "UPDATE recharge_requests SET status = 'approved', points = ?, redeem_code = ?, review_note = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?",
            (points, code, review_note, now, admin["user_id"], request_id),
        )
        return {"message": "审核通过，积分已发放", "code": code, "points": points}


@router.post("/recharge-requests/{request_id}/reject")
async def reject_recharge_request(request_id: int, body: dict, admin=Depends(require_admin)):
    review_note = (body.get("review_note") or "").strip()[:500]
    if not review_note:
        raise HTTPException(status_code=400, detail="拒绝原因不能为空")
    with get_db() as conn:
        row = conn.execute("SELECT status FROM recharge_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="充值申请不存在")
        if row["status"] != "pending":
            raise HTTPException(status_code=400, detail="仅待审核申请可拒绝")
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "UPDATE recharge_requests SET status = 'rejected', review_note = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?",
            (review_note, now, admin["user_id"], request_id),
        )
        return {"message": "已拒绝该充值申请"}
