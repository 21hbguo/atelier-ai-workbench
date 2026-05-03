import json
import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional
from backend.database import get_db
from backend.config import GENERATED_IMAGES_DIR
from backend.services.image_gen import ImageGenService


class TaskManager:
    _polling_tasks: Dict[str, asyncio.Task] = {}
    _tasks: Dict[str, Dict[str, Any]] = {}
    _active_status = {"pending", "queued", "processing", "running", "generating"}

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
                        started_at, completed_at, progress, result_urls, error, external_result, user_id, points_cost, points_balance_after)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT(task_id) DO UPDATE SET
                        type=EXCLUDED.type, status=EXCLUDED.status, params=EXCLUDED.params,
                        created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at,
                        started_at=EXCLUDED.started_at, completed_at=EXCLUDED.completed_at,
                        progress=EXCLUDED.progress, result_urls=EXCLUDED.result_urls,
                        error=EXCLUDED.error, external_result=EXCLUDED.external_result,
                        user_id=EXCLUDED.user_id, points_cost=EXCLUDED.points_cost, points_balance_after=EXCLUDED.points_balance_after""",
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
                    ),
                )

    @classmethod
    def _delete_from_db(cls, task_id: str) -> None:
        with get_db() as conn:
            conn.execute("DELETE FROM tasks WHERE task_id = %s", (task_id,))

    @classmethod
    def create_task(cls, task_id: str, task_type: str, params: Dict[str, Any], user_id: int = None, points_cost: int = 0, points_balance_after: Optional[int] = None) -> Dict[str, Any]:
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
        }
        cls._tasks[task_id] = task
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
    def list_tasks(cls, limit: int = 50, offset: int = 0, user_id: int = None, query: str = None) -> List[Dict[str, Any]]:
        clauses = []
        params: List[Any] = []
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

        # 终态（completed/failed）才写库，高频进度更新只写内存
        if new_status in ("completed", "failed"):
            cls._save_to_db(task_id, task)
        else:
            changed_fields = []
            for f in ("status", "progress", "error", "started_at", "completed_at", "params", "external_result", "result_urls"):
                if f in kwargs and task.get(f) != prev.get(f):
                    changed_fields.append(f)
            if changed_fields:
                if "updated_at" not in changed_fields:
                    changed_fields.append("updated_at")
                cls._save_to_db(task_id, task, fields=changed_fields)

        return task

    @classmethod
    def delete_task(cls, task_id: str) -> bool:
        if task_id not in cls._tasks:
            task = cls.get_task(task_id)
            if not task:
                return False
        cls._tasks.pop(task_id, None)
        cls._delete_from_db(task_id)
        return True

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
        changed = False
        for task in cls._tasks.values():
            urls = task.get("result_urls", [])
            if image_path in urls:
                task["result_urls"] = [u for u in urls if u != image_path]
                changed = True
        if changed:
            with get_db() as conn:
                rows = conn.execute("SELECT task_id, result_urls FROM tasks").fetchall()
                for row in rows:
                    try:
                        urls = json.loads(row["result_urls"] or "[]")
                    except (json.JSONDecodeError, TypeError):
                        continue
                    if image_path in urls:
                        new_urls = [u for u in urls if u != image_path]
                        conn.execute(
                            "UPDATE tasks SET result_urls = %s WHERE task_id = %s",
                            (json.dumps(new_urls, ensure_ascii=False), row["task_id"]),
                        )


    @classmethod
    async def recover_orphaned_tasks(cls):
        """启动时恢复服务中断前正在轮询的任务"""
        from backend.routers.generate import _poll_and_download
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
                    asyncio.create_task(cls._recover_task(task_id, external_task_id, meta, task.get("user_id")))
                    recovered += 1
        if recovered:
            logger = __import__("logging").getLogger(__name__)
            logger.info(f"[recover] 恢复了 {recovered} 个中断的任务")

    @classmethod
    async def _recover_task(cls, task_id, external_task_id, meta, user_id):
        from backend.routers.generate import _poll_and_download
        try:
            urls = await _poll_and_download(external_task_id, task_id, meta, user_id=user_id)
            if urls:
                cls.update_task(task_id, status="completed", progress=100, result_urls=urls)
            else:
                cls.update_task(task_id, status="failed", error="恢复轮询未获取到结果")
        except Exception as e:
            cls.update_task(task_id, status="failed", error=f"恢复轮询失败: {e}")


# 启动时从数据库加载
TaskManager._tasks = TaskManager._load_from_db()
