import json
import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from backend.database import get_db
from backend.config import GENERATED_IMAGES_DIR
from backend.services.image_gen import ImageGenService

logger = logging.getLogger(__name__)


class TaskManager:
    _polling_tasks: Dict[str, asyncio.Task] = {}
    _tasks: Dict[str, Dict[str, Any]] = {}
    _active_status = {"pending", "queued", "processing", "running", "generating"}

    @classmethod
    def fail_stale_active_tasks(cls, timeout_minutes: int = 20) -> int:
        timeout_minutes = max(1, int(timeout_minutes or 20))
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with get_db() as conn:
            rows = conn.execute(
                """
                UPDATE tasks
                SET status='failed', error=COALESCE(NULLIF(error,''),'任务超时未完成'), completed_at=COALESCE(completed_at,NOW()), updated_at=NOW()
                WHERE LOWER(status) IN ('pending','queued','processing','running','generating')
                  AND completed_at IS NULL
                  AND COALESCE(updated_at,created_at,NOW()) < NOW() - (%s || ' minutes')::interval
                RETURNING task_id
                """,
                (str(timeout_minutes),),
            ).fetchall()
        for row in rows:
            task_id = row["task_id"]
            task = cls._tasks.get(task_id)
            if task:
                task["status"] = "failed"
                task["error"] = task.get("error") or "任务超时未完成"
                task["completed_at"] = task.get("completed_at") or now
                task["updated_at"] = now
        return len(rows)

    @classmethod
    def _normalize_task(cls, raw: Dict[str, Any]) -> Dict[str, Any]:
        d = dict(raw or {})
        val = d.get("params")
        d["params"] = json.loads(val) if isinstance(val, str) else (val or {})
        val = d.get("result_urls")
        d["result_urls"] = json.loads(val) if isinstance(val, str) else (val or [])
        val = d.get("external_result")
        d["external_result"] = json.loads(val) if isinstance(val, str) else val
        return d

    @classmethod
    def _load_from_db(cls) -> Dict[str, Dict[str, Any]]:
        tasks = {}
        try:
            with get_db() as conn:
                rows = conn.execute("SELECT * FROM tasks").fetchall()
                now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                for row in rows:
                    d = cls._normalize_task(row)
                    if str(d.get("status", "")).lower() in cls._active_status:
                        if d.get("params", {}).get("external_task_id"):
                            d["status"] = "processing"
                            d["_recover"] = True
                        else:
                            d["status"] = "failed"
                            d["error"] = d.get("error") or "服务重启导致任务中断"
                            d["completed_at"] = d.get("completed_at") or now
                            d["updated_at"] = now
                            conn.execute("UPDATE tasks SET status = %s, error = %s, completed_at = %s, updated_at = %s WHERE task_id = %s", (d["status"], d["error"], d["completed_at"], d["updated_at"], d["task_id"]))
                    tasks[d["task_id"]] = d
        except Exception:
            pass
        return tasks

    @classmethod
    def _load_task_from_db(cls, task_id: str) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE task_id = %s", (task_id,)).fetchone()
        if not row:
            return None
        task = cls._normalize_task(row)
        cls._tasks[task_id] = task
        return task

    @classmethod
    def _save_to_db(cls, task_id: str, task: Dict[str, Any], fields: Optional[List[str]] = None) -> None:
        if fields:
            # 只更新指定字段
            set_clauses = []
            values = []
            for f in fields:
                set_clauses.append(f"{f} = %s")
                if f == "params":
                    values.append(json.dumps(task.get("params", {}), ensure_ascii=False))
                elif f == "result_urls":
                    values.append(json.dumps(task.get("result_urls", []), ensure_ascii=False))
                elif f == "external_result":
                    values.append(json.dumps(task.get("external_result"), ensure_ascii=False) if task.get("external_result") else None)
                else:
                    values.append(task.get(f))
            values.append(task_id)
            with get_db() as conn:
                conn.execute(f"UPDATE tasks SET {', '.join(set_clauses)} WHERE task_id = %s", values)
        else:
            # 全量更新
            with get_db() as conn:
                conn.execute(
                    """INSERT INTO tasks
                       (task_id, type, status, params, created_at, updated_at,
                        started_at, completed_at, progress, result_urls, error, external_result, user_id, points_cost, points_balance_after, is_deleted, deleted_at, deleted_by_role)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT(task_id) DO UPDATE SET
                        type=EXCLUDED.type, status=EXCLUDED.status, params=EXCLUDED.params,
                        created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at,
                        started_at=EXCLUDED.started_at, completed_at=EXCLUDED.completed_at,
                        progress=EXCLUDED.progress, result_urls=EXCLUDED.result_urls,
                        error=EXCLUDED.error, external_result=EXCLUDED.external_result,
                        user_id=EXCLUDED.user_id, points_cost=EXCLUDED.points_cost, points_balance_after=EXCLUDED.points_balance_after, is_deleted=EXCLUDED.is_deleted, deleted_at=EXCLUDED.deleted_at, deleted_by_role=EXCLUDED.deleted_by_role""",
                    (
                        task_id,
                        task.get("type", "text"),
                        task.get("status", "pending"),
                        json.dumps(task.get("params", {}), ensure_ascii=False),
                        task.get("created_at"),
                        task.get("updated_at"),
                        task.get("started_at"),
                        task.get("completed_at"),
                        task.get("progress", 0),
                        json.dumps(task.get("result_urls", []), ensure_ascii=False),
                        task.get("error"),
                        json.dumps(task.get("external_result"), ensure_ascii=False) if task.get("external_result") else None,
                        task.get("user_id"),
                        task.get("points_cost", 0),
                        task.get("points_balance_after"),
                        bool(task.get("is_deleted", False)),
                        task.get("deleted_at"),
                        task.get("deleted_by_role"),
                    ),
                )

    @classmethod
    def _delete_from_db(cls, task_id: str) -> None:
        with get_db() as conn:
            conn.execute("DELETE FROM tasks WHERE task_id = %s", (task_id,))

    @classmethod
    def create_task(cls, task_id: str, task_type: str, params: Dict[str, Any], user_id: int = None, points_cost: float = 0, points_balance_after: Optional[float] = None, conn=None) -> Dict[str, Any]:
        task = {
            "task_id": task_id,
            "type": task_type,
            "status": "pending",
            "params": params,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "started_at": None,
            "completed_at": None,
            "progress": 0,
            "result_urls": [],
            "error": None,
            "user_id": user_id,
            "points_cost": points_cost,
            "points_balance_after": points_balance_after,
            "is_deleted": False,
            "deleted_at": None,
            "deleted_by_role": None,
        }
        cls._tasks[task_id] = task
        if conn is not None:
            conn.execute(
                """INSERT INTO tasks
                   (task_id, type, status, params, created_at, updated_at,
                    started_at, completed_at, progress, result_urls, error, external_result, user_id, points_cost, points_balance_after, is_deleted, deleted_at, deleted_by_role)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT(task_id) DO UPDATE SET
                    type=EXCLUDED.type, status=EXCLUDED.status, params=EXCLUDED.params,
                    created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at,
                    started_at=EXCLUDED.started_at, completed_at=EXCLUDED.completed_at,
                    progress=EXCLUDED.progress, result_urls=EXCLUDED.result_urls,
                    error=EXCLUDED.error, external_result=EXCLUDED.external_result,
                    user_id=EXCLUDED.user_id, points_cost=EXCLUDED.points_cost, points_balance_after=EXCLUDED.points_balance_after, is_deleted=EXCLUDED.is_deleted, deleted_at=EXCLUDED.deleted_at, deleted_by_role=EXCLUDED.deleted_by_role""",
                (
                    task_id,
                    task.get("type", "text"),
                    task.get("status", "pending"),
                    json.dumps(task.get("params", {}), ensure_ascii=False),
                    task.get("created_at"),
                    task.get("updated_at"),
                    task.get("started_at"),
                    task.get("completed_at"),
                    task.get("progress", 0),
                    json.dumps(task.get("result_urls", []), ensure_ascii=False),
                    task.get("error"),
                    json.dumps(task.get("external_result"), ensure_ascii=False) if task.get("external_result") else None,
                    task.get("user_id"),
                    task.get("points_cost", 0),
                    task.get("points_balance_after"),
                    bool(task.get("is_deleted", False)),
                    task.get("deleted_at"),
                    task.get("deleted_by_role"),
                ),
            )
        else:
            cls._save_to_db(task_id, task)
        return task

    @classmethod
    def get_task(cls, task_id: str) -> Optional[Dict[str, Any]]:
        task = cls._tasks.get(task_id)
        if task:
            return task
        try:
            return cls._load_task_from_db(task_id)
        except Exception:
            return None
    @classmethod
    def get_task_by_client_request_id(cls, user_id: int, client_request_id: str) -> Optional[Dict[str, Any]]:
        if not client_request_id or user_id is None:
            return None
        with get_db() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE user_id = %s AND params->>'client_request_id' = %s ORDER BY created_at DESC LIMIT 1", (user_id, client_request_id)).fetchone()
        if not row:
            return None
        task = cls._normalize_task(row)
        cls._tasks[task["task_id"]] = task
        return task

    @classmethod
    def list_tasks(cls, limit: int = 50, offset: int = 0, user_id: int = None, query: str = None, include_deleted: bool = False) -> List[Dict[str, Any]]:
        clauses = []
        params: List[Any] = []
        if not include_deleted:
            clauses.append("COALESCE(is_deleted,FALSE)=FALSE")
        if user_id is not None:
            clauses.append("user_id = %s")
            params.append(user_id)
        if query:
            clauses.append("COALESCE(params->>'prompt','') ILIKE %s")
            params.append(f"%{query}%")
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"SELECT * FROM tasks {where_sql} ORDER BY updated_at DESC NULLS LAST LIMIT %s OFFSET %s"
        params.extend([limit, offset])
        with get_db() as conn:
            rows = conn.execute(sql, params).fetchall()
        tasks = [cls._normalize_task(r) for r in rows]
        for t in tasks:
            cls._tasks[t["task_id"]] = t
        return tasks

    @classmethod
    def update_task(cls, task_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        if task_id not in cls._tasks:
            task = cls._load_task_from_db(task_id)
            if task is None:
                return None
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        task = cls._tasks[task_id]
        prev = dict(task)
        prev_status = task.get("status")
        prev_progress = task.get("progress")
        prev_error = task.get("error")
        new_status = kwargs.get("status")
        if new_status == "processing" and not task.get("started_at"):
            kwargs.setdefault("started_at", now)
        if new_status in ("completed", "failed") and not task.get("completed_at"):
            kwargs.setdefault("completed_at", now)
        task.update(kwargs)
        task["updated_at"] = now
        terminal_transition = prev_status not in ("completed", "failed") and new_status in ("completed", "failed")

        # 终态（completed/failed）才写库，高频进度更新只写内存
        if new_status in ("completed", "failed"):
            cls._save_to_db(task_id, task)
        else:
            changed_fields = []
            for f in ("status", "progress", "error", "started_at", "completed_at", "params", "external_result", "result_urls", "points_cost", "points_balance_after"):
                if f in kwargs and task.get(f) != prev.get(f):
                    changed_fields.append(f)
            if changed_fields:
                if "updated_at" not in changed_fields:
                    changed_fields.append("updated_at")
                cls._save_to_db(task_id, task, fields=changed_fields)
        if terminal_transition and task.get("user_id"):
            try:
                from backend.services.notification_service import NotificationService
                if new_status == "completed":
                    prompt = (task.get("params") or {}).get("prompt", "")
                    prompt_display = (prompt[:30] + "…") if len(prompt) > 30 else prompt
                    NotificationService.create(task["user_id"], "task_completed", "生成完成", f"\"{prompt_display}\" 已完成", task_id)
                elif new_status == "failed":
                    prompt = (task.get("params") or {}).get("prompt", "")
                    prompt_display = (prompt[:30] + "…") if len(prompt) > 30 else prompt
                    NotificationService.create(task["user_id"], "task_failed", "生成失败", f"\"{prompt_display}\" 失败：{task.get('error') or '未知错误'}", task_id)
            except Exception:
                pass

        return task

    @classmethod
    def delete_task(cls, task_id: str) -> bool:
        return cls.soft_delete_task(task_id)

    @classmethod
    def soft_delete_task(cls, task_id: str, deleted_by_role: str = "user") -> bool:
        if task_id not in cls._tasks:
            task = cls.get_task(task_id)
            if not task:
                return False
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        task = cls._tasks[task_id]
        task["is_deleted"] = True
        task["deleted_at"] = now
        task["deleted_by_role"] = deleted_by_role
        task["updated_at"] = now
        cls._save_to_db(task_id, task, fields=["is_deleted", "deleted_at", "deleted_by_role", "updated_at"])
        return True

    @classmethod
    def soft_delete_tasks(cls, task_ids: List[str], deleted_by_role: str = "user") -> List[str]:
        ids = []
        seen = set()
        for task_id in task_ids or []:
            tid = str(task_id or "").strip()
            if not tid or tid in seen:
                continue
            seen.add(tid)
            ids.append(tid)
        if not ids:
            return []
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with get_db() as conn:
            rows = conn.execute("SELECT task_id FROM tasks WHERE task_id = ANY(%s)", (ids,)).fetchall()
            existing = [r["task_id"] for r in rows]
            if not existing:
                return []
            conn.execute("UPDATE tasks SET is_deleted = %s, deleted_at = %s, deleted_by_role = %s, updated_at = %s WHERE task_id = ANY(%s)", (True, now, deleted_by_role, now, existing))
        for task_id in existing:
            task = cls._tasks.get(task_id)
            if not task:
                continue
            task["is_deleted"] = True
            task["deleted_at"] = now
            task["deleted_by_role"] = deleted_by_role
            task["updated_at"] = now
        return existing
    @classmethod
    def soft_delete_failed_tasks(cls, user_id: int = None, deleted_by_role: str = "user") -> List[str]:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        clauses = ["LOWER(status) = 'failed'", "COALESCE(is_deleted,FALSE)=FALSE"]
        params: List[Any] = []
        if user_id is not None:
            clauses.append("user_id = %s")
            params.append(user_id)
        where_sql = " AND ".join(clauses)
        with get_db() as conn:
            rows = conn.execute(f"SELECT task_id FROM tasks WHERE {where_sql}", params).fetchall()
            ids = [r["task_id"] for r in rows]
            if not ids:
                return []
            conn.execute("UPDATE tasks SET is_deleted = %s, deleted_at = %s, deleted_by_role = %s, updated_at = %s WHERE task_id = ANY(%s)", (True, now, deleted_by_role, now, ids))
        for task_id in ids:
            task = cls._tasks.get(task_id)
            if not task:
                continue
            task["is_deleted"] = True
            task["deleted_at"] = now
            task["deleted_by_role"] = deleted_by_role
            task["updated_at"] = now
        return ids

    @classmethod
    async def start_polling(cls, task_id: str, external_task_id: str):
        polling_task = asyncio.create_task(cls._poll_task_status(task_id, external_task_id))
        cls._polling_tasks[task_id] = polling_task

    @classmethod
    async def _poll_task_status(cls, task_id: str, external_task_id: str):
        max_attempts = 300
        attempt = 0

        try:
            while attempt < max_attempts:
                attempt += 1
                try:
                    result = await ImageGenService.get_task_status(external_task_id)
                    status = result.get("status", "running").lower()

                    if status in ["success", "completed", "done"]:
                        result_urls = result.get("image_urls", result.get("images", []))
                        local_paths = []
                        for url in result_urls:
                            filename = f"{task_id}_{len(local_paths)}.png"
                            save_path = GENERATED_IMAGES_DIR / filename
                            await ImageGenService.download_image(url, str(save_path))
                            local_paths.append(str(save_path))

                        cls.update_task(
                            task_id,
                            status="completed",
                            progress=100,
                            result_urls=local_paths,
                            external_result=result,
                        )
                        return

                    elif status in ["failed", "error"]:
                        cls.update_task(task_id, status="failed", error=result.get("error", "未知错误"))
                        return

                    elif status in ["queued", "queue"]:
                        cls.update_task(task_id, status="queued", progress=10)
                    elif status in ["processing", "running", "generating"]:
                        progress = result.get("progress", 50)
                        cls.update_task(task_id, status="processing", progress=progress)
                    else:
                        cls.update_task(task_id, status=status)

                except Exception as e:
                    if attempt >= max_attempts:
                        cls.update_task(task_id, status="failed", error=f"轮询失败: {str(e)}")
                        return

                await asyncio.sleep(2)

            cls.update_task(task_id, status="failed", error="轮询超时")
        finally:
            # 轮询完成后清理
            cls._polling_tasks.pop(task_id, None)

    @classmethod
    def retry_task(cls, task_id: str) -> Optional[Dict[str, Any]]:
        task = cls.get_task(task_id)
        if not task:
            return None
        if task["status"] != "failed":
            return None
        task["status"] = "pending"
        task["error"] = None
        task["progress"] = 0
        task["result_urls"] = []
        task["started_at"] = None
        task["completed_at"] = None
        task["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cls._save_to_db(task_id, task)
        return task

    @classmethod
    def remove_image_from_tasks(cls, image_path: str) -> None:
        cls.remove_images_from_tasks([image_path])

    @classmethod
    def remove_images_from_tasks(cls, image_paths: List[str]) -> None:
        targets = {str(path or "").strip() for path in image_paths or [] if str(path or "").strip()}
        if not targets:
            return
        updates = {}
        for task_id, task in cls._tasks.items():
            urls = task.get("result_urls", [])
            new_urls = [u for u in urls if u not in targets]
            if len(new_urls) != len(urls):
                task["result_urls"] = new_urls
                updates[task_id] = new_urls
        with get_db() as conn:
            rows = conn.execute("SELECT task_id, result_urls FROM tasks WHERE COALESCE(is_deleted,FALSE)=FALSE AND COALESCE(result_urls,'[]'::jsonb) <> '[]'::jsonb").fetchall()
            for row in rows:
                urls = row["result_urls"]
                if isinstance(urls, str):
                    try:
                        urls = json.loads(urls or "[]")
                    except (json.JSONDecodeError, TypeError):
                        continue
                else:
                    urls = urls or []
                new_urls = [u for u in urls if u not in targets]
                if len(new_urls) != len(urls):
                    updates[row["task_id"]] = new_urls
            for task_id, new_urls in updates.items():
                conn.execute("UPDATE tasks SET result_urls = %s WHERE task_id = %s", (json.dumps(new_urls, ensure_ascii=False), task_id))


    @classmethod
    async def recover_orphaned_tasks(cls):
        """启动时恢复服务中断前正在轮询的任务"""
        from backend.services.generation_service import poll_and_download as _poll_and_download
        recovered = 0
        for task_id, task in list(cls._tasks.items()):
            if task.pop("_recover", None):
                external_task_id = task["params"].get("external_task_id")
                if external_task_id:
                    meta = {
                        "prompt": task["params"].get("prompt", ""),
                        "size": task["params"].get("size"),
                        "type": task.get("type", "text"),
                        "task_id": task_id,
                    }
                    provider_id = task["params"].get("provider_id") or "wuyin-main"
                    asyncio.create_task(cls._recover_task(task_id, provider_id, external_task_id, meta, task.get("user_id")))
                    recovered += 1
        if recovered:
            logger.info(f"[recover] 恢复了 {recovered} 个中断的任务")

    @classmethod
    async def _recover_task(cls, task_id, provider_id, external_task_id, meta, user_id):
        from backend.services.generation_service import poll_and_download as _poll_and_download
        from backend.services.finance_service import FinanceService
        from backend.services.points_service import PointsService
        task = cls.get_task(task_id)
        cost = (task or {}).get("points_cost") or 0
        try:
            urls = await _poll_and_download(provider_id, external_task_id, task_id, meta, user_id=user_id)
            if urls:
                cls.update_task(task_id, status="completed", progress=100, result_urls=urls)
                try:
                    FinanceService.record_task_entry(task_id, "completed")
                except Exception:
                    logger.exception(f"[recover.finance.fail] task={task_id} status=completed")
            else:
                cls.update_task(task_id, status="failed", error="恢复轮询未获取到结果")
                try:
                    FinanceService.record_task_entry(task_id, "failed")
                except Exception:
                    logger.exception(f"[recover.finance.fail] task={task_id} status=failed")
                if user_id and cost > 0:
                    try:
                        PointsService.refund(user_id, cost, "恢复失败退还", request_key=f"refund:{task_id}")
                    except Exception:
                        logger.exception(f"[recover.refund.fail] task={task_id} user={user_id}")
        except Exception as e:
            cls.update_task(task_id, status="failed", error=f"恢复轮询失败: {e}")
            try:
                FinanceService.record_task_entry(task_id, "failed")
            except Exception:
                logger.exception(f"[recover.finance.fail] task={task_id} status=failed")
            if user_id and cost > 0:
                try:
                    PointsService.refund(user_id, cost, "恢复失败退还", request_key=f"refund:{task_id}")
                except Exception:
                    logger.exception(f"[recover.refund.fail] task={task_id} user={user_id}")


# 启动时从数据库加载
TaskManager._tasks = TaskManager._load_from_db()
