import json
import os
import secrets
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Depends, Query
from backend.database import get_db
from backend.auth import require_admin, hash_password, validate_account, build_user_payload
from backend.services.task_manager import TaskManager
from backend.services.banned_words import BannedWordsService
from backend.services.image_mapping import ImageUrlMapping
from backend.services.points_service import PointsService
from backend.services.invite_service import InviteService
from backend.services.notification_service import NotificationService
from backend.services.image_expiry import refresh_permanent_flags_by_filenames
from backend.services.finance_service import FinanceService
from backend.services.favorite_service import FavoriteService
from backend.services.classification_service import ClassificationService
from backend.services.content_audit_service import ContentAuditService
from backend.services.title_generator import TitleGenerator
from backend.config import get_generation_providers, get_generation_models, get_config

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger(__name__)
ACTIVE_TASK_TIMEOUT_MINUTES = 20

def _safe_float(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return float(default)

def _safe_int(v, default=0):
    try:
        return int(v)
    except Exception:
        return int(default)

def _normalize_banned_word(word: str) -> str:
    return " ".join((word or "").replace("\u3000", " ").strip().split())

@router.get("/finance/overview")
async def finance_overview(time_range: str = Query("30d", alias="range"), admin=Depends(require_admin)):
    return FinanceService.finance_overview(time_range)

@router.get("/finance/providers")
async def finance_providers(time_range: str = Query("30d", alias="range"), admin=Depends(require_admin)):
    return FinanceService.finance_providers(time_range)

@router.get("/finance/purchases")
async def finance_purchases(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), provider_id: str = Query(""), admin=Depends(require_admin)):
    return FinanceService.list_purchase_batches(page, size, provider_id)

@router.post("/finance/purchases")
async def finance_create_purchase(body: dict, admin=Depends(require_admin)):
    try:
        row=FinanceService.create_purchase_batch(body.get("provider_id"),body.get("purchase_date"),body.get("amount_rmb"),body.get("quota_amount"),body.get("remark"),admin["user_id"])
        return {"message":"已创建采购批次","item":dict(row) if row else None}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/finance/purchases/{batch_id}")
async def finance_update_purchase(batch_id: int, body: dict, admin=Depends(require_admin)):
    try:
        row=FinanceService.update_purchase_batch(batch_id,body.get("provider_id"),body.get("purchase_date"),body.get("amount_rmb"),body.get("quota_amount"),body.get("remark"),admin["user_id"],adjust_consumed=body.get("adjust_consumed"))
        return {"message":"已更新采购批次","item":dict(row) if row else None}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/finance/purchases/{batch_id}")
@router.post("/finance/purchases/{batch_id}/delete")
async def finance_delete_purchase(batch_id: int, admin=Depends(require_admin)):
    try:
        FinanceService.delete_purchase_batch(batch_id)
        return {"message":"已删除采购批次","id":batch_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/finance/quota-rules")
async def finance_quota_rules(page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=200), provider_id: str = Query(""), admin=Depends(require_admin)):
    return FinanceService.list_quota_rules(page, size, provider_id)

@router.post("/finance/quota-rules")
async def finance_upsert_quota_rule(body: dict, admin=Depends(require_admin)):
    try:
        row=FinanceService.upsert_quota_rule(body.get("provider_id"),body.get("model_id"),body.get("quota_per_success"),body.get("enabled",True),body.get("remark",""),body.get("id"))
        return {"message":"已保存消耗规则","item":dict(row) if row else None}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/finance/quota-rules/{rule_id}")
@router.post("/finance/quota-rules/{rule_id}/delete")
async def finance_delete_quota_rule(rule_id: int, admin=Depends(require_admin)):
    if not FinanceService.delete_quota_rule(rule_id):
        raise HTTPException(status_code=404, detail="规则不存在")
    return {"message":"已删除规则","id":rule_id}

@router.get("/finance/tasks")
async def finance_tasks(time_range: str = Query("30d", alias="range"), provider_id: str = Query(""), model_id: str = Query(""), status: str = Query(""), page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), admin=Depends(require_admin)):
    return FinanceService.list_task_entries(time_range, provider_id, model_id, status, page, size)


