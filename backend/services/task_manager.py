import json
import os
import asyncio
import threading
from typing import Dict, Any, List, Optional
from datetime import datetime
from pathlib import Path

from backend.config import TASKS_JSON, GENERATED_IMAGES_DIR
from backend.services.image_gen import ImageGenService


class TaskManager:
    _tasks: Dict[str, Dict[str, Any]] = {}
    _lock = threading.Lock()
    _polling_tasks: Dict[str, asyncio.Task] = {}

    @classmethod
    def _load_tasks(cls) -> Dict[str, Any]:
        if os.path.exists(TASKS_JSON):
            try:
                with open(TASKS_JSON, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, Exception):
                return {}
        return {}

    @classmethod
    def _save_tasks(cls) -> None:
        with open(TASKS_JSON, "w", encoding="utf-8") as f:
            json.dump(cls._tasks, f, ensure_ascii=False, indent=2)

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
        with cls._lock:
            cls._tasks[task_id] = task
            cls._save_tasks()
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
        with cls._lock:
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
            cls._save_tasks()
            return task

    @classmethod
    def delete_task(cls, task_id: str) -> bool:
        with cls._lock:
            if task_id in cls._tasks:
                del cls._tasks[task_id]
                cls._save_tasks()
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
                    cls.update_task(
                        task_id,
                        status="failed",
                        error=result.get("error", "未知错误"),
                    )
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
        with cls._lock:
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
            cls._save_tasks()
            return task
