import uuid
import json
import asyncio
import logging
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Request

logger = logging.getLogger(__name__)

from backend.services.image_gen import ImageGenService
from backend.services.task_manager import TaskManager
from backend.services.stats_service import StatsService
from backend.services.banned_words import BannedWordsService
from backend.services.points_service import PointsService
from backend.config import GENERATED_IMAGES_DIR
from backend.models.schemas import (
    GenerateTextRequest,
    GenerateTextImageRequest,
    GenerateResponse,
)
from backend.auth import get_current_user, record_request, update_user_ip, get_client_ip
from backend.database import get_db

router = APIRouter(prefix="/api/generate", tags=["generate"])


def _check_generate_rate(user_id: int):
    with get_db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM user_requests WHERE user_id = ? AND status = 'processing' AND created_at > datetime('now', '-1 minute')",
            (user_id,)
        ).fetchone()[0]
        if count >= 10:
            raise HTTPException(status_code=429, detail="生成请求过于频繁，请稍后再试")


@router.post("/text", response_model=GenerateResponse)
async def generate_text(request: GenerateTextRequest, req: Request, user=Depends(get_current_user)):
    user_id = user["user_id"]
    _check_generate_rate(user_id)

    is_admin = user.get("is_admin")
    if not is_admin:
        try:
            PointsService.consume(user_id, PointsService.COST_PER_GENERATION, "生成消耗")
        except ValueError:
            raise HTTPException(status_code=402, detail=f"积分不足，需要 {PointsService.COST_PER_GENERATION} 积分")

    update_user_ip(user_id, get_client_ip(req))
    record_request(user_id, "processing")

    try:
        StatsService.record_request()
        task_id = request.task_id or str(uuid.uuid4())

        banned_word = BannedWordsService.check(request.prompt)
        if banned_word:
            await asyncio.sleep(10)
            TaskManager.update_task(task_id, status="failed", error="提示词包含违禁词")
            StatsService.record_failed()
            record_request(user_id, "failed")
            if not is_admin:
                PointsService.refund(user_id, PointsService.COST_PER_GENERATION, "违禁词退还")
            raise HTTPException(status_code=400, detail="提示词包含违禁词，请修改后重试")

        TaskManager.create_task(task_id, "text", {"prompt": request.prompt, "size": request.size}, user_id=user_id)
        TaskManager.update_task(task_id, status="processing", progress=10)

        try:
            result = await ImageGenService.submit_task(prompt=request.prompt, size=request.size)
        except Exception as e:
            TaskManager.update_task(task_id, status="failed", error=str(e))
            StatsService.record_failed()
            record_request(user_id, "failed")
            if not is_admin:
                PointsService.refund(user_id, PointsService.COST_PER_GENERATION, "提交失败退还")
            logger.exception("提交任务失败")
            raise HTTPException(status_code=500, detail="提交任务失败")

        external_task_id = result["task_id"]
        meta = {"prompt": request.prompt, "size": request.size, "type": "text", "task_id": task_id}
        urls = await _poll_and_download(external_task_id, task_id, meta, user_id=user_id)

        if urls:
            TaskManager.update_task(task_id, status="completed", progress=100, result_urls=urls)
            StatsService.record_success()
            record_request(user_id, "success")
            return GenerateResponse(task_id=task_id, status="completed", message="生成完成")
        else:
            TaskManager.update_task(task_id, status="failed", error="未获取到图片结果")
            StatsService.record_failed()
            record_request(user_id, "failed")
            if not is_admin:
                PointsService.refund(user_id, PointsService.COST_PER_GENERATION, "无结果退还")
            raise HTTPException(status_code=500, detail="生成失败: 未获取到图片结果")

    except HTTPException:
        raise
    except Exception as e:
        TaskManager.update_task(task_id, status="failed", error=str(e))
        record_request(user_id, "failed")
        if not is_admin:
            PointsService.refund(user_id, PointsService.COST_PER_GENERATION, "异常退还")
        logger.exception("生成失败")
        raise HTTPException(status_code=500, detail="生成失败")


