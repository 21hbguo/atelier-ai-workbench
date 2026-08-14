"""image_recognize 工具：给不具备视觉能力的主模型当「眼睛」用。

用户上传图片但当前主模型不支持图片识别时，agent 会注册本工具；主模型调用后，
工具内部调用便宜的视觉模型（默认 gpt-5.6-luna，可回退 get_vision_default()）
识别图片，把文字描述返回给主模型，主模型据此回答用户。

识别核心实现在 backend/services/vision_service.py（与聊天系统侧强制识别共用），
本工具只负责：file_ids 归属校验 + 逐张识别 + 错误串包装。

成本参考：单张图约 5500 输入 tokens，gpt-5.6-luna 输入 $0.2/M tokens，
一次识别约 $0.001（不到 1 分钱人民币），远低于主模型盲猜/多轮试错。
"""
from __future__ import annotations

from backend.database import get_db
from backend.services import vision_service
from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool

# 保持模块级可见性：pick_vision_model 曾被 chat.py / 测试引用，统一从 vision_service 走
pick_vision_model = vision_service.pick_vision_model


@agent_tool(
    name="image_recognize",
    description=(
        "图片识别工具：识别用户上传图片的内容（当用户发送了图片但你无法直接看到图片时调用）。\n"
        "调用方式：把对话说明中给出的图片 file_ids 传入本工具（最多 4 张），工具会识别图片并返回"
        "文字描述，你基于描述回答用户。若用户针对图片提问，可一并传入 question 让识别聚焦。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "file_ids": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "用户上传图片在 chat_files 中的 id 列表（必填，最多 4 张）",
            },
            "question": {
                "type": "string",
                "description": "用户针对图片提出的问题（可选），识别时会聚焦该问题描述相关细节",
            },
        },
        "required": ["file_ids"],
    },
)
async def image_recognize(args: dict, ctx: AgentContext) -> str:
    file_ids = [int(x) for x in (args.get("file_ids") or []) if str(x).strip().lstrip("-").isdigit()]
    if not file_ids:
        return "image_recognize 调用失败：file_ids 不能为空，请传入用户上传图片的 id 列表"
    if len(file_ids) > vision_service.MAX_IMAGES:
        file_ids = file_ids[:vision_service.MAX_IMAGES]

    # 1. 查图片归属（会话 + 用户 + status='image'，与聊天直发同一套校验）
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, original_name, storage_name FROM chat_files "
            "WHERE id = ANY(%s) AND session_id = %s AND user_id = %s AND status = 'image'",
            (file_ids, ctx.session_id, ctx.user_id),
        ).fetchall()
    if not rows:
        return "image_recognize 调用失败：图片不存在或不属于当前会话，请确认 file_ids 是否正确"
    by_id = {r["id"]: r for r in rows}

    # 2. 逐张识别（单张失败即中止，与历史行为一致：不返回半截结果）
    question = str(args.get("question") or "").strip()
    parts: list[str] = []
    for fid in file_ids:
        r = by_id.get(fid)
        if r is None:
            continue
        try:
            text = await vision_service.recognize_image(
                ctx.user_id,
                {"id": r["id"], "original_name": r["original_name"], "storage_name": r["storage_name"]},
                question=question,
            )
        except vision_service.VisionError as e:
            return f"image_recognize 调用失败：{e}"
        parts.append(text)
    if not parts:
        return "image_recognize 调用失败：图片不存在或不属于当前会话，请确认 file_ids 是否正确"
    return "\n\n".join(parts)[:vision_service.MAX_DESCRIPTION_CHARS]
