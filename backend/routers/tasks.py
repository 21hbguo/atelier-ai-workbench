import logging
import time
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field

from backend.services.task_manager import TaskManager
from backend.routers.generate import retry_generation_task
from backend.models.schemas import TaskStatusResponse
from backend.auth import get_current_user
from backend.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["tasks"])
GLOBAL_GENERATE_ACTIVE_LIMIT = 20
ACTIVE_TASK_TIMEOUT_MINUTES = 20

class BatchDeleteTasksRequest(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=500)


def _enrich_tasks_with_username(tasks: list) -> list:
    user_ids = {t.get("user_id") for t in tasks if t.get("user_id")}
    if not user_ids:
        return tasks
    with get_db() as conn:
        placeholders = ",".join(["%s"] * len(user_ids))
        rows = conn.execute(
            f"SELECT id, username, nickname FROM users WHERE id IN ({placeholders})",
            list(user_ids),
        ).fetchall()
        user_map = {r["id"]: (r["nickname"] or r["username"]) for r in rows}
    for t in tasks:
        uid = t.get("user_id")
        account = user_map.get(uid, "") if uid else ""
        t["username"] = account
        t["account"] = account
    return tasks
def _to_task_status_response(task: dict) -> TaskStatusResponse:
    params = task.get("params") or {}
    return TaskStatusResponse(task_id=task["task_id"], status=task["status"], progress=task.get("progress"), result_urls=task.get("result_urls"), error=task.get("error"), params=params, prompt=params.get("prompt") or task.get("prompt"), type=task.get("type"), created_at=str(task.get("created_at")) if task.get("created_at") is not None else None, started_at=str(task.get("started_at")) if task.get("started_at") is not None else None, completed_at=str(task.get("completed_at")) if task.get("completed_at") is not None else None)


@router.get("/tasks", response_model=list)
async def list_tasks(
    limit: int = 50,
    offset: int = 0,
    user_id: int = Query(None),
    query: str = Query(None),
    user=Depends(get_current_user),
):
    started = time.perf_counter()
    try:
        TaskManager.fail_stale_active_tasks(ACTIVE_TASK_TIMEOUT_MINUTES)
        is_admin = bool(user.get("is_admin"))
        requester_uid = user.get("user_id")
        if is_admin:
            uid = user_id
        else:
            uid = requester_uid
        tasks = TaskManager.list_tasks(limit=limit, offset=offset, user_id=uid, query=query)
        if is_admin:
            tasks = _enrich_tasks_with_username(tasks)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        if elapsed_ms > 800:
            logger.warning(f"tasks.list slow elapsed_ms={elapsed_ms} limit={limit} offset={offset} count={len(tasks)} requester_uid={requester_uid} is_admin={is_admin} filter_uid={uid} query={'1' if query else '0'}")
        else:
            logger.info(f"tasks.list elapsed_ms={elapsed_ms} limit={limit} offset={offset} count={len(tasks)} requester_uid={requester_uid} is_admin={is_admin} filter_uid={uid} query={'1' if query else '0'}")
        return tasks
    except Exception as e:
        logger.exception("获取任务列表失败")
        raise HTTPException(status_code=500, detail="获取任务列表失败")


@router.get("/tasks/active-summary")
async def get_active_task_summary(user=Depends(get_current_user)):
    TaskManager.fail_stale_active_tasks(ACTIVE_TASK_TIMEOUT_MINUTES)
    with get_db() as conn:
        active = conn.execute("SELECT COUNT(*) AS cnt FROM tasks WHERE LOWER(status) IN ('pending','queued','processing','running','generating') AND completed_at IS NULL AND COALESCE(updated_at,created_at,NOW()) >= NOW() - (%s || ' minutes')::interval", (str(ACTIVE_TASK_TIMEOUT_MINUTES),)).fetchone()["cnt"]
    return {"active_count": active, "global_limit": GLOBAL_GENERATE_ACTIVE_LIMIT, "available_slots": max(0, GLOBAL_GENERATE_ACTIVE_LIMIT - active)}

@router.get("/tasks/by-client/{client_request_id}", response_model=TaskStatusResponse)
async def get_task_status_by_client_request_id(client_request_id: str, user=Depends(get_current_user)):
    TaskManager.fail_stale_active_tasks(ACTIVE_TASK_TIMEOUT_MINUTES)
    task = TaskManager.get_task_by_client_request_id(user["user_id"], client_request_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return _to_task_status_response(task)


@router.get("/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str, user=Depends(get_current_user)):
    TaskManager.fail_stale_active_tasks(ACTIVE_TASK_TIMEOUT_MINUTES)
    task = TaskManager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not user.get("is_admin") and task.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="无权访问此任务")
    return _to_task_status_response(task)


@router.post("/tasks/{task_id}/retry")
async def retry_task(task_id: str, user=Depends(get_current_user)):
    task = TaskManager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not user.get("is_admin") and task.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="无权操作此任务")

    task = retry_generation_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或状态不允许重试")
    return task


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user=Depends(get_current_user)):
    task = TaskManager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not user.get("is_admin") and task.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="无权操作此任务")

    success = TaskManager.delete_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"task_id": task_id, "message": "任务已删除"}

@router.post("/tasks/{task_id}/delete")
async def delete_task_post(task_id: str, user=Depends(get_current_user)):
    return await delete_task(task_id, user)

@router.post("/tasks/batch-delete")
async def batch_delete_tasks(body: BatchDeleteTasksRequest, user=Depends(get_current_user)):
    ids = []
    seen = set()
    for task_id in body.ids or []:
        tid = str(task_id or "").strip()
        if not tid or tid in seen:
            continue
        seen.add(tid)
        ids.append(tid)
    if not ids:
        raise HTTPException(status_code=400, detail="未提供要删除的ID")
    allowed = []
    failed = []
    for task_id in ids:
        task = TaskManager.get_task(task_id)
        if not task:
            failed.append({"id": task_id, "reason": "任务不存在"})
            continue
        if not user.get("is_admin") and task.get("user_id") != user["user_id"]:
            failed.append({"id": task_id, "reason": "无权操作此任务"})
            continue
        allowed.append(task_id)
    deleted_ids = TaskManager.soft_delete_tasks(allowed, "admin" if user.get("is_admin") else "user") if allowed else []
    deleted_set = set(deleted_ids)
    for task_id in allowed:
        if task_id not in deleted_set:
            failed.append({"id": task_id, "reason": "删除失败"})
    return {"deleted": len(deleted_ids), "deleted_ids": deleted_ids, "failed": failed}

@router.post("/tasks/delete-failed")
async def delete_failed_tasks(user_id: int = Query(None), user=Depends(get_current_user)):
    target_user_id = user_id if user.get("is_admin") else user["user_id"]
    deleted_ids = TaskManager.soft_delete_failed_tasks(target_user_id, "admin" if user.get("is_admin") else "user")
    return {"deleted": len(deleted_ids), "deleted_ids": deleted_ids}
