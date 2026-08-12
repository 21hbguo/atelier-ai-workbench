"""image_gen 工具：AI 助手在对话中直接调用生图服务生成图片。

文生图（默认）与图生图（image_urls 非空）均支持，走 backend.services.generation_service
（与 /api/generate 路由同一套套餐校验 / 扣费 / 并发限制 / 失败退款逻辑，双重照扣由上层
聊天扣费独立完成）。生成通常需要 30-120 秒：工具同步等待任务完成（上限约 100 秒），
完成后返回 markdown 图片；超时返回任务 ID 指引文案；失败直接返回可读错误消息。
"""
from __future__ import annotations

import logging
import os
from typing import Any

from backend.config import get_default_model_id
from backend.database import get_db
from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool
from backend.services.generation_service import GenerationError, create_generation_task, wait_generation_task
from backend.services.subscription_service import get_entitlements_in_conn

logger = logging.getLogger(__name__)

# 等待生图任务完成的上限与轮询间隔（秒）
WAIT_TIMEOUT = 100.0
WAIT_INTERVAL = 3.0


@agent_tool(
    name="image_gen",
    description=(
        "文生图/图生图工具：根据文字描述生成图片。用户要求生成图片、画画、设计海报/头像/"
        "壁纸/插画/LOGO 等视觉内容时调用此工具，生成结果直接以图片形式展示在对话中。\n"
        "参数规范：\n"
        "1. prompt（必填）：详细描述画面主体、风格、构图、光线、色彩、氛围等，描述越具体效果越好；\n"
        "2. size：图片尺寸（如 1024x1024），默认 auto；aspect_ratio：宽高比（如 16:9、1:1、2:3）；\n"
        "3. resolution/quality：分辨率与画质档位（可选，如 high/medium/low）；\n"
        "4. model_id：生图模型 ID（可选，默认使用站点默认生图模型，仅支持当前套餐允许的模型）；\n"
        "5. image_urls：参考图 URL 列表（可选），传入时执行图生图。\n"
        "注意：生成通常需要 30-120 秒，调用后请等待工具返回结果；若返回任务ID说明图片仍在"
        "后台生成，应如实告知用户预计 1-3 分钟完成、可稍后在「AI 绘画」页面查看。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "description": "图片内容描述（必填）：主体、风格、构图、光线、色彩、氛围等，尽量详细"},
            "model_id": {"type": "string", "description": "生图模型 ID，可选，默认使用站点默认生图模型（如 gpt-image-2）"},
            "size": {"type": "string", "description": "图片尺寸，如 1024x1024，默认 auto"},
            "aspect_ratio": {"type": "string", "description": "宽高比，如 16:9、1:1、2:3，可选"},
            "resolution": {"type": "string", "description": "分辨率档位（low/medium/high），可选"},
            "quality": {"type": "string", "description": "画质档位，可选"},
            "image_urls": {
                "type": "array",
                "items": {"type": "string"},
                "description": "参考图 URL 列表（最多 5 张），传入时执行图生图，可选",
            },
        },
        "required": ["prompt"],
    },
)
async def image_gen(args: dict, ctx: AgentContext) -> str:
    """执行生图：创建任务 → 同步等待（≤100s）→ 返回 markdown 图片或指引文案。"""
    user_id = ctx.user_id
    if not user_id:
        return "生图工具不可用：缺少用户上下文，请重新发起对话。"
    prompt = str(args.get("prompt") or "").strip()
    if not prompt:
        return "请提供图片内容描述（prompt 参数）。"
    model_id = str(args.get("model_id") or "").strip() or get_default_model_id()
    raw_urls = args.get("image_urls") or []
    if isinstance(raw_urls, str):
        raw_urls = [raw_urls]
    image_urls = [str(u).strip() for u in raw_urls if str(u or "").strip()][:5]  # 与 /api/generate 图生图路由一致：最多 5 张
    task_type = "text_image" if image_urls else "text"

    # 套餐模型校验（与 /api/generate 路由一致）：用户显式指定模型时须在套餐 allowed_models 内
    entitlements = ctx.extra.get("entitlements")
    if not entitlements:
        try:
            with get_db() as conn:
                entitlements = get_entitlements_in_conn(conn, user_id)
        except Exception:
            logger.warning("[image_gen] 获取套餐权益失败，跳过模型校验 user=%s", user_id)
            entitlements = None
    allowed_models = (entitlements or {}).get("allowed_models") or []
    if allowed_models and model_id not in allowed_models:
        return f"当前套餐不支持生图模型「{model_id}」。可用模型：{', '.join(allowed_models) or '无'}。"

    task_params = {
        "prompt": prompt,
        "size": str(args.get("size") or "auto"),
        "resolution": args.get("resolution"),
        "aspect_ratio": args.get("aspect_ratio"),
        "quality": args.get("quality"),
        "model_id": model_id,
        "share_to_square": False,
        "client_request_id": None,
    }
    if image_urls:
        task_params["image_urls"] = image_urls

    try:
        created = create_generation_task(user_id, task_type, task_params)
    except GenerationError as e:
        # 积分不足 / 违禁词 / 并发超限等：消息可直接展示给用户
        return str(e)
    task_id = str(created.get("task_id") or "")

    try:
        wait = await wait_generation_task(task_id, timeout=WAIT_TIMEOUT, interval=WAIT_INTERVAL)
    except Exception:
        logger.exception("[image_gen] wait task %s failed", task_id)
        return f"图片生成任务已提交（任务ID {task_id}），可在「AI 绘画」页面查看生成进度。"

    status = wait.get("status")
    if status == "completed":
        urls = wait.get("result_urls") or []
        if not urls:
            return f"图片已生成（任务ID {task_id}），但暂未获取到图片文件，可稍后在「AI 绘画」页面查看。"
        filename = os.path.basename(str(urls[0]))
        # 同源相对路径：浏览器自动携带登录 cookie，图片接口需要鉴权
        image_url = f"/api/images/file/{filename}"
        if len(urls) > 1:
            note = f"共生成 {len(urls)} 张，已展示第一张（任务ID {task_id}）"
        else:
            note = f"图片已生成（任务ID {task_id}）"
        return f"![图片]({image_url})\n\n{note}，点击图片可查看大图。"
    if status == "failed":
        return f"图片生成失败：{wait.get('error') or '未知错误'}（任务ID {task_id}），本次生成积分已自动退还。"
    if status == "not_found":
        return f"图片生成任务不存在（任务ID {task_id}）。"
    # 仍在生成（超时）：任务已提交并在后台继续，返回指引文案
    return f"图片正在生成中，任务ID {task_id}，预计 1-3 分钟完成，可稍后在「AI 绘画」页面查看。"
