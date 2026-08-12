"""生图路由（薄壳）：全部核心逻辑已抽取到 backend.services.generation_service。

本文件只负责 HTTP 层：参数解析、GenerationError → HTTPException 映射、响应组装。
对外行为（状态码、响应 JSON、错误消息、402 积分不足、409 幂等重复等）与原实现完全一致。
"""
import logging
from fastapi import APIRouter, HTTPException, Depends, Request

from backend.auth import get_current_user, get_client_ip
from backend.models.schemas import (
    GenerateTextRequest,
    GenerateTextImageRequest,
    GenerateResponse,
)
from backend.services.generation_service import (
    GenerationError,
    create_generation_task,
    # 以下为兼容性 re-export（task_manager / tasks 路由 / 既有测试仍引用）
    retry_generation_task,
    poll_and_download as _poll_and_download,  # noqa: F401
    get_model_cost as _get_model_cost,  # noqa: F401
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/generate", tags=["generate"])
GLOBAL_GENERATE_ACTIVE_LIMIT = 20


@router.post("/text", response_model=GenerateResponse)
async def generate_text(request: GenerateTextRequest, req: Request, user=Depends(get_current_user)):
    user_id = user["user_id"]
    try:
        result = create_generation_task(
            user_id,
            "text",
            {
                "prompt": request.prompt,
                "size": request.size,
                "resolution": request.resolution,
                "aspect_ratio": request.aspect_ratio,
                "quality": request.quality,
                "model_id": request.model_id,
                "share_to_square": bool(request.share_to_square),
                "client_request_id": request.client_request_id,
            },
            task_id=request.task_id,
            is_admin=bool(user.get("is_admin")),
            ip=get_client_ip(req),
        )
        return GenerateResponse(task_id=result["task_id"], status=result["status"], message=result.get("message", "任务已提交"))
    except GenerationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.post("/text-image", response_model=GenerateResponse)
async def generate_text_image(request: GenerateTextImageRequest, req: Request, user=Depends(get_current_user)):
    user_id = user["user_id"]
    try:
        result = create_generation_task(
            user_id,
            "text_image",
            {
                "prompt": request.prompt,
                "size": request.size,
                "resolution": request.resolution,
                "aspect_ratio": request.aspect_ratio,
                "quality": request.quality,
                "model_id": request.model_id,
                "image_urls": request.image_urls,
                "share_to_square": bool(request.share_to_square),
                "client_request_id": request.client_request_id,
            },
            task_id=request.task_id,
            is_admin=bool(user.get("is_admin")),
            ip=get_client_ip(req),
        )
        return GenerateResponse(task_id=result["task_id"], status=result["status"], message=result.get("message", "任务已提交"))
    except GenerationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