@router.post("/users")
async def create_user(body: dict, admin=Depends(require_admin)):
    username = validate_account(body.get("account"))
    password = (body.get("password") or "").strip()
    nickname = (body.get("nickname") or "").strip() or username
    if len(password) < 6 or len(password) > 50:
        raise HTTPException(status_code=400, detail="密码长度需在6到50位之间")
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = %s", (username,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="账号已存在")
        nickname_existing = conn.execute("SELECT id FROM users WHERE nickname = %s", (nickname,)).fetchone()
        if nickname_existing:
            raise HTTPException(status_code=400, detail="昵称已存在")
        password_hash = await hash_password(password)
        cursor = conn.execute("INSERT INTO users (username, password_hash, nickname) VALUES (%s, %s, %s) RETURNING id, username, nickname, is_admin, is_frozen, points, created_at", (username, password_hash, nickname))
        user = dict(cursor.fetchone())
        register_bonus = PointsService.register_bonus()
        if register_bonus > 0:
            PointsService.add_points(user["id"], register_bonus, "register_bonus", "管理员创建账号赠送", conn=conn)
            user["points"] = register_bonus
        user["is_admin"] = bool(user.get("is_admin"))
        user["is_frozen"] = bool(user.get("is_frozen"))
        logger.info(f"[audit.admin_create_user] admin={admin['user_id']} user={user['id']} username={username}")
        return {"message": "创建成功", "user": build_user_payload({"id": user["id"], "account": user["username"], "nickname": user["nickname"], "is_admin": user["is_admin"], "points": user["points"]})}


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
                SELECT u.id, u.username, u.nickname, u.is_admin, u.is_frozen, u.points, u.last_ip, u.last_active, u.created_at,u.invite_code,u.inviter_user_id,iu.username AS inviter_username,iu.nickname AS inviter_nickname,
                       COALESCE(img.cnt, 0) as success_count,
                       COUNT(CASE WHEN ur.status = 'failed' THEN 1 END) as failed_count,
                       COALESCE(proc.cnt, 0) as processing_count,
                       COALESCE(inv_stats.invited_register_count,0) AS invited_register_count,
                       COALESCE(inv_stats.total_rebate_points,0) AS total_rebate_points,
                       COALESCE(inv_stats.total_recharge_amount,0) AS total_recharge_amount,
                       COALESCE(inv_stats.risk_hit_count,0) AS invite_risk_hit_count
                FROM users u
                LEFT JOIN user_requests ur ON u.id = ur.user_id
                LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM image_metadata GROUP BY user_id) img ON u.id = img.user_id
                LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM tasks WHERE LOWER(status) IN ('pending', 'queued', 'processing', 'running', 'generating') AND completed_at IS NULL AND COALESCE(updated_at,created_at,NOW()) >= NOW() - (%s || ' minutes')::interval GROUP BY user_id) proc ON u.id = proc.user_id
                LEFT JOIN users iu ON u.inviter_user_id = iu.id
                LEFT JOIN (SELECT inviter_user_id,COUNT(*) FILTER (WHERE event_type='register') AS invited_register_count,COALESCE(SUM(reward_points) FILTER (WHERE event_type='recharge_rebate' AND status='rewarded'),0) AS total_rebate_points,COALESCE(SUM(recharge_amount) FILTER (WHERE event_type='recharge_submit'),0) AS total_recharge_amount,COUNT(*) FILTER (WHERE same_ip_hit=TRUE) AS risk_hit_count FROM invite_events GROUP BY inviter_user_id) inv_stats ON u.id=inv_stats.inviter_user_id
                WHERE u.username LIKE %s OR u.nickname LIKE %s
                GROUP BY u.id,iu.username,iu.nickname,img.cnt, proc.cnt,inv_stats.invited_register_count,inv_stats.total_rebate_points,inv_stats.total_recharge_amount,inv_stats.risk_hit_count
                ORDER BY u.last_active DESC
                LIMIT %s OFFSET %s
                """,
                (str(ACTIVE_TASK_TIMEOUT_MINUTES), q, q, size, offset),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) as cnt FROM users").fetchone()["cnt"]
            rows = conn.execute(
                """
                SELECT u.id, u.username, u.nickname, u.is_admin, u.is_frozen, u.points, u.last_ip, u.last_active, u.created_at,u.invite_code,u.inviter_user_id,iu.username AS inviter_username,iu.nickname AS inviter_nickname,
                       COALESCE(img.cnt, 0) as success_count,
                       COUNT(CASE WHEN ur.status = 'failed' THEN 1 END) as failed_count,
                       COALESCE(proc.cnt, 0) as processing_count,
                       COALESCE(inv_stats.invited_register_count,0) AS invited_register_count,
                       COALESCE(inv_stats.total_rebate_points,0) AS total_rebate_points,
                       COALESCE(inv_stats.total_recharge_amount,0) AS total_recharge_amount,
                       COALESCE(inv_stats.risk_hit_count,0) AS invite_risk_hit_count
                FROM users u
                LEFT JOIN user_requests ur ON u.id = ur.user_id
                LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM image_metadata GROUP BY user_id) img ON u.id = img.user_id
                LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM tasks WHERE LOWER(status) IN ('pending', 'queued', 'processing', 'running', 'generating') AND completed_at IS NULL AND COALESCE(updated_at,created_at,NOW()) >= NOW() - (%s || ' minutes')::interval GROUP BY user_id) proc ON u.id = proc.user_id
                LEFT JOIN users iu ON u.inviter_user_id = iu.id
                LEFT JOIN (SELECT inviter_user_id,COUNT(*) FILTER (WHERE event_type='register') AS invited_register_count,COALESCE(SUM(reward_points) FILTER (WHERE event_type='recharge_rebate' AND status='rewarded'),0) AS total_rebate_points,COALESCE(SUM(recharge_amount) FILTER (WHERE event_type='recharge_submit'),0) AS total_recharge_amount,COUNT(*) FILTER (WHERE same_ip_hit=TRUE) AS risk_hit_count FROM invite_events GROUP BY inviter_user_id) inv_stats ON u.id=inv_stats.inviter_user_id
                GROUP BY u.id,iu.username,iu.nickname,img.cnt, proc.cnt,inv_stats.invited_register_count,inv_stats.total_rebate_points,inv_stats.total_recharge_amount,inv_stats.risk_hit_count
                ORDER BY u.last_active DESC
                LIMIT %s OFFSET %s
                """,
                (str(ACTIVE_TASK_TIMEOUT_MINUTES), size, offset),
            ).fetchall()

        users = []
        for row in rows:
            user = dict(row)
            user["account"] = user.get("username", "")
            user["is_admin"] = bool(user.get("is_admin"))
            user["is_frozen"] = bool(user.get("is_frozen"))
            user["inviter_name"] = user.get("inviter_nickname") or user.get("inviter_username") or ""
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
        conn.execute("UPDATE users SET inviter_user_id = NULL WHERE inviter_user_id = %s", (user_id,))
        conn.execute("UPDATE recharge_requests SET inviter_user_id = NULL WHERE inviter_user_id = %s", (user_id,))
        conn.execute("UPDATE invite_events SET inviter_user_id = NULL WHERE inviter_user_id = %s", (user_id,))
        conn.execute("UPDATE invite_events SET invitee_user_id = NULL WHERE invitee_user_id = %s", (user_id,))
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


_SQUARE_ORDER_MAP = {"likes": "si.likes_count DESC, si.id DESC", "time": "si.created_at DESC, si.id DESC"}
_PROMPT_ORDER_MAP = {"likes": "p.likes_count DESC, p.id DESC", "time": "p.created_at DESC, p.id DESC"}
@router.get("/square")
async def list_all_square(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(None), author_id: int = Query(None), category: str = Query(None), status: str = Query("all"), sort: str = Query("likes", regex="^(likes|time)$"), admin=Depends(require_admin)):
    with get_db() as conn:
        import json
        offset = (page - 1) * size
        where = []
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
        if status == "frozen":
            where.append("si.is_frozen = TRUE")
        elif status == "active":
            where.append("si.is_frozen = FALSE")
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""

        total = conn.execute(
            f"SELECT COUNT(*) as cnt FROM square_images si JOIN users u ON si.user_id = u.id {where_sql}",
            params,
        ).fetchone()["cnt"]
        order = _SQUARE_ORDER_MAP.get(sort, _SQUARE_ORDER_MAP["likes"])
        rows = conn.execute(
            f"""
            SELECT si.*, u.username, u.nickname, cat.label AS category_label
            FROM square_images si
            JOIN users u ON si.user_id = u.id
            LEFT JOIN categories cat ON si.category = cat.slug
            {where_sql}
            ORDER BY {order}
            LIMIT %s OFFSET %s
            """,
            params + [size, offset],
        ).fetchall()
        image_ids = [str(r["id"]) for r in rows]
        liked_ids = set()
        favorited_ids = set()
        if image_ids:
            favorited_ids = FavoriteService.get_flags(admin["user_id"], "image", image_ids, conn=conn)
            placeholders = ",".join("%s" for _ in image_ids)
            liked_rows = conn.execute(f"SELECT image_id FROM square_likes WHERE user_id = %s AND image_id IN ({placeholders})", [admin["user_id"], *image_ids]).fetchall()
            liked_ids = {str(r["image_id"]) for r in liked_rows}
        images = []
        for row in rows:
            item = dict(row)
            meta = item["metadata"]
            item["metadata"] = json.loads(meta) if isinstance(meta, str) else meta
            item["is_frozen"] = bool(item.get("is_frozen"))
            item["is_liked"] = str(item["id"]) in liked_ids
            item["is_favorited"] = str(item["id"]) in favorited_ids
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
        conn.execute("DELETE FROM favorites WHERE target_type = 'image' AND target_id = ANY(%s)", ([str(i) for i in ids],))
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
        conn.execute("DELETE FROM favorites WHERE target_type = 'image' AND target_id = %s", (str(image_id),))
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


def _detect_hosting_type(url: str) -> str:
    if "cdn.jsdelivr.net" in url:
        return "github"
    return "heliar"


@router.get("/hosting/stats")
async def get_hosting_stats(admin=Depends(require_admin)):
    mapping = ImageUrlMapping.load_mapping()
    total_count = len(mapping)
    total_size = sum(_get_local_file_size(p) for p in mapping.keys())
    type_stats = {}
    for local_path, url in mapping.items():
        ht = _detect_hosting_type(url)
        if ht not in type_stats:
            type_stats[ht] = {"count": 0, "size": 0}
        type_stats[ht]["count"] += 1
        type_stats[ht]["size"] += _get_local_file_size(local_path)
    return {
        "total_count": total_count,
        "total_size": total_size,
        "total_size_fmt": _format_size(total_size),
        "type_stats": {k: {**v, "size_fmt": _format_size(v["size"])} for k, v in type_stats.items()},
    }


@router.get("/hosting")
async def list_hosting_images(page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=200), hosting_type: str = Query(None), admin=Depends(require_admin)):
    mapping = ImageUrlMapping.load_mapping()
    items = []
    for local_path, url in mapping.items():
        if hosting_type and _detect_hosting_type(url) != hosting_type:
            continue
        filename = os.path.basename(local_path)
        file_size = _get_local_file_size(local_path)
        items.append({
            "filename": filename,
            "local_path": local_path,
            "url": url,
            "hosting_type": _detect_hosting_type(url),
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
async def list_all_prompts(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), query: str = Query(None), category: str = Query(None), author_id: int = Query(None), author_name: str = Query(None), status: str = Query("all"), sort: str = Query("likes", regex="^(likes|time)$"), admin=Depends(require_admin)):
    offset = (page - 1) * size
    with get_db() as conn:
        where = ["p.user_id IS NULL"]
        params = []
        if author_id is not None:
            where.append("p.user_id = %s")
            params.append(author_id)
        if author_name:
            where.append("(p.author = %s OR u.username = %s OR u.nickname = %s)")
            params.extend([author_name, author_name, author_name])
        if query:
            q = f"%{query}%"
            where.append("(p.name LIKE %s OR p.prompt LIKE %s OR p.author LIKE %s OR u.username LIKE %s OR u.nickname LIKE %s)")
            params.extend([q, q, q, q, q])
        if category:
            where.append("p.category = %s")
            params.append(category)
        if status == "frozen":
            where.append("COALESCE(p.is_frozen, FALSE) = TRUE")
        elif status == "active":
            where.append("COALESCE(p.is_frozen, FALSE) = FALSE")
        where_sql = "WHERE " + " AND ".join(where)
        total = conn.execute(f"SELECT COUNT(*) as cnt FROM prompts p LEFT JOIN users u ON p.user_id = u.id {where_sql}", params).fetchone()["cnt"]
        order = _PROMPT_ORDER_MAP.get(sort, _PROMPT_ORDER_MAP["likes"])
        rows = conn.execute(
            f"""
            SELECT p.*, u.username, u.nickname
            FROM prompts p
            LEFT JOIN users u ON p.user_id = u.id
            {where_sql}
            ORDER BY {order}
            LIMIT %s OFFSET %s
            """,
            params + [size, offset],
        ).fetchall()
        prompt_ids = [str(r["id"]) for r in rows]
        liked_ids = set()
        favorited_ids = set()
        if prompt_ids:
            favorited_ids = FavoriteService.get_flags(admin["user_id"], "prompt", prompt_ids, conn=conn)
            placeholders = ",".join("%s" for _ in prompt_ids)
            liked_rows = conn.execute(f"SELECT prompt_id FROM prompt_likes WHERE user_id = %s AND prompt_id IN ({placeholders})", [admin["user_id"], *prompt_ids]).fetchall()
            liked_ids = {str(r["prompt_id"]) for r in liked_rows}
        items = []
        for row in rows:
            d = dict(row)
            try:
                d["tags"] = json.loads(d.get("tags") or "[]")
            except (json.JSONDecodeError, TypeError):
                d["tags"] = []
            d["is_frozen"] = bool(d.get("is_frozen"))
            d["is_liked"] = str(d["id"]) in liked_ids
            d["is_favorited"] = str(d["id"]) in favorited_ids
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


# ============ 人工捐赠审核 ============

@router.get("/recharge-requests")
async def list_recharge_requests(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), status: str = Query("all"), query: str = Query(None), sort: str = Query("created_at"), order: str = Query("desc"), admin=Depends(require_admin)):
    offset = (page - 1) * size
    where = []
    params = []
    if status in {"pending", "approved", "rejected", "refunded"}:
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
            f"""SELECT rr.*, u.username, u.nickname, au.username as reviewed_by_name,iu.username as inviter_username,iu.nickname as inviter_nickname
                FROM recharge_requests rr
                LEFT JOIN users u ON rr.user_id = u.id
                LEFT JOIN users au ON rr.reviewed_by = au.id
                LEFT JOIN users iu ON rr.inviter_user_id = iu.id
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
            raise HTTPException(status_code=404, detail="捐赠申请不存在")
        item = dict(row)
        if item["status"] == "approved":
            return {"message": "该申请已审核通过", "code": item.get("redeem_code"), "points": item.get("points")}
        if item["status"] != "pending":
            raise HTTPException(status_code=400, detail="仅待审核申请可通过")
        base_points = int(body.get("points") or item["points"])
        bonus_points = int(item.get("invite_bonus_points") or 0)
        points = base_points + bonus_points
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
        PointsService.add_points(user_id, points, "redeem_code", f"捐赠审核通过 (¥{item['amount']})", conn=conn, request_key=f"recharge-approve:{request_id}", recharge_request_id=request_id)
        conn.execute(
            "UPDATE recharge_requests SET status = 'approved', points = %s, redeem_code = %s, review_note = %s, reviewed_at = %s, reviewed_by = %s WHERE id = %s",
            (points, code, review_note, now, admin["user_id"], request_id),
        )
        invite_result=InviteService.apply_recharge_rewards(conn,{**item,"points":base_points},item.get("submit_ip") or "")
        try:
            NotificationService.create(user_id, "recharge_approved", "捐赠审核通过", f"你的捐赠凭证已通过审核，已发放 {points} 积分", str(request_id))
            if item.get("inviter_user_id") and invite_result.get("rebate_points",0)>0:
                NotificationService.create(item["inviter_user_id"], "invite_recharge_rebate", "邀请返利到账", f"你收到 {invite_result['rebate_points']} 积分返利", str(request_id))
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
            raise HTTPException(status_code=404, detail="捐赠申请不存在")
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
                NotificationService.create(user_row["user_id"], "recharge_rejected", "捐赠审核未通过", f"你的捐赠凭证未通过审核：{review_note}", str(request_id))
            except Exception:
                pass
        logger.info(f"[audit.recharge.reject] request={request_id} admin={admin['user_id']} reason={review_note[:120]}")
        return {"message": "已拒绝该捐赠凭证"}


