import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from backend.auth import get_current_user
from backend.services.prompt_optimizer import PromptOptimizer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/prompt", tags=["prompt-optimize"])


class PromptOptimizeRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=500)
    count: int = Field(1, ge=1, le=3)


class PromptOptimizeResponse(BaseModel):
    versions: list[str]
    original: str


@router.post("/optimize", response_model=PromptOptimizeResponse)
async def optimize_prompt(body: PromptOptimizeRequest, user=Depends(get_current_user)):
    try:
        versions = await PromptOptimizer.optimize(body.prompt, body.count)
        return PromptOptimizeResponse(versions=versions, original=body.prompt)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("[optimize] prompt optimization failed")
        return PromptOptimizeResponse(versions=[body.prompt], original=body.prompt)
