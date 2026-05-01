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
                for row in rows:
                    d = dict(row)
                    try:
                        d["params"] = json.loads(d.get("params") or "{}")
                    except (json.JSONDecodeError, TypeError):
                        d["params"] = {}
                    try:
                        d["result_urls"] = json.loads(d.get("result_urls") or "[]")
                    except (json.JSONDecodeError, TypeError):
                        d["result_urls"] = []
                    try:
                        d["external_result"] = json.loads(d["external_result"]) if d.get("external_result") else None
                    except (json.JSONDecodeError, TypeError):
                        d["external_result"] = None
                    tasks[d["task_id"]] = d
        except Exception:
            pass
        return tasks

    @classmethod
    def _save_to_db(cls, task_id: str, task: Dict[str, Any]) -> None:
        with get_db() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO tasks
                   (task_id, type, status, params, created_at, updated_at,
                    started_at, completed_at, progress, result_urls, error, external_result)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                ),
            )

    @classmethod
    def _delete_from_db(cls, task_id: str) -> None:
        with get_db() as conn:
            conn.execute("DELETE FROM tasks WHERE task_id = ?", (task_id,))

    @classmethod
    def create_task(cls, task_id: str, task_type: str, params: Dict[str, Any]) -> Dict[str, Any]:
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
        }
        cls._tasks[task_id] = task
        cls._save_to_db(task_id, task)
        return task

    @classmethod
    def get_task(cls, task_id: str) -> Optional[Dict[str, Any]]:
        return cls._tasks.get(task_id)

    @classmethod
    def list_tasks(cls, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        all_tasks = sorted(
            cls._tasks.values(),
            key=lambda x: x.get("updated_at", ""),
            reverse=True,
        )
        return all_tasks[offset:offset + limit]

    @classmethod
    def update_task(cls, task_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        if task_id not in cls._tasks:
            return None
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        task = cls._tasks[task_id]
        new_status = kwargs.get("status")
        if new_status == "processing" and not task.get("started_at"):
            kwargs.setdefault("started_at", now)
        if new_status in ("completed", "failed") and not task.get("completed_at"):
            kwargs.setdefault("completed_at", now)
        task.update(kwargs)
        task["updated_at"] = now
        cls._save_to_db(task_id, task)
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
                            "UPDATE tasks SET result_urls = ? WHERE task_id = ?",
                            (json.dumps(new_urls, ensure_ascii=False), row["task_id"]),
                        )


# 启动时从 SQLite 加载
TaskManager._tasks = TaskManager._load_from_db()