@router.post("/recharge-requests/{request_id}/refund")
async def refund_recharge_request(request_id: int, body: dict, admin=Depends(require_admin)):
    review_note = (body.get("review_note") or "").strip()[:500] or "管理员回退发放"
    with get_db() as conn:
        row = conn.execute("SELECT * FROM recharge_requests WHERE id = %s", (request_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="捐赠申请不存在")
        item = dict(row)
        if item["status"] != "approved":
            raise HTTPException(status_code=400, detail="仅已通过的申请可回退发放")
        user_id = item["user_id"]
        points = int(item.get("points") or 0)
        if points <= 0:
            raise HTTPException(status_code=400, detail="该申请无有效积分，无法回退发放")
        conn.execute("UPDATE users SET points = GREATEST(0, points - %s) WHERE id = %s", (points, user_id))
        new_balance = conn.execute("SELECT points FROM users WHERE id = %s", (user_id,)).fetchone()["points"]
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "INSERT INTO point_transactions (user_id, amount, balance_after, type, description, recharge_request_id, request_key) VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
            (user_id, -points, new_balance, "recharge_refund", f"积分回退 (¥{item['amount']})", request_id, f"recharge-refund:{request_id}"),
        )
        conn.execute(
            "UPDATE recharge_requests SET status = 'refunded', review_note = %s, reviewed_at = %s, reviewed_by = %s WHERE id = %s",
            (review_note, now, admin["user_id"], request_id),
        )
        try:
            NotificationService.create(user_id, "recharge_refunded", "积分已回退", f"你的捐赠发放已回退，扣除 {points} 积分", str(request_id))
        except Exception:
            pass
        logger.info(f"[audit.recharge.refund] request={request_id} admin={admin['user_id']} user={user_id} points={points}")
        return {"message": f"已回退，扣除 {points} 积分", "points_deducted": points, "new_balance": new_balance}

