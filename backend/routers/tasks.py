from fastapi import APIRouter, HTTPException, Depends, Query

from backend.services.task_manager import TaskManager
from backend.models.schemas import TaskStatusResponse
from backend.auth import get_current_user
from backend.database import get_db

router = APIRouter(prefix="/api", tags=["tasks"])


def _enrich_tasks_with_username(tasks: list) -> list:
    user_ids = {t.get("user_id") for t in tasks if t.get("user_id")}
    if not user_ids:
        return tasks
    with get_db() as conn:
        placeholders = ",".join("?" * len(user_ids))
        rows = conn.execute(
            f"SELECT id, username, nickname FROM users WHERE id IN ({placeholders})",
            list(user_ids),
        ).fetchall()
        user_map = {r["id"]: (r["nickname"] or r["username"]) for r in rows}
    for t in tasks:
        uid = t.get("user_id")
        t["username"] = user_map.get(uid, "") if uid else ""
    return tasks


@router.get("/tasks", response_model=list)
async def list_tasks(
    limit: int = 50,
    offset: int = 0,
    user_id: int = Query(None),
    user=Depends(get_current_user),
):
    try:
        if user.get("is_admin"):
            uid = user_id
        else:
            uid = user["user_id"]
        tasks = TaskManager.list_tasks(limit=limit, offset=offset, user_id=uid)
        if user.get("is_admin"):
            tasks = _enrich_tasks_with_username(tasks)
        return tasks
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取任务列表失败: {str(e)}")


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
