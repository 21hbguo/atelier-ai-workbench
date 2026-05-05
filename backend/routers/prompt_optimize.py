import logging
import json
import uuid
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from backend.auth import get_current_user
from backend.services.prompt_optimizer import PromptOptimizer
from backend.services.points_service import PointsService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/prompt", tags=["prompt-optimize"])


class PromptOptimizeRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=500)
    count: int = Field(1, ge=1, le=3)


class PromptOptimizeResponse(BaseModel):
    versions: list[str]
    original: str
    points_balance: int | None = None


@router.post("/optimize", response_model=PromptOptimizeResponse)
async def optimize_prompt(body: PromptOptimizeRequest, user=Depends(get_current_user)):
    user_id = user["user_id"]
    cost_per = PointsService.cost_per_generation()
    total_cost = cost_per * body.count
    req_id = str(uuid.uuid4())

    try:
        balance_after = PointsService.consume(user_id, total_cost, f"提示词优化 x{body.count}", tx_type="prompt_optimize", request_key=f"optimize:{req_id}")
    except ValueError as e:
        raise HTTPException(status_code=402, detail=str(e))

    try:
        versions = await PromptOptimizer.optimize(body.prompt, body.count)
        return PromptOptimizeResponse(versions=versions, original=body.prompt, points_balance=balance_after)
    except ValueError as e:
        PointsService.refund(user_id, total_cost, "优化失败退还", request_key=f"optimize_refund:{req_id}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("[optimize] prompt optimization failed")
        PointsService.refund(user_id, total_cost, "优化失败退还", request_key=f"optimize_refund:{req_id}")
        return PromptOptimizeResponse(versions=[body.prompt], original=body.prompt, points_balance=PointsService.get_balance(user_id))


@router.post("/optimize/stream")
async def optimize_prompt_stream(body: PromptOptimizeRequest, user=Depends(get_current_user)):
    user_id = user["user_id"]
    cost_per = PointsService.cost_per_generation()
    total_cost = cost_per * body.count
    req_id = str(uuid.uuid4())

    try:
        balance_after = PointsService.consume(user_id, total_cost, f"提示词优化 x{body.count}", tx_type="prompt_optimize", request_key=f"optimize:{req_id}")
    except ValueError as e:
        raise HTTPException(status_code=402, detail=str(e))

    async def event_generator():
        refunded = False
        try:
            async for event in PromptOptimizer.optimize_stream(body.prompt, body.count):
                if event["type"] == "chunk":
                    yield f"event: chunk\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                elif event["type"] == "done":
                    yield f"event: done\ndata: {json.dumps({'versions': event['versions'], 'points_balance': balance_after}, ensure_ascii=False)}\n\n"
                elif event["type"] == "error":
                    PointsService.refund(user_id, total_cost, "优化失败退还", request_key=f"optimize_refund:{req_id}")
                    refunded = True
                    yield f"event: error\ndata: {json.dumps({'detail': event['detail']}, ensure_ascii=False)}\n\n"
        except Exception:
            logger.exception("[optimize/stream] unexpected error")
            if not refunded:
                PointsService.refund(user_id, total_cost, "优化失败退还", request_key=f"optimize_refund:{req_id}")
            yield f"event: error\ndata: {json.dumps({'detail': '优化失败，请重试'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
