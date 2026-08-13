"""rename_session 工具：对话开始前给当前会话起名并应用。

模型在对话早期（用户第一条消息有明显主题）时调用，把会话从默认名「新对话」
改成能概括对话主题的简短标题。若会话已有非默认名称（可能是用户手动起的名），
则不改动，避免覆盖用户自己的命名。
"""
from __future__ import annotations

import logging

from backend.db.session import get_db
from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool

logger = logging.getLogger(__name__)

# 后端创建会话时写入的默认名（chat.py POST /sessions）
DEFAULT_SESSION_TITLE = "新对话"
# 名称长度上限（超出截断，防止刷屏/滥用）
MAX_TITLE_LEN = 50


@agent_tool(
    name="rename_session",
    description=(
        "给当前对话起一个名字并保存。在对话刚开始（用户发出第一条消息后），"
        "如果会话还没有名字（默认叫「新对话」），根据用户消息的主题起一个简短贴切"
        "的名字（建议 2~12 字，不要带引号或多余标点）并调用本工具应用。\n"
        "注意：只有当会话名称仍是默认的「新对话」时才调用；如果会话已经有别的名字"
        "（可能是用户自己起的），不要调用本工具，也不要尝试改名。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "会话的新名字，2~12 字，简短贴切，不含引号",
            },
        },
        "required": ["title"],
    },
)
async def rename_session(args: dict, ctx: AgentContext) -> str:
    """执行改名：校验会话归属 → 检查当前名字是否为默认名 → 是则更新。"""
    if not ctx.has_session:
        return "当前没有进行中的会话，无需改名。"
    title = str(args.get("title") or "").strip()
    if not title:
        return "rename_session 参数错误：title 不能为空，请提供会话新名字。"
    title = title.strip('"\'“”‘’')[:MAX_TITLE_LEN]
    with get_db() as conn:
        row = conn.execute(
            "SELECT title FROM chat_sessions WHERE id = %s AND user_id = %s",
            (ctx.session_id, ctx.user_id),
        ).fetchone()
        if not row:
            return "会话不存在或无权访问。"
        current = (row["title"] or "").strip()
        if current and current != DEFAULT_SESSION_TITLE:
            return f"会话已有名称「{current}」（可能是用户自己设置的），未做修改。"
        conn.execute(
            "UPDATE chat_sessions SET title = %s, updated_at = NOW() WHERE id = %s",
            (title, ctx.session_id),
        )
    logger.info("[rename_session] session=%s renamed -> %s", ctx.session_id, title)
    return f"已将会话命名为「{title}」。"