@router.get("/users/{user_id}/invite-history")
async def admin_user_invite_history(user_id: int, page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), admin=Depends(require_admin)):
    return InviteService.list_user_invite_history(user_id,page,size)


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
    range_days = max(1, (end_dt - start_dt).days + 1)
    range_dates = [(start_dt + _td(days=i)).strftime("%Y-%m-%d") for i in range(range_days)]
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
        req_rows = conn.execute("SELECT to_char(created_at,'YYYY-MM-DD') d, COUNT(*) cnt FROM user_requests WHERE created_at >= %s AND created_at <= %s GROUP BY d", (start_s, end_s)).fetchall()
        suc_rows = conn.execute("SELECT to_char(created_at,'YYYY-MM-DD') d, COUNT(*) cnt FROM image_metadata WHERE created_at >= %s AND created_at <= %s GROUP BY d", (start_s, end_s)).fetchall()
        user_rows = conn.execute("SELECT to_char(created_at,'YYYY-MM-DD') d, COUNT(*) cnt FROM users WHERE created_at >= %s AND created_at <= %s GROUP BY d", (start_s, end_s)).fetchall()
        rev_rows = conn.execute("SELECT to_char(created_at,'YYYY-MM-DD') d, COALESCE(SUM(amount),0) amt FROM recharge_requests WHERE status='approved' AND created_at >= %s AND created_at <= %s GROUP BY d", (start_s, end_s)).fetchall()
        points_rows = conn.execute("SELECT to_char(created_at,'YYYY-MM-DD') d, COALESCE(SUM(ABS(amount)),0) amt FROM point_transactions WHERE type='generate_consume' AND created_at >= %s AND created_at <= %s GROUP BY d", (start_s, end_s)).fetchall()
        model_rows = conn.execute(
            """
            SELECT COALESCE(NULLIF(params->>'model_id',''),'image-default') model_id, COUNT(*) total_cnt,
                   COUNT(*) FILTER (WHERE status='completed') success_cnt,
                   COUNT(*) FILTER (WHERE status='failed') failed_cnt,
                   AVG(EXTRACT(EPOCH FROM (completed_at-started_at))) FILTER (WHERE status='completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL) avg_sec
            FROM tasks
            WHERE created_at >= %s AND created_at <= %s
            GROUP BY COALESCE(NULLIF(params->>'model_id',''),'image-default')
            ORDER BY total_cnt DESC, model_id ASC
            """,
            (start_s, end_s),
        ).fetchall()
        provider_rows = conn.execute(
            """
            SELECT COALESCE(NULLIF(params->>'provider_id',''),NULLIF(params->'provider_trace'->0->>'provider_id',''),'unknown') provider_id, COUNT(*) total_cnt,
                   COUNT(*) FILTER (WHERE status='completed') success_cnt,
                   COUNT(*) FILTER (WHERE status='failed') failed_cnt,
                   AVG(EXTRACT(EPOCH FROM (completed_at-started_at))) FILTER (WHERE status='completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL) avg_sec
            FROM tasks
            WHERE created_at >= %s AND created_at <= %s
            GROUP BY COALESCE(NULLIF(params->>'provider_id',''),NULLIF(params->'provider_trace'->0->>'provider_id',''),'unknown')
            ORDER BY total_cnt DESC, provider_id ASC
            """,
            (start_s, end_s),
        ).fetchall()
        fallback_rows = conn.execute(
            """
            SELECT COALESCE(NULLIF(trace_elem->>'provider_id',''),'unknown') provider_id, COUNT(*) attempt_cnt,
                   COUNT(*) FILTER (WHERE (trace_elem->>'ok')::boolean = TRUE) attempt_ok_cnt
            FROM tasks t
            JOIN LATERAL jsonb_array_elements(COALESCE(t.params->'provider_trace','[]'::jsonb)) trace_elem ON TRUE
            WHERE t.created_at >= %s AND t.created_at <= %s
            GROUP BY COALESCE(NULLIF(trace_elem->>'provider_id',''),'unknown')
            ORDER BY attempt_cnt DESC, provider_id ASC
            """,
            (start_s, end_s),
        ).fetchall()
        matrix_rows = conn.execute(
            """
            SELECT COALESCE(NULLIF(params->>'model_id',''),'image-default') model_id, COALESCE(NULLIF(params->>'provider_id',''),NULLIF(params->'provider_trace'->0->>'provider_id',''),'unknown') provider_id, COUNT(*) total_cnt,
                   COUNT(*) FILTER (WHERE status='completed') success_cnt,
                   COUNT(*) FILTER (WHERE status='failed') failed_cnt
            FROM tasks
            WHERE created_at >= %s AND created_at <= %s
            GROUP BY COALESCE(NULLIF(params->>'model_id',''),'image-default'), COALESCE(NULLIF(params->>'provider_id',''),NULLIF(params->'provider_trace'->0->>'provider_id',''),'unknown')
            ORDER BY total_cnt DESC, model_id ASC, provider_id ASC
            """,
            (start_s, end_s),
        ).fetchall()
        req_map = {r["d"]: int(r["cnt"] or 0) for r in req_rows}
        suc_map = {r["d"]: int(r["cnt"] or 0) for r in suc_rows}
        user_map = {r["d"]: int(r["cnt"] or 0) for r in user_rows}
        rev_map = {r["d"]: float(r["amt"] or 0) for r in rev_rows}
        points_map = {r["d"]: int(r["amt"] or 0) for r in points_rows}
        trends = [{"date": d, "requests": req_map.get(d, 0), "success": suc_map.get(d, 0), "new_users": user_map.get(d, 0), "revenue": round(rev_map.get(d, 0), 2), "points_spent": points_map.get(d, 0)} for d in range_dates]
        top_success_rows = conn.execute("SELECT u.id user_id, u.username, u.nickname, COUNT(im.id) success_count FROM users u LEFT JOIN image_metadata im ON im.user_id=u.id AND im.created_at >= %s AND im.created_at <= %s GROUP BY u.id ORDER BY success_count DESC, u.id ASC LIMIT 10", (start_s, end_s)).fetchall()
        top_recharge_rows = conn.execute("SELECT u.id user_id, u.username, u.nickname, COALESCE(SUM(rr.amount),0) amount, COUNT(rr.id) orders FROM users u LEFT JOIN recharge_requests rr ON rr.user_id=u.id AND rr.status='approved' AND rr.created_at >= %s AND rr.created_at <= %s GROUP BY u.id ORDER BY amount DESC, u.id ASC LIMIT 10", (start_s, end_s)).fetchall()
        top_success = [{"user_id": r["user_id"], "username": r["username"], "nickname": r["nickname"], "success_count": int(r["success_count"] or 0)} for r in top_success_rows if int(r["success_count"] or 0) > 0]
        top_recharge = [{"user_id": r["user_id"], "username": r["username"], "nickname": r["nickname"], "amount": round(float(r["amount"] or 0), 2), "orders": int(r["orders"] or 0)} for r in top_recharge_rows if float(r["amount"] or 0) > 0]
        cat_all_rows = conn.execute("SELECT COALESCE(NULLIF(TRIM(category),''),'未分类') category, COUNT(*) cnt FROM prompts GROUP BY category ORDER BY cnt DESC").fetchall()
        cat_visible_rows = conn.execute("SELECT COALESCE(NULLIF(TRIM(category),''),'未分类') category, COUNT(*) cnt FROM prompts WHERE COALESCE(is_frozen,FALSE)=FALSE GROUP BY category ORDER BY cnt DESC").fetchall()
    provider_cfg = get_generation_providers() or {}
    model_cfg = get_generation_models() or {}
    model_stats = [{"model_id": r["model_id"], "model_label": ((model_cfg.get(r["model_id"]) or {}).get("label") or r["model_id"]), "total": int(r["total_cnt"] or 0), "success": int(r["success_cnt"] or 0), "failed": int(r["failed_cnt"] or 0), "success_rate": round((int(r["success_cnt"] or 0) / int(r["total_cnt"] or 1)) * 100, 1), "avg_duration_seconds": round(float(r["avg_sec"] or 0), 1)} for r in model_rows]
    provider_stats = [{"provider_id": r["provider_id"], "provider_type": ((provider_cfg.get(r["provider_id"]) or {}).get("type") or "unknown"), "total": int(r["total_cnt"] or 0), "success": int(r["success_cnt"] or 0), "failed": int(r["failed_cnt"] or 0), "success_rate": round((int(r["success_cnt"] or 0) / int(r["total_cnt"] or 1)) * 100, 1), "avg_duration_seconds": round(float(r["avg_sec"] or 0), 1)} for r in provider_rows]
    provider_type_map = {}
    for p in provider_stats:
        t = p["provider_type"]
        if t not in provider_type_map: provider_type_map[t] = {"provider_type": t, "total": 0, "success": 0, "failed": 0}
        provider_type_map[t]["total"] += p["total"]
        provider_type_map[t]["success"] += p["success"]
        provider_type_map[t]["failed"] += p["failed"]
    provider_type_stats = []
    for t, v in provider_type_map.items():
        provider_type_stats.append({"provider_type": t, "total": int(v["total"]), "success": int(v["success"]), "failed": int(v["failed"]), "success_rate": round((int(v["success"]) / int(v["total"] or 1)) * 100, 1)})
    provider_type_stats.sort(key=lambda x: (-x["total"], x["provider_type"]))
    fallback_stats = [{"provider_id": r["provider_id"], "provider_type": ((provider_cfg.get(r["provider_id"]) or {}).get("type") or "unknown"), "attempts": int(r["attempt_cnt"] or 0), "attempt_ok": int(r["attempt_ok_cnt"] or 0), "attempt_ok_rate": round((int(r["attempt_ok_cnt"] or 0) / int(r["attempt_cnt"] or 1)) * 100, 1)} for r in fallback_rows]
    matrix_map = {}
    for r in matrix_rows:
        mid = r["model_id"]
        pid = r["provider_id"]
        if mid not in matrix_map: matrix_map[mid] = {}
        matrix_map[mid][pid] = {"total": int(r["total_cnt"] or 0), "success": int(r["success_cnt"] or 0), "failed": int(r["failed_cnt"] or 0), "success_rate": round((int(r["success_cnt"] or 0) / int(r["total_cnt"] or 1)) * 100, 1)}
    matrix_models = sorted(matrix_map.keys(), key=lambda x: (-sum(v["total"] for v in matrix_map[x].values()), x))
    matrix_providers = sorted({pid for row in matrix_map.values() for pid in row.keys()})
    matrix = {"models": matrix_models, "model_labels": {mid: ((model_cfg.get(mid) or {}).get("label") or mid) for mid in matrix_models}, "providers": matrix_providers, "cells": matrix_map}
    success_rate = round((suc / req) * 100, 1) if req > 0 else 0
    avg_duration_seconds = round(float(avg_latency_row["avg_sec"] or 0), 1) if avg_latency_row else 0
    return {
        "range": time_range,
        "start_date": start_dt.strftime("%Y-%m-%d"),
        "end_date": now.strftime("%Y-%m-%d"),
        "kpi": {"requests": int(req), "success": int(suc), "failed": int(fail), "success_rate": success_rate, "processing_tasks": int(processing), "new_users": int(new_users), "active_users": int(active_users), "avg_duration_seconds": avg_duration_seconds},
        "users": {"total": int(total_users), "frozen": int(frozen_users), "admins": int(admin_users), "frozen_rate": round((frozen_users / total_users) * 100, 1) if total_users > 0 else 0},
        "revenue": {"today_amount": round(float(rev_t["amt"] or 0), 2), "today_orders": int(rev_t["cnt"] or 0), "days7_amount": round(float(rev_7["amt"] or 0), 2), "days7_orders": int(rev_7["cnt"] or 0), "days30_amount": round(float(rev_30["amt"] or 0), 2), "days30_orders": int(rev_30["cnt"] or 0)},
        "trends": trends,
        "leaderboards": {"success_top": top_success, "recharge_top": top_recharge},
        "categories": {"admin_all": [{"category": r["category"], "count": int(r["cnt"] or 0)} for r in cat_all_rows], "user_visible": [{"category": r["category"], "count": int(r["cnt"] or 0)} for r in cat_visible_rows]},
        "generation": {"models": model_stats, "providers": provider_stats, "provider_types": provider_type_stats, "fallback_attempts": fallback_stats, "matrix": matrix},
    }


