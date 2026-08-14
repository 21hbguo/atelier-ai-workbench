"""图片识别核心服务：给不具备视觉能力的主模型当「眼睛」用。

系统侧强制识别（chat.py 带图请求）与 image_recognize 工具共用这一套实现，
避免两套识别逻辑漂移。识别引擎优先 gpt-5.6-luna（便宜，约 $0.001/张），
不可用时回退第一个启用的视觉模型（get_vision_default()）。

成本参考：单张图约 5500 输入 tokens，gpt-5.6-luna 输入 $0.2/M tokens，
一次识别约 $0.001（不到 1 分钱人民币），远低于主模型盲猜/多轮试错。
识别成本由运营吸收，不计费不记账。
"""
from __future__ import annotations

import base64
import logging
import os
from pathlib import Path

from backend.config import CHAT_UPLOAD_DIR
from backend.services.agent.workspace import user_workspace_root
from backend.services.llm_client import LLMClient, LLMError
from backend.services.llm_model_service import get_by_model_id, get_vision_default

logger = logging.getLogger(__name__)

# 单次识别图片上限（与聊天 image_file_ids 上限一致）
MAX_IMAGES = 4
# 单图大小上限：与聊天上传 MAX_FILE_SIZE 一致（20MB），防超大文件直发 OOM
MAX_IMAGE_BYTES = 20 * 1024 * 1024
# 返回描述文本长度上限（注入上下文预算保护）
MAX_DESCRIPTION_CHARS = 2000
# 识别调用超时（秒）：图片识别比纯文本慢，给足时间
RECOGNIZE_TIMEOUT_SECONDS = 90.0
# 默认识别引擎：便宜视觉模型
VISION_MODEL_ID = "gpt-5.6-luna"


class VisionError(Exception):
    """识别失败。message 为可展示给用户/模型的中文说明。"""


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


async def recognize_image(user_id: int, image_row: dict, question: str = "") -> str:
    """识别单张图片，返回描述文本（截断 MAX_DESCRIPTION_CHARS）。

    image_row 需含 id/original_name/storage_name（与 chat_files 行结构一致）。
    失败抛 VisionError（message 为可展示的中文说明），不吞错。
    """
    vision = pick_vision_model()
    if vision is None:
        raise VisionError("没有可用的图片识别模型")
    api_key = _resolve_secret(vision.get("api_key") or "")
    if not api_key:
        raise VisionError("图片识别模型未配置 API Key")

    prompt = f"用户的问题是：{question}\n请识别图片并针对问题描述相关细节。" if question else "请识别以下图片并详细描述内容。"
    blocks = [{"type": "text", "text": prompt}]
    p = _image_path(user_id, str(image_row.get("storage_name") or ""))
    if not p.exists():
        raise VisionError(f"图片文件缺失（{image_row.get('original_name')}）")
    if p.stat().st_size > MAX_IMAGE_BYTES:
        raise VisionError(f"图片文件过大（{image_row.get('original_name')}）")
    data = base64.b64encode(p.read_bytes()).decode()
    media_type = LLMClient._infer_image_media_type(str(p))
    blocks.append({"type": "image", "data": data, "media_type": media_type})

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
        raise VisionError(f"识别服务调用失败：{e}") from e
    except Exception:
        logger.exception("[vision_service] 识别服务异常")
        raise VisionError("图片识别服务异常，请稍后重试") from None

    text = str(text or "").strip()
    if not text:
        raise VisionError("识别模型未返回内容")
    return text[:MAX_DESCRIPTION_CHARS]
