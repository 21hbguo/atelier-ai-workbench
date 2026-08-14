"""image_recognize 工具：给不具备视觉能力的主模型当「眼睛」用。

用户上传图片但当前主模型不支持图片识别时，agent 会注册本工具；主模型调用后，
工具内部调用便宜的视觉模型（默认 gpt-5.6-luna，可回退 get_vision_default()）
识别图片，把文字描述返回给主模型，主模型据此回答用户。

成本参考：单张图约 5500 输入 tokens，gpt-5.6-luna 输入 $0.2/M tokens，
一次识别约 $0.001（不到 1 分钱人民币），远低于主模型盲猜/多轮试错。
"""
from __future__ import annotations

import base64
import logging
import os
from pathlib import Path

from backend.config import CHAT_UPLOAD_DIR
from backend.database import get_db
from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool
from backend.services.agent.workspace import user_workspace_root
from backend.services.llm_client import LLMClient, LLMError
from backend.services.llm_model_service import get_by_model_id, get_vision_default

logger = logging.getLogger(__name__)

# 单次识别图片上限（与聊天 image_file_ids 上限一致）
MAX_IMAGES = 4
# 返回描述文本长度上限（工具结果预算保护）
MAX_DESCRIPTION_CHARS = 2000
# 识别调用超时（秒）：图片识别比纯文本慢，给足时间
RECOGNIZE_TIMEOUT_SECONDS = 90.0
# 默认识别引擎：便宜视觉模型
VISION_MODEL_ID = "gpt-5.6-luna"


def _resolve_secret(value: str) -> str:
    """api_key 支持 env:VAR_NAME 引用（与 chat_service._resolve_secret 一致）。"""
    v = str(value or "").strip()
    return os.environ.get(v[4:], "") if v.startswith("env:") else v


def pick_vision_model() -> dict | None:
    """识别引擎选择：优先 gpt-5.6-luna（便宜），否则回退第一个启用的视觉模型。"""
    m = get_by_model_id(VISION_MODEL_ID)
    if m and m.get("enabled") and (m.get("base_url") or m.get("api_key")):
        return m
    return get_vision_default()


def _image_path(user_id: int, storage_name: str) -> Path:
    """与聊天上传一致的落盘路径解析（basename 防路径穿越）。"""
    if storage_name.startswith("uploads/"):
        return user_workspace_root(user_id) / "uploads" / os.path.basename(storage_name)
    return CHAT_UPLOAD_DIR / os.path.basename(storage_name)


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
    if len(file_ids) > MAX_IMAGES:
        file_ids = file_ids[:MAX_IMAGES]

    # 1. 查图片归属（会话 + 用户 + status='image'，与聊天直发同一套校验）
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, original_name, storage_name FROM chat_files "
            "WHERE id = ANY(%s) AND session_id = %s AND user_id = %s AND status = 'image'",
            (file_ids, ctx.session_id, ctx.user_id),
        ).fetchall()
    if not rows:
        return "image_recognize 调用失败：图片不存在或不属于当前会话，请确认 file_ids 是否正确"

    # 2. 选识别模型并解析 key
    vision = pick_vision_model()
    if vision is None:
        return "image_recognize 调用失败：没有可用的图片识别模型，请如实告知用户当前无法识别图片"
    api_key = _resolve_secret(vision.get("api_key") or "")
    if not api_key:
        return "image_recognize 调用失败：图片识别模型未配置 API Key"

    # 3. 读文件 → base64 图片块（media_type 按扩展名推断）
    question = str(args.get("question") or "").strip()
    prompt = f"用户的问题是：{question}\n请识别图片并针对问题描述相关细节。" if question else "请识别以下图片并详细描述内容。"
    blocks = [{"type": "text", "text": prompt}]
    # 按模型传入的 file_ids 顺序排序（SQL 结果顺序与传入顺序未必一致）
    by_id = {r["id"]: r for r in rows}
    for r in (by_id.get(fid) for fid in file_ids if fid in by_id):
        p = _image_path(ctx.user_id, str(r["storage_name"] or ""))
        if not p.exists():
            return f"image_recognize 调用失败：图片文件缺失（{r['original_name']}）"
        if p.stat().st_size > MAX_IMAGE_BYTES:
            return f"image_recognize 调用失败：图片文件过大（{r['original_name']}）"
        data = base64.b64encode(p.read_bytes()).decode()
        media_type = LLMClient._infer_image_media_type(str(p))
        blocks.append({"type": "image", "data": data, "media_type": media_type})

    # 4. 调视觉模型识别（override 到识别引擎的独立配置）
    override = {
        "base_url": str(vision.get("base_url") or "").strip(),
        "api_key": api_key,
        "model": str(vision.get("model_id") or "").strip(),
        "protocol": str(vision.get("protocol") or "").strip(),
        "timeout_seconds": RECOGNIZE_TIMEOUT_SECONDS,
    }
    try:
        text = await LLMClient.complete(
            system="你是图片识别助手：仔细观察图片内容，用中文准确、详细地描述（主体、颜色、文字、布局、关系等），不要描述不存在的内容。",
            messages=[{"role": "user", "content": blocks}],
            max_tokens=1000,
            override=override,
        )
    except LLMError as e:
        return f"image_recognize 调用失败：{e}"
    except Exception:
        logger.exception("[image_recognize] 识别服务异常")
        return "image_recognize 调用失败：图片识别服务异常，请稍后重试"

    text = str(text or "").strip()
    if not text:
        return "image_recognize 调用失败：识别模型未返回内容"
    return text[:MAX_DESCRIPTION_CHARS]
