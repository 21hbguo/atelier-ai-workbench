"""AgentContext：工具执行上下文。

工具 handler 签名统一为 ``async (args: dict, ctx: AgentContext) -> str``，
ctx 携带会话/用户/文件等元信息，供工具内部查库（chat_files / chat_file_chunks）。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class AgentContext:
    """一次 agent 运行（run_agent）的工具执行上下文。

    Attributes:
        session_id: 当前会话 id（chat_sessions.id），工具据此查会话文档。
        user_id: 当前用户 id（users.id），追加归属过滤。
        chat_file_ids: 会话内可用的文件 id 列表（None 表示不限制，由工具自行查库）。
        extra: 上层透传的附加信息（模型 override、工具开关、SSE 回调等）。
    """

    session_id: Optional[int] = None
    user_id: Optional[int] = None
    chat_file_ids: Optional[list[int]] = None
    extra: dict[str, Any] = field(default_factory=dict)
    # 工具执行过程中收集的来源引用（{"url": str, "title": str}），由 loop 增量推给前端
    citations: list[dict] = field(default_factory=list)

    @property
    def has_session(self) -> bool:
        return self.session_id is not None

    def add_citation(self, url: str, title: str = "", snippet: Optional[str] = None) -> None:
        """记录一条来源引用。

        url 已存在则跳过（去重）；url 为空时忽略；title 可为空串；
        snippet 为可选摘要（可为空串/None，空则不写入条目，保持向后兼容）。
        """
        if not url:
            return
        if any(c.get("url") == url for c in self.citations):
            return
        item = {"url": url, "title": title or ""}
        if snippet:
            item["snippet"] = snippet
        self.citations.append(item)
