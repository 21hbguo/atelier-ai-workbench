import logging
import time
from fastapi import APIRouter, HTTPException, Depends, Query

from backend.services.task_manager import TaskManager
from backend.models.schemas import TaskStatusResponse
from backend.auth import get_current_user
from backend.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["tasks"])
GLOBAL_GENERATE_ACTIVE_LIMIT = 20
ACTIVE_TASK_TIMEOUT_MINUTES = 20


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


@router.get("/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str, user=Depends(get_current_user)):
    task = TaskManager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not user.get("is_admin") and task.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="无权访问此任务")

    return TaskStatusResponse(
        task_id=task["task_id"],
        status=task["status"],
        progress=task.get("progress"),
        result_urls=task.get("result_urls"),
        error=task.get("error"),
    )


@router.post("/tasks/{task_id}/retry")
async def retry_task(task_id: str, user=Depends(get_current_user)):
    task = TaskManager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not user.get("is_admin") and task.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="无权操作此任务")

    task = TaskManager.retry_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或状态不允许重试")
    return {"task_id": task_id, "status": "retried", "message": "任务已重置为待处理状态"}


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
