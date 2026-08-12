"""生图公共服务层：/api/generate 路由与 AI 助手 image_gen 工具共用。

从 backend/routers/generate.py 抽取（行为与原路由完全一致）：
套餐校验（allowed_models）、违禁词校验、并发限制、PointsService 扣费（request_key 幂等）、
tasks 行创建、后台 asyncio 生成流程（提交上游 GenGateway → 轮询 → 下载 → 更新状态 →
image_metadata 写入 → 失败退款）。错误统一抛 :class:`GenerationError`，
message 可直接展示给用户，status_code 供路由层映射 HTTP 状态码。
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from backend.auth import record_request, update_user_ip
from backend.config import GENERATED_IMAGES_DIR, get_config, get_generation_models, get_limit_config
from backend.database import get_db
from backend.services.banned_words import BannedWordsService
from backend.services.finance_service import FinanceService
from backend.services.gen_gateway import GenGateway
from backend.services.image_expiry import RETENTION_DAYS, mark_image_permanent
from backend.services.points_service import PointsService
from backend.services.prompt_embedding_service import PromptEmbeddingService
from backend.services.stats_service import StatsService
from backend.services.subscription_service import get_entitlements_in_conn
from backend.services.task_manager import TaskManager

logger = logging.getLogger(__name__)

GLOBAL_GENERATE_ACTIVE_LIMIT = 20


class GenerationError(Exception):
    """生图失败异常：message 可直接展示给用户；status_code 供路由层映射 HTTP 状态码。"""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def get_model_cost(model_id: str, resolution: str = None) -> int:
    """按模型档案 points_cost 或 grsai-vip 分辨率档位计算单次生图积分成本。"""
    models = get_generation_models() or {}
    model = models.get(model_id) or {}
    params = model.get("params") or {}
    if model_id == "grsai-vip":
        resolution_costs = params.get("resolution_costs") or {}
        resolution_key = (resolution or "auto").strip() or "auto"
        cost = resolution_costs.get(resolution_key)
        if cost is None:
            cost = resolution_costs.get("auto", params.get("points_cost"))
        if cost is not None:
            try:
                return max(1, int(cost))
            except (ValueError, TypeError):
                pass
    cost = params.get("points_cost")
    if cost is not None:
        try:
            return max(1, int(cost))
        except (ValueError, TypeError):
            pass
    return PointsService.cost_per_generation()


def find_idempotent_task(user_id: int, client_request_id: str):
    """按 client_request_id 查历史任务（幂等）。"""
    if not client_request_id:
        return None
    with get_db() as conn:
        return conn.execute(
            "SELECT task_id,status FROM tasks WHERE user_id = %s AND params->>'client_request_id' = %s ORDER BY created_at DESC LIMIT 1",
            (user_id, client_request_id),
        ).fetchone()


def _reserve_generation_slot(task_id: str, task_type: str, task_params: dict, user_id: int, cost: int):
    """套餐/订阅/并发校验 + 扣费 + 创建 tasks 行（同一事务）。失败抛 GenerationError。"""
    limit = get_limit_config()["generate_concurrent_limit_per_user"]
    with get_db() as conn:
        user = conn.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if not user:
            raise GenerationError("用户不存在", status_code=401)
        entitlements = get_entitlements_in_conn(conn, user_id)
        if not entitlements["active"]:
            raise GenerationError("当前订阅已暂停或撤销", status_code=403)
        allowed_models = entitlements["allowed_models"]
        model_id = str(task_params.get("model_id") or "")
        if allowed_models and model_id not in allowed_models:
            raise GenerationError("当前套餐不支持该模型", status_code=403)
        limit = min(limit, entitlements["max_concurrent_requests"])
        active_all = conn.execute(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE LOWER(status) IN ('pending','queued','processing','running','generating') AND completed_at IS NULL AND COALESCE(updated_at,created_at,NOW()) >= NOW() - interval '30 minute'"
        ).fetchone()["cnt"]
        if active_all >= GLOBAL_GENERATE_ACTIVE_LIMIT:
            raise GenerationError(f"当前全站生成任务已满，请稍后再试（最多同时 {GLOBAL_GENERATE_ACTIVE_LIMIT} 张）", status_code=429)
        count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE user_id = %s AND LOWER(status) IN ('pending','queued','processing','running','generating') AND completed_at IS NULL AND COALESCE(updated_at,created_at,NOW()) >= NOW() - interval '30 minute'",
            (user_id,),
        ).fetchone()["cnt"]
        if count >= limit:
            raise GenerationError("生成请求过于频繁，请稍后再试", status_code=429)
        try:
            points_balance_after = PointsService.consume(user_id, cost, "生成消耗", request_key=f"consume:{task_id}", conn=conn, model_id=str(task_params.get("model_id") or ""))
        except ValueError:
            raise GenerationError(f"积分不足，需要 {cost} 积分", status_code=402)
        TaskManager.create_task(task_id, task_type, task_params, user_id=user_id, points_cost=cost, points_balance_after=points_balance_after, conn=conn)
        return points_balance_after


def _consume_generation_slot_for_existing_task(task_id: str, user_id: int, model_id: str, cost: int, consume_request_key: str):
    """重试场景的校验 + 扣费（任务行已存在，不重建）。失败抛 GenerationError。"""
    limit = get_limit_config()["generate_concurrent_limit_per_user"]
    with get_db() as conn:
        user = conn.execute("SELECT id,is_admin FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if not user:
            raise GenerationError("用户不存在", status_code=401)
        entitlements = get_entitlements_in_conn(conn, user_id)
        if not entitlements["active"]:
            raise GenerationError("当前订阅已暂停或撤销", status_code=403)
        allowed_models = entitlements["allowed_models"]
        if allowed_models and model_id not in allowed_models:
            raise GenerationError("当前套餐不支持该模型", status_code=403)
        limit = min(limit, entitlements["max_concurrent_requests"])
        active_all = conn.execute(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE LOWER(status) IN ('pending','queued','processing','running','generating') AND completed_at IS NULL AND COALESCE(updated_at,created_at,NOW()) >= NOW() - interval '30 minute'"
        ).fetchone()["cnt"]
        if active_all >= GLOBAL_GENERATE_ACTIVE_LIMIT:
            raise GenerationError(f"当前全站生成任务已满，请稍后再试（最多同时 {GLOBAL_GENERATE_ACTIVE_LIMIT} 张）", status_code=429)
        count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE user_id = %s AND LOWER(status) IN ('pending','queued','processing','running','generating') AND completed_at IS NULL AND COALESCE(updated_at,created_at,NOW()) >= NOW() - interval '30 minute'",
            (user_id,),
        ).fetchone()["cnt"]
        if count >= limit:
            raise GenerationError("生成请求过于频繁，请稍后再试", status_code=429)
        try:
            points_balance_after = PointsService.consume(user_id, cost, "生成重试消耗", request_key=consume_request_key, conn=conn, model_id=model_id)
        except ValueError:
            raise GenerationError(f"积分不足，需要 {cost} 积分", status_code=402)
        return {"points_balance_after": points_balance_after, "is_admin": bool(user["is_admin"])}


def _build_task_meta(task_id: str, task_type: str, params: dict):
    """image_metadata 落库用的元数据。"""
    meta = {
        "prompt": params.get("prompt") or "",
        "size": params.get("size"),
        "resolution": params.get("resolution"),
        "aspect_ratio": params.get("aspect_ratio"),
        "type": task_type,
        "task_id": task_id,
        "model_id": params.get("model_id"),
        "share_to_square": bool(params.get("share_to_square")),
        "client_request_id": params.get("client_request_id"),
    }
    if task_type == "text_image":
        meta["input_urls"] = params.get("image_urls") or []
    return meta


def _build_submit_payload(task_type: str, params: dict, cost: int, refund_request_key: str = None):
    """提交给上游 GenGateway 的请求体（含 _cost / _refund_request_key 内部字段）。"""
    payload = {
        "prompt": params.get("prompt") or "",
        "size": params.get("size") or "auto",
        "resolution": params.get("resolution"),
        "aspect_ratio": params.get("aspect_ratio"),
        "quality": params.get("quality"),
        "model_id": params.get("model_id"),
        "share_to_square": bool(params.get("share_to_square")),
        "client_request_id": params.get("client_request_id"),
        "_cost": cost,
    }
    if task_type == "text_image":
        payload["image_urls"] = params.get("image_urls") or []
    if refund_request_key:
        payload["_refund_request_key"] = refund_request_key
    return payload


def retry_generation_task(task_id: str):
    """失败任务重试：重新校验/扣费并提交上游。返回 {"task_id","status","message"} 或 None。"""
    task = TaskManager.get_task(task_id)
    if not task or task.get("status") != "failed":
        return None
    params = dict(task.get("params") or {})
    retry_count = int(params.get("_retry_count") or 0) + 1
    cost = int(task.get("points_cost") or get_model_cost(params.get("model_id"), params.get("resolution")))
    consume_request_key = f"consume:{task_id}:retry:{retry_count}"
    refund_request_key = f"refund:{task_id}:retry:{retry_count}"
    slot = _consume_generation_slot_for_existing_task(task_id, task["user_id"], str(params.get("model_id") or ""), cost, consume_request_key)
    clean_params = {k: v for k, v in params.items() if k not in {"external_task_id", "provider_id", "provider_trace", "cost_unit", "cost_amount", "_refund_request_key", "_consume_request_key"}}
    clean_params["_retry_count"] = retry_count
    clean_params["_consume_request_key"] = consume_request_key
    clean_params["_refund_request_key"] = refund_request_key
    TaskManager.retry_task(task_id)
    TaskManager.update_task(task_id, status="processing", progress=10, error=None, result_urls=[], external_result=None, params=clean_params, points_cost=cost, points_balance_after=slot["points_balance_after"])
    submit_payload = _build_submit_payload(task.get("type") or "text", clean_params, cost, refund_request_key=refund_request_key)
    meta = _build_task_meta(task_id, task.get("type") or "text", clean_params)
    asyncio.create_task(_run_generation(task_id, task.get("type") or "text", submit_payload, meta, task["user_id"], slot["is_admin"]))
    return {"task_id": task_id, "status": "processing", "message": "任务已重新提交"}


def _share_to_square(user_id: int, file_path: str, prompt: str, size: str, task_type: str, input_urls: list = None):
    """把生图结果同步到广场（square_images + 永久保留标记 + 提示词向量）。"""
    filename = os.path.basename(str(file_path or ""))
    if not filename:
        return
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM square_images WHERE user_id = %s AND filename = %s", (user_id, filename)).fetchone()
        if existing:
            return
        meta = {"size": size, "type": "image" if task_type == "text_image" else "text"}
        if input_urls:
            meta["input_urls"] = input_urls
        metadata = json.dumps(meta, ensure_ascii=False)
        row = conn.execute("INSERT INTO square_images (user_id, filename, prompt, metadata) VALUES (%s, %s, %s, %s) RETURNING id", (user_id, filename, prompt, metadata)).fetchone()
        mark_image_permanent(filename, conn=conn)
        try:
            if row and row.get("id") is not None:
                PromptEmbeddingService.upsert_square(int(row["id"]))
        except Exception:
            logger.exception(f"[submit.square_embedding.fail] user={user_id} filename={filename}")


async def _run_generation(task_id: str, task_type: str, submit_payload: dict, meta: dict, user_id: int, is_admin: bool):
    """后台生成流程：提交上游 → 轮询/下载 → 更新状态；失败标记任务并退款。"""
    try:
        result = await GenGateway.submit(model_id=submit_payload.get("model_id"), prompt=submit_payload["prompt"], size=submit_payload["size"], resolution=submit_payload.get("resolution"), aspect_ratio=submit_payload.get("aspect_ratio"), quality=submit_payload.get("quality"), image_urls=submit_payload.get("image_urls") or [])
        external_task_id = result["external_task_id"]
        provider_id = result["provider_id"]
        model_id = result["model_id"]
        cp = (get_config() or {}).get("cost_profit_config") or {}
        unit_cost = cp.get("model_provider_costs", {}).get(f"{model_id}__{provider_id}")
        try:
            unit_cost = float(unit_cost)
        except Exception:
            unit_cost = None
        logger.info(f"[submit.accepted] type={task_type} task={task_id} user={user_id} model={model_id} provider={provider_id} external={external_task_id}")
        task_params = dict(submit_payload)
        task_params["model_id"] = model_id
        task_params["provider_id"] = provider_id
        task_params["external_task_id"] = external_task_id
        task_params["provider_trace"] = result.get("provider_trace") or []
        task_params["cost_unit"] = unit_cost
        task_params["cost_amount"] = unit_cost if unit_cost is not None else None
        TaskManager.update_task(task_id, params=task_params)
        urls = await poll_and_download(provider_id, external_task_id, task_id, meta, user_id=user_id)
        if urls:
            if is_admin:
                for url in urls:
                    try:
                        mark_image_permanent(os.path.basename(str(url or "")))
                    except Exception:
                        logger.exception(f"[submit.mark_permanent.fail] type={task_type} task={task_id} user={user_id}")
            if submit_payload.get("share_to_square") and len(urls) > 0:
                try:
                    _share_to_square(user_id, urls[0], submit_payload.get("prompt") or "", submit_payload.get("size") or "auto", task_type, input_urls=meta.get("input_urls"))
                except Exception:
                    logger.exception(f"[submit.share.fail] type={task_type} task={task_id} user={user_id}")
            TaskManager.update_task(task_id, status="completed", progress=100, result_urls=urls)
            try:
                FinanceService.record_task_entry(task_id, "completed")
            except Exception:
                logger.exception(f"[finance.record.fail] type={task_type} task={task_id} status=completed")
            StatsService.record_success()
            record_request(user_id, "success")
            logger.info(f"[submit.done] type={task_type} task={task_id} user={user_id} count={len(urls)}")
            return
        raise Exception("未获取到图片结果")
    except Exception as e:
        logger.warning(f"[submit.fail] type={task_type} task={task_id} user={user_id} error={e}")
        TaskManager.update_task(task_id, status="failed", error=str(e))
        try:
            FinanceService.record_task_entry(task_id, "failed")
        except Exception:
            logger.exception(f"[finance.record.fail] type={task_type} task={task_id} status=failed")
        StatsService.record_failed()
        record_request(user_id, "failed")
        try:
            PointsService.refund(user_id, submit_payload.get("_cost") or PointsService.cost_per_generation(), "生成失败退还", request_key=submit_payload.get("_refund_request_key") or f"refund:{task_id}", model_id=str(submit_payload.get("model_id") or ""))
        except Exception:
            logger.exception(f"[submit.refund.fail] type={task_type} task={task_id} user={user_id}")


async def poll_and_download(provider_id: str, external_task_id: str, task_id: str, meta: dict = None, user_id: int = None) -> list:
    """轮询上游任务状态（最长 15 分钟）并下载图片到 data/images/{task_id}_{i}.png，写 image_metadata。"""
    max_wait_seconds = 900
    consecutive_errors = 0
    start_time = datetime.now()
    first_poll = True
    attempt = 0
    while (datetime.now() - start_time).total_seconds() < max_wait_seconds:
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
            result = await GenGateway.poll(provider_id, external_task_id)
            consecutive_errors = 0
            logger.info(f"[poll] task={task_id} attempt={attempt} provider={provider_id} state={result.get('state') if isinstance(result, dict) else 'ok'}")
        except Exception as e:
            consecutive_errors += 1
            logger.warning(f"[poll] task={task_id} error={e} consecutive={consecutive_errors}")
            msg = str(e)
            if msg.startswith("任务失败:"):
                raise Exception(msg)
            if consecutive_errors >= 10:
                raise Exception(f"轮询连续失败: {msg}")
            continue

        state = (result or {}).get("state")
        if state == "running":
            attempt += 1
            continue
        if state == "failed":
            msg = ((result or {}).get("message") or "生成失败").strip()
            raise Exception(msg)
        raw_urls = (result or {}).get("urls") or []
        logger.info(f"[poll] task={task_id} got {len(raw_urls)} results")
        local_paths = []
        for i, url in enumerate(raw_urls):
            if not url:
                continue
            filename = f"{task_id}_{i}.png"
            save_path = str(GENERATED_IMAGES_DIR / filename)
            logger.info(f"[poll] task={task_id} downloading image {i}")
            downloaded = False
            for download_attempt in range(6):
                if download_attempt > 0:
                    await asyncio.sleep(min(2 * download_attempt, 8))
                if await GenGateway.download(provider_id, url, save_path):
                    downloaded = True
                    break
                logger.warning(f"[poll] task={task_id} download retry={download_attempt + 1} provider={provider_id} url={url}")
            if downloaded:
                local_paths.append(save_path)
                image_meta = dict(meta or {})
                image_meta["created_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                with get_db() as conn:
                    conn.execute(
                        "INSERT INTO image_metadata (filename, metadata, created_at, user_id, expires_at, is_permanent) VALUES (%s, %s, %s, %s, %s, FALSE) ON CONFLICT(filename) DO UPDATE SET metadata=EXCLUDED.metadata, created_at=EXCLUDED.created_at, user_id=EXCLUDED.user_id, expires_at=COALESCE(image_metadata.expires_at, EXCLUDED.expires_at), is_permanent=COALESCE(image_metadata.is_permanent, FALSE)",
                        (filename, json.dumps(image_meta, ensure_ascii=False), image_meta["created_at"], user_id, (datetime.now() + timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")),
                    )
        if not local_paths and (result or {}).get("message"):
            raise Exception(((result or {}).get("message") or "").strip())
        if raw_urls and not local_paths:
            attempt += 1
            continue
        return local_paths

    raise Exception("轮询超时（已等待15分钟）")


def create_generation_task(
    user_id: int,
    task_type: str,
    task_params: dict,
    *,
    task_id: str = None,
    is_admin: bool = False,
    ip: str = None,
) -> dict:
    """创建生图任务（路由与 agent 工具共用入口）。

    流程（与原 /api/generate 路由行为完全一致）：
    client_request_id 幂等 → 套餐/并发校验 + 扣费 + 建行 → 违禁词检查 →
    后台 asyncio 执行生成。错误抛 GenerationError（message 可直接给用户看）。

    Args:
        user_id: 用户 id。
        task_type: "text"（文生图）或 "text_image"（图生图）。
        task_params: {prompt, size, resolution, aspect_ratio, quality, model_id,
            share_to_square, client_request_id, image_urls(图生图时)}。
        task_id: 可选，外部指定任务 id（如前端预生成）。
        is_admin: 管理员跳过违禁词检查。
        ip: 可选，非空时更新用户 last_ip（路由层传 get_client_ip(req)）。

    Returns:
        {"task_id", "status", "message"}；幂等命中时返回历史任务信息。
    """
    client_request_id = task_params.get("client_request_id")
    if client_request_id:
        existing = find_idempotent_task(user_id, client_request_id)
        if existing:
            return {"task_id": existing["task_id"], "status": existing["status"], "message": "请求已存在，返回历史任务"}
    task_id = task_id or str(uuid.uuid4())
    logger.info(f"[submit.start] type={task_type} task={task_id} user={user_id} prompt_len={len(task_params.get('prompt') or '')}")
    cost = get_model_cost(task_params.get("model_id"), task_params.get("resolution"))
    try:
        _reserve_generation_slot(task_id, task_type, task_params, user_id, cost)
    except GenerationError:
        raise
    if ip:
        update_user_ip(user_id, ip)
    record_request(user_id, "processing")

    try:
        StatsService.record_request()
        banned_word = None if is_admin else BannedWordsService.check(task_params.get("prompt") or "")
        if banned_word:
            logger.info(f"[submit.reject] type={task_type} task={task_id} user={user_id} reason=banned_word word={banned_word}")
            TaskManager.update_task(task_id, status="failed", error="提示词包含违禁词")
            StatsService.record_failed()
            record_request(user_id, "failed")
            PointsService.refund(user_id, cost, "违禁词退还", request_key=f"refund:{task_id}", model_id=str(task_params.get("model_id") or ""))
            raise GenerationError("提示词包含违禁词，请修改后重试", status_code=400)

        submit_dict = _build_submit_payload(task_type, task_params, cost)
        TaskManager.update_task(task_id, status="processing", progress=10)
        logger.info(f"[submit.task_created] type={task_type} task={task_id} user={user_id}")
        meta = _build_task_meta(task_id, task_type, task_params)
        asyncio.create_task(_run_generation(task_id, task_type, submit_dict, meta, user_id, bool(is_admin)))
        return {"task_id": task_id, "status": "processing", "message": "任务已提交"}

    except GenerationError:
        raise
    except Exception as e:
        logger.exception(f"[submit.exception] type={task_type} task={task_id} user={user_id}")
        TaskManager.update_task(task_id, status="failed", error=str(e))
        record_request(user_id, "failed")
        PointsService.refund(user_id, cost, "异常退还", request_key=f"refund:{task_id}", model_id=str(task_params.get("model_id") or ""))
        logger.exception("生成失败")
        raise GenerationError("生成失败", status_code=500)


async def wait_generation_task(task_id: str, timeout: float = 100.0, interval: float = 3.0) -> dict:
    """同步轮询任务状态，最多等待 timeout 秒（默认 100s，间隔 3s）。

    通过 TaskManager.get_task 查询（内存缓存实时更新 + DB 兜底），与 /api/tasks/{task_id}
    查询口径一致。任务完成即返回，避免无谓等待。

    Returns:
        {"status", "result_urls", "error", "timed_out"}：
        - status="completed"：result_urls 为本地文件路径列表；
        - status="failed"：error 为失败原因（积分已由后台流程退还）；
        - status="not_found"：任务不存在；
        - 超时：status 为当前任务状态，timed_out=True，result_urls 为空。
    """
    loop = asyncio.get_event_loop()
    deadline = loop.time() + max(0.0, float(timeout))
    interval = max(0.5, float(interval))
    while True:
        try:
            task = TaskManager.get_task(task_id)
        except Exception:
            logger.warning("[generation] wait task %s query failed, keep polling", task_id)
            task = None
        if task is None:
            return {"status": "not_found", "result_urls": [], "error": "任务不存在", "timed_out": False}
        status = str(task.get("status") or "").lower()
        if status in ("completed", "done", "success"):
            return {"status": "completed", "result_urls": list(task.get("result_urls") or []), "error": None, "timed_out": False}
        if status in ("failed", "error", "cancelled"):
            return {"status": "failed", "result_urls": [], "error": str(task.get("error") or "生成失败"), "timed_out": False}
        if loop.time() >= deadline:
            return {"status": status, "result_urls": [], "error": None, "timed_out": True}
        await asyncio.sleep(interval)
