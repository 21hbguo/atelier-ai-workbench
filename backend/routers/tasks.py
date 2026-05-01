from fastapi import APIRouter, HTTPException

from backend.services.task_manager import TaskManager
from backend.models.schemas import TaskStatusResponse

router = APIRouter(prefix="/api", tags=["tasks"])


@router.get("/tasks", response_model=list)
async def list_tasks(limit: int = 50, offset: int = 0):
    try:
        tasks = TaskManager.list_tasks(limit=limit, offset=offset)
        return tasks
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取任务列表失败: {str(e)}")


@router.get("/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    task = TaskManager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    return TaskStatusResponse(
        task_id=task["task_id"],
        status=task["status"],
        progress=task.get("progress"),
        result_urls=task.get("result_urls"),
        error=task.get("error"),
    )


@router.post("/tasks/{task_id}/retry")
async def retry_task(task_id: str):
    task = TaskManager.retry_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或状态不允许重试")

    return {"task_id": task_id, "status": "retried", "message": "任务已重置为待处理状态"}


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    success = TaskManager.delete_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"task_id": task_id, "message": "任务已删除"}
