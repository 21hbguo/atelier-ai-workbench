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

    @classmethod
    def _load_from_db(cls) -> Dict[str, Dict[str, Any]]:
        tasks = {}
        try:
            with get_db() as conn:
                rows = conn.execute("SELECT * FROM tasks").fetchall()
                now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                for row in rows:
                    d = dict(row)
                    val = d.get("params")
                    d["params"] = json.loads(val) if isinstance(val, str) else (val or {})
                    val = d.get("result_urls")
                    d["result_urls"] = json.loads(val) if isinstance(val, str) else (val or [])
                    val = d.get("external_result")
                    d["external_result"] = json.loads(val) if isinstance(val, str) else val
                    if str(d.get("status", "")).lower() in {"pending", "queued", "processing", "running", "generating"}:
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
                        started_at, completed_at, progress, result_urls, error, external_result, user_id)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT(task_id) DO UPDATE SET
                        type=EXCLUDED.type, status=EXCLUDED.status, params=EXCLUDED.params,
                        created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at,
                        started_at=EXCLUDED.started_at, completed_at=EXCLUDED.completed_at,
                        progress=EXCLUDED.progress, result_urls=EXCLUDED.result_urls,
                        error=EXCLUDED.error, external_result=EXCLUDED.external_result,
                        user_id=EXCLUDED.user_id""",
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
                    ),
                )

    @classmethod
    def _delete_from_db(cls, task_id: str) -> None:
        with get_db() as conn:
            conn.execute("DELETE FROM tasks WHERE task_id = %s", (task_id,))

    @classmethod
    def create_task(cls, task_id: str, task_type: str, params: Dict[str, Any], user_id: int = None) -> Dict[str, Any]:
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
        }
        cls._tasks[task_id] = task
        cls._save_to_db(task_id, task)
        return task

    @classmethod
    def get_task(cls, task_id: str) -> Optional[Dict[str, Any]]:
        return cls._tasks.get(task_id)

    @classmethod
    def list_tasks(cls, limit: int = 50, offset: int = 0, user_id: int = None, query: str = None) -> List[Dict[str, Any]]:
        all_tasks = cls._tasks.values()
        if user_id is not None:
            all_tasks = [t for t in all_tasks if t.get("user_id") == user_id]
        else:
            all_tasks = list(all_tasks)
        if query:
            q = query.lower()
            all_tasks = [t for t in all_tasks if q in (t.get("params") or {}).get("prompt", "").lower()]
        all_tasks.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return all_tasks[offset:offset + limit]

    @classmethod
    def update_task(cls, task_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        if task_id not in cls._tasks:
            return None
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        task = cls._tasks[task_id]
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
            if ("status" in kwargs and kwargs.get("status") != prev_status) or ("progress" in kwargs and kwargs.get("progress") != prev_progress) or ("error" in kwargs and kwargs.get("error") != prev_error):
                cls._save_to_db(task_id, task, fields=["status", "progress", "updated_at", "started_at", "completed_at", "error"])

        return task

    @classmethod
    def delete_task(cls, task_id: str) -> bool:
        if task_id in cls._tasks:
            del cls._tasks[task_id]
            cls._delete_from_db(task_id)
            return True
        return False

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
        if task_id not in cls._tasks:
            return None
        task = cls._tasks[task_id]
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


# 启动时从数据库加载
TaskManager._tasks = TaskManager._load_from_db()