@router.get("/stats/cost-profit")
async def admin_stats_cost_profit(time_range: str = Query("30d", alias="range"), admin=Depends(require_admin)):
    from datetime import timedelta as _td
    cfg = get_config() or {}
    cp = cfg.get("cost_profit_config") or {}
    launch_at = (cfg.get("cost_profit_launch_at") or "").strip()
    now = datetime.now()
    today_start = datetime(now.year, now.month, now.day)
    launch_dt = None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        if launch_dt: break
        try:
            launch_dt = datetime.strptime(launch_at, fmt)
        except Exception:
            pass
    if not launch_dt:
        launch_dt = now
        launch_at = now.strftime("%Y-%m-%d %H:%M:%S")
    start_dt = launch_dt
    if time_range == "today":
        start_dt = max(launch_dt, today_start)
    elif time_range == "7d":
        start_dt = max(launch_dt, today_start - _td(days=6))
    elif time_range == "30d":
        start_dt = max(launch_dt, today_start - _td(days=29))
    elif time_range != "all":
        time_range = "30d"
        start_dt = max(launch_dt, today_start - _td(days=29))
    start_s = start_dt.strftime("%Y-%m-%d %H:%M:%S")
    end_s = now.strftime("%Y-%m-%d %H:%M:%S")
    model_provider_costs = cp.get("model_provider_costs") or {}
    provider_quotas = cp.get("provider_quotas") or {}
    quota_ledger = cp.get("quota_ledger") or []
    provider_cfg = get_generation_providers() or {}
    with get_db() as conn:
        rev = conn.execute("SELECT COALESCE(SUM(amount),0) amt, COUNT(*) cnt FROM recharge_requests WHERE status='approved' AND created_at >= %s AND created_at <= %s", (start_s, end_s)).fetchone()
        rows = conn.execute(
            """
            SELECT COALESCE(NULLIF(params->>'model_id',''),'image-default') model_id,
                   COALESCE(NULLIF(params->>'provider_id',''),NULLIF(params->'provider_trace'->0->>'provider_id',''),'unknown') provider_id,
                   COUNT(*) cnt,
                   COUNT(*) FILTER (WHERE status='completed') success_cnt,
                   COUNT(*) FILTER (WHERE status='failed') failed_cnt,
                   COALESCE(SUM(CASE WHEN COALESCE(params->>'cost_amount','') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (params->>'cost_amount')::numeric ELSE 0 END),0) cost_snap
            FROM tasks
            WHERE created_at >= %s AND created_at <= %s
              AND COALESCE(NULLIF(params->>'provider_id',''),NULLIF(params->'provider_trace'->0->>'provider_id',''),'') <> ''
            GROUP BY COALESCE(NULLIF(params->>'model_id',''),'image-default'), COALESCE(NULLIF(params->>'provider_id',''),NULLIF(params->'provider_trace'->0->>'provider_id',''),'unknown')
            ORDER BY cnt DESC, model_id ASC, provider_id ASC
            """,
            (start_s, end_s),
        ).fetchall()
    matrix = []
    provider_map = {}
    total_cost = 0.0
    unpriced_calls = 0
    for r in rows:
        mid = r["model_id"]
        pid = r["provider_id"]
        key = f"{mid}__{pid}"
        snap_cost = _safe_float(r.get("cost_snap"), 0)
        unit_cost = _safe_float(model_provider_costs.get(key), -1)
        cnt = int(r["cnt"] or 0)
        success = int(r["success_cnt"] or 0)
        failed = int(r["failed_cnt"] or 0)
        priced = unit_cost >= 0
        cost_amt = round(snap_cost if snap_cost > 0 else (unit_cost * cnt if priced else 0.0), 6)
        if (not priced) and snap_cost <= 0: unpriced_calls += cnt
        else: total_cost += cost_amt
        matrix.append({"model_id": mid, "provider_id": pid, "calls": cnt, "success": success, "failed": failed, "success_rate": round((success / (cnt or 1)) * 100, 1), "unit_cost": None if unit_cost < 0 else round(unit_cost, 6), "cost_amount": round(cost_amt, 6), "priced": priced or snap_cost > 0})
        if pid not in provider_map:
            provider_map[pid] = {"provider_id": pid, "provider_type": ((provider_cfg.get(pid) or {}).get("type") or "unknown"), "calls": 0, "success": 0, "failed": 0, "cost_amount": 0.0}
        provider_map[pid]["calls"] += cnt
        provider_map[pid]["success"] += success
        provider_map[pid]["failed"] += failed
        provider_map[pid]["cost_amount"] = round(provider_map[pid]["cost_amount"] + cost_amt, 6)
    for pid in set(list(provider_cfg.keys()) + list(provider_quotas.keys())):
        if pid not in provider_map: provider_map[pid] = {"provider_id": pid, "provider_type": ((provider_cfg.get(pid) or {}).get("type") or "unknown"), "calls": 0, "success": 0, "failed": 0, "cost_amount": 0.0}
    provider_stats = []
    for pid, item in provider_map.items():
        q = provider_quotas.get(pid) or {}
        total_quota = _safe_float(q.get("total_quota"), 0)
        unit_quota_cost = _safe_float(q.get("unit_quota_cost"), 0)
        current_balance = q.get("current_balance")
        if current_balance is None:
            ledger_add = sum(_safe_float(x.get("change_amount"), 0) for x in quota_ledger if str(x.get("provider_id")) == pid)
            current_balance = total_quota + ledger_add
        current_balance = round(_safe_float(current_balance, 0), 6)
        remaining_times = int(current_balance // unit_quota_cost) if unit_quota_cost > 0 else 0
        provider_stats.append({**item, "success_rate": round((item["success"] / (item["calls"] or 1)) * 100, 1), "total_quota": round(total_quota, 6), "current_balance": current_balance, "unit_quota_cost": round(unit_quota_cost, 6), "remaining_times": remaining_times, "enabled": (q.get("enabled") is not False)})
    provider_stats.sort(key=lambda x: (-x["calls"], x["provider_id"]))
    total_revenue = round(_safe_float((rev or {}).get("amt"), 0), 2)
    total_cost = round(total_cost, 6)
    profit = round(total_revenue - total_cost, 6)
    profit_rate = round((profit / total_revenue) * 100, 2) if total_revenue > 0 else 0.0
    return {"range": time_range, "start_date": start_dt.strftime("%Y-%m-%d"), "end_date": now.strftime("%Y-%m-%d"), "launch_at": launch_at, "summary": {"revenue_amount": total_revenue, "revenue_orders": int((rev or {}).get("cnt") or 0), "cost_amount": total_cost, "profit_amount": profit, "profit_rate": profit_rate, "unpriced_calls": int(unpriced_calls)}, "providers": provider_stats, "matrix": matrix}


@router.get("/email-verifications")
async def list_email_verifications(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    query: str = Query(None),
    admin=Depends(require_admin),
):
    offset = (page - 1) * size
    with get_db() as conn:
        if query:
            q = f"%{query}%"
            total = conn.execute(
                "SELECT COUNT(*) as cnt FROM email_verification_codes WHERE email LIKE %s OR ip LIKE %s",
                (q, q),
            ).fetchone()["cnt"]
            rows = conn.execute(
                """SELECT * FROM email_verification_codes
                   WHERE email LIKE %s OR ip LIKE %s
                   ORDER BY created_at DESC LIMIT %s OFFSET %s""",
                (q, q, size, offset),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) as cnt FROM email_verification_codes").fetchone()["cnt"]
            rows = conn.execute(
                """SELECT * FROM email_verification_codes
                   ORDER BY created_at DESC LIMIT %s OFFSET %s""",
                (size, offset),
            ).fetchall()
        return {"items": [dict(r) for r in rows], "total": total, "page": page, "size": size}


# ──────────────────────── AI 分类 ────────────────────────

@router.post("/classification/tasks")
async def create_classification_task(body: dict = {}, admin=Depends(require_admin)):
    item_type = body.get("item_type", "prompt")
    if item_type not in ("prompt", "image"):
        raise HTTPException(status_code=400, detail="item_type 必须是 prompt 或 image")
    try:
        task = ClassificationService.create_task(admin_id=admin["user_id"], item_type=item_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    import asyncio
    asyncio.create_task(ClassificationService.run_classification(task["id"]))
    return task


@router.post("/classification/review")
async def create_review_task(body: dict, admin=Depends(require_admin)):
    """创建分类审查任务，重新审查指定分类下的项目"""
    item_type = body.get("item_type", "prompt")
    category_slug = body.get("category_slug", "")
    if not category_slug:
        raise HTTPException(status_code=400, detail="category_slug 不能为空")
    if item_type not in ("prompt", "image"):
        raise HTTPException(status_code=400, detail="item_type 必须是 prompt 或 image")
    try:
        task = ClassificationService.create_review_task(
            admin_id=admin["user_id"],
            item_type=item_type,
            category_slug=category_slug,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    import asyncio
    asyncio.create_task(ClassificationService.run_classification(task["id"]))
    return task


@router.get("/classification/tasks")
async def list_classification_tasks(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), admin=Depends(require_admin)):
    return ClassificationService.list_tasks(page=page, size=size)


@router.get("/classification/tasks/{task_id}")
async def get_classification_task(task_id: int, admin=Depends(require_admin)):
    task = ClassificationService.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@router.post("/classification/tasks/{task_id}/approve")
async def approve_classification(task_id: int, body: dict, admin=Depends(require_admin)):
    result_ids = body.get("result_ids", [])
    if not result_ids:
        raise HTTPException(status_code=400, detail="请选择要通过的结果")
    try:
        return await ClassificationService.approve_results(task_id, result_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/classification/tasks/{task_id}/reject")
async def reject_classification(task_id: int, body: dict, admin=Depends(require_admin)):
    result_ids = body.get("result_ids", [])
    if not result_ids:
        raise HTTPException(status_code=400, detail="请选择要拒绝的结果")
    return ClassificationService.reject_results(task_id, result_ids)


@router.post("/classification/results/{result_id}")
async def update_classification_result(result_id: int, body: dict, admin=Depends(require_admin)):
    slug = body.get("suggested_category", "")
    label = body.get("suggested_category_label", "")
    is_new = body.get("is_new_category", False)
    if not slug:
        raise HTTPException(status_code=400, detail="分类标识不能为空")
    return ClassificationService.update_result(result_id, slug, label, is_new)

@router.post("/title/test")
async def test_title_generation(body: dict, admin=Depends(require_admin)):
    prompt = (body.get("prompt") or "").strip()
    raw_name = (body.get("raw_name") or "").strip()
    if not prompt and not raw_name:
        raise HTTPException(status_code=400, detail="prompt 或 raw_name 至少填写一项")
    title = await TitleGenerator.generate(prompt, raw_name)
    return {"title": title, "prompt": prompt, "raw_name": raw_name}


@router.post("/classification/test")
async def test_classification_stream(body: dict, admin=Depends(require_admin)):
    """测试分类 LLM 调用，支持流式/非流式输出"""
    from fastapi.responses import StreamingResponse
    from backend.services.category_service import CategoryService
    import asyncio

    use_stream = body.get("stream", True)
    item_type = body.get("item_type", "prompt")

    # 获取分类列表
    categories = CategoryService.get_all_as_dict()
    cat_text = "\n".join(f"- {slug}: {label}" for slug, label in categories.items())
    system_prompt = ClassificationService.SYSTEM_TEMPLATE.format(categories=cat_text)

    # 获取待分类项目（取前 3 个）
    with get_db() as conn:
        if item_type == "image":
            rows = conn.execute(
                "SELECT id, filename, prompt FROM square_images WHERE (category IS NULL OR category = '') AND COALESCE(is_frozen, FALSE) = FALSE LIMIT 3"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name, prompt FROM prompts WHERE (category IS NULL OR category = '') AND COALESCE(is_frozen, FALSE) = FALSE LIMIT 3"
            ).fetchall()

    if not rows:
        return {"type": "error", "message": "没有待分类的项目"}

    items = [
        {"item_id": str(r["id"]), "name": (r.get("filename") or r.get("name") or ""), "prompt": (r["prompt"] or "")[:300]}
        for r in rows
    ]

    if use_stream:
        async def event_stream():
            async for chunk in ClassificationService.stream_classify_batch(system_prompt, items, use_stream=True):
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
        return StreamingResponse(event_stream(), media_type="text/event-stream")
    else:
        result = []
        async for chunk in ClassificationService.stream_classify_batch(system_prompt, items, use_stream=False):
            result.append(chunk)
        return result[-1] if result else {"type": "error", "message": "无响应"}


@router.get("/classification/tasks/{task_id}/logs")
async def stream_classification_logs(task_id: int, admin=Depends(require_admin)):
    """SSE 端点：实时推送分类任务日志"""
    from fastapi.responses import StreamingResponse

    task = ClassificationService.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    async def event_stream():
        async for log in ClassificationService.get_task_logs(task_id):
            yield f"data: {json.dumps(log, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/audit/tasks")
async def create_content_audit_task(body: dict = {}, admin=Depends(require_admin)):
    item_type=body.get("item_type","prompt")
    try:
        task=ContentAuditService.create_task(admin_id=admin["user_id"],item_type=item_type,limit=int(body.get("limit") or 200))
    except ValueError as e:
        raise HTTPException(status_code=400,detail=str(e))
    import asyncio
    asyncio.create_task(ContentAuditService.run_audit(task["id"]))
    return task


@router.get("/audit/tasks")
async def list_content_audit_tasks(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), admin=Depends(require_admin)):
    return ContentAuditService.list_tasks(page=page,size=size)


@router.get("/audit/tasks/{task_id}")
async def get_content_audit_task(task_id: int, admin=Depends(require_admin)):
    task=ContentAuditService.get_task(task_id)
    if not task:raise HTTPException(status_code=404,detail="任务不存在")
    return task


@router.post("/audit/tasks/{task_id}/approve")
async def approve_content_audit(task_id: int, body: dict, admin=Depends(require_admin)):
    result_ids=body.get("result_ids",[])
    if not result_ids:raise HTTPException(status_code=400,detail="请选择要通过的结果")
    try:
        return ContentAuditService.approve_results(task_id,result_ids)
    except ValueError as e:
        raise HTTPException(status_code=400,detail=str(e))


@router.post("/audit/tasks/{task_id}/reject")
async def reject_content_audit(task_id: int, body: dict, admin=Depends(require_admin)):
    result_ids=body.get("result_ids",[])
    if not result_ids:raise HTTPException(status_code=400,detail="请选择要拒绝的结果")
    return ContentAuditService.reject_results(task_id,result_ids)


@router.post("/audit/results/{result_id}")
async def update_content_audit_result(result_id: int, body: dict, admin=Depends(require_admin)):
    return ContentAuditService.update_result(result_id,body.get("risk_level",""),body.get("confidence",""),body.get("suggested_action","review"),body.get("reason_summary",""),body.get("reason_detail",""),body.get("hit_rules",[]))


@router.get("/audit/tasks/{task_id}/logs")
async def stream_content_audit_logs(task_id: int, admin=Depends(require_admin)):
    from fastapi.responses import StreamingResponse
    task=ContentAuditService.get_task(task_id)
    if not task:raise HTTPException(status_code=404,detail="任务不存在")
    async def event_stream():
        async for log in ContentAuditService.get_task_logs(task_id):
            yield f"data: {json.dumps(log, ensure_ascii=False)}\n\n"
    return StreamingResponse(event_stream(),media_type="text/event-stream")