@router.post("/text-image", response_model=GenerateResponse)
async def generate_text_image(request: GenerateTextImageRequest, req: Request, user=Depends(get_current_user)):
    user_id = user["user_id"]
    _check_generate_rate(user_id)

    is_admin = user.get("is_admin")
    if not is_admin:
        try:
            PointsService.consume(user_id, PointsService.COST_PER_GENERATION, "生成消耗")
        except ValueError:
            raise HTTPException(status_code=402, detail=f"积分不足，需要 {PointsService.COST_PER_GENERATION} 积分")

    update_user_ip(user_id, get_client_ip(req))
    record_request(user_id, "processing")

    try:
        StatsService.record_request()
        task_id = request.task_id or str(uuid.uuid4())

        banned_word = BannedWordsService.check(request.prompt)
        if banned_word:
            await asyncio.sleep(10)
            TaskManager.update_task(task_id, status="failed", error="提示词包含违禁词")
            StatsService.record_failed()
            record_request(user_id, "failed")
            if not is_admin:
                PointsService.refund(user_id, PointsService.COST_PER_GENERATION, "违禁词退还")
            raise HTTPException(status_code=400, detail="提示词包含违禁词，请修改后重试")

        TaskManager.create_task(task_id, "text_image", {"prompt": request.prompt, "size": request.size, "image_urls": request.image_urls}, user_id=user_id)
        TaskManager.update_task(task_id, status="processing", progress=10)

        try:
            result = await ImageGenService.submit_task(prompt=request.prompt, size=request.size, urls=request.image_urls)
        except Exception as e:
            TaskManager.update_task(task_id, status="failed", error=str(e))
            StatsService.record_failed()
            record_request(user_id, "failed")
            if not is_admin:
                PointsService.refund(user_id, PointsService.COST_PER_GENERATION, "提交失败退还")
            logger.exception("提交任务失败")
            raise HTTPException(status_code=500, detail="提交任务失败")

        external_task_id = result["task_id"]
        meta = {"prompt": request.prompt, "size": request.size, "type": "text_image", "task_id": task_id, "input_urls": request.image_urls}
        urls = await _poll_and_download(external_task_id, task_id, meta, user_id=user_id)

        if urls:
            TaskManager.update_task(task_id, status="completed", progress=100, result_urls=urls)
            StatsService.record_success()
            record_request(user_id, "success")
            return GenerateResponse(task_id=task_id, status="completed", message="生成完成")
        else:
            TaskManager.update_task(task_id, status="failed", error="未获取到图片结果")
            StatsService.record_failed()
            record_request(user_id, "failed")
            if not is_admin:
                PointsService.refund(user_id, PointsService.COST_PER_GENERATION, "无结果退还")
            raise HTTPException(status_code=500, detail="生成失败: 未获取到图片结果")

    except HTTPException:
        raise
    except Exception as e:
        TaskManager.update_task(task_id, status="failed", error=str(e))
        record_request(user_id, "failed")
        if not is_admin:
            PointsService.refund(user_id, PointsService.COST_PER_GENERATION, "异常退还")
        logger.exception("生成失败")
        raise HTTPException(status_code=500, detail="生成失败")


async def _poll_and_download(external_task_id: str, task_id: str, meta: dict = None, user_id: int = None) -> list:
    max_attempts = 300
    consecutive_errors = 0
    start_time = datetime.now()
    first_poll = True
    for attempt in range(max_attempts):
        if first_poll:
            await asyncio.sleep(10)
            first_poll = False
        else:
            elapsed = (datetime.now() - start_time).total_seconds()
            if elapsed < 30:
                await asyncio.sleep(10)
            elif elapsed < 60:
                await asyncio.sleep(5)
            else:
                await asyncio.sleep(3)

        try:
            result = await ImageGenService.get_task_result(external_task_id)
            consecutive_errors = 0
            logger.info(f"[poll] task={task_id} attempt={attempt} status={result.get('status') if isinstance(result, dict) else 'ok'}")
        except Exception as e:
            consecutive_errors += 1
            logger.warning(f"[poll] task={task_id} error={e} consecutive={consecutive_errors}")
            if consecutive_errors >= 10:
                return []
            continue

        if result is None:
            continue

        if isinstance(result, dict) and result.get("status") == 0:
            continue

        if isinstance(result, dict):
            raw_urls = result.get("result") or result.get("urls") or result.get("images")
            logger.info(f"[poll] task={task_id} got {len(raw_urls) if isinstance(raw_urls, list) else 1} results")
            if raw_urls is None:
                raw_urls = [result]
        else:
            raw_urls = [result]

        if not isinstance(raw_urls, list):
            raw_urls = [raw_urls]

        local_paths = []
        for i, item in enumerate(raw_urls):
            if isinstance(item, dict):
                url = item.get("url") or item.get("image") or item.get("img")
            else:
                url = str(item).strip().strip('`').strip()

            if not url:
                continue

            if not url.startswith(("http://", "https://")):
                url = "https://" + url

            filename = f"{task_id}_{i}.png"
            save_path = str(GENERATED_IMAGES_DIR / filename)
            logger.info(f"[poll] task={task_id} downloading image {i}")

            if await ImageGenService.download_image(url, save_path):
                local_paths.append(save_path)
                image_meta = meta or {}
                image_meta["created_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                with get_db() as conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO image_metadata (filename, metadata, created_at, user_id) VALUES (?, ?, ?, ?)",
                        (filename, json.dumps(image_meta, ensure_ascii=False), image_meta["created_at"], user_id),
                    )

        return local_paths

    return []
