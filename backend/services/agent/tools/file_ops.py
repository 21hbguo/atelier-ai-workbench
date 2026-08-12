"""file_ops 工具：把文本写入服务器 data/uploads/ 下的文件（随机名），返回相对路径。"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

from backend.config import UPLOAD_DIR
from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool

logger = logging.getLogger(__name__)

DEFAULT_FILE_NAME = "chat_export.txt"
# 单次写入内容上限（字符），防滥用
MAX_CONTENT_CHARS = 200_000


@agent_tool(
    name="file_ops_write_text",
    description=(
        "把一段文本内容保存为服务器上的文本文件（存放在 data/uploads/ 目录，自动随机命名防止冲突），"
        "返回文件的相对路径。适合导出聊天记录、生成下载文件等场景。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "要写入文件的文本内容"},
            "file_name": {"type": "string", "description": "建议文件名（仅取文件名部分），默认 chat_export.txt"},
        },
        "required": ["content"],
    },
)
async def file_ops_write_text(args: dict, ctx: AgentContext) -> str:
    if not ctx.extra.get("entitlements", {}).get("features", {}).get("file_write"):
        return "当前套餐不支持文件写入。"
    content = str(args.get("content") or "")
    if not content.strip():
        return "写入内容为空，请提供 content 参数。"
    if len(content) > MAX_CONTENT_CHARS:
        return f"写入内容过长（{len(content)} 字符，上限 {MAX_CONTENT_CHARS}），请分段写入。"

    file_name = str(args.get("file_name") or DEFAULT_FILE_NAME).strip() or DEFAULT_FILE_NAME
    # 只取 basename，防路径穿越（../../etc/passwd 之类）
    safe_name = Path(file_name).name or DEFAULT_FILE_NAME
    storage_name = f"{uuid.uuid4().hex[:12]}_{safe_name}"

    try:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        target = UPLOAD_DIR / storage_name
        target.write_text(content, encoding="utf-8")
    except OSError as exc:
        logger.exception("[file_ops] 写入文件失败")
        return f"写入文件失败：{exc}"

    rel = f"data/uploads/{storage_name}"
    logger.info("[file_ops] 已写入 %s（%d 字符）", rel, len(content))
    return f"文件已保存：{rel}（{len(content)} 字符）"
