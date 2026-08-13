"""AgentContext：工具执行上下文。

工具 handler 签名统一为 ``async (args: dict, ctx: AgentContext) -> str``，
ctx 携带会话/用户/文件等元信息，供工具内部查库（chat_files / chat_file_chunks）。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


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
    # 当前用户消息的数据库 id（chat_messages.id），生图工具透传进任务 params 用于后台补图落库
    message_id: Optional[int] = None
    # 工具执行过程中收集的来源引用（{"url": str, "title": str}），由 loop 增量推给前端
    citations: list[dict] = field(default_factory=list)
    # 工具执行过程中收集的画图/可视化 widget（{"kind": str, "title": str, "code": str}），由 loop 增量推给前端
    widgets: list[dict] = field(default_factory=list)
    # 工具执行过程中收集的可下载文件（{"filename", "url", "size", "description"}），由 loop 增量推给前端
    files: list[dict] = field(default_factory=list)
    # 生图任务超时上报：image_gen 超时（任务仍在后台生成）时置
    # {"task_id": str, "status": "processing"}，由 loop 推 image_task 事件（只发一次）
    image_task: Optional[dict] = None

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

    def add_widget(self, kind: str, title: str, code: str) -> None:
        """记录一个可视化 widget（线框图/流程图/架构图/时序图等）。

        kind 限 svg/html；title 可为空串；code 须为非空字符串。
        校验不通过时直接丢弃并记 warning，不抛异常（与 add_citation 的容错风格一致）。
        """
        if kind not in ("svg", "html"):
            logger.warning("[agent/context] add_widget 忽略非法 kind=%r", kind)
            return
        if not isinstance(code, str) or not code.strip():
            logger.warning("[agent/context] add_widget 忽略空 code（kind=%s）", kind)
            return
        self.widgets.append({"kind": kind, "title": title or "", "code": code})

    def add_file(self, filename: str, url: str, size: int, description: str = "") -> None:
        """记录一个可下载文件（send_file 工具产出）。

        filename/url 须为非空字符串；size 须为非负整数；description 可为空串。
        校验不通过时直接丢弃并记 warning，不抛异常（与 add_widget 的容错风格一致）。
        """
        if not isinstance(filename, str) or not filename.strip():
            logger.warning("[agent/context] add_file 忽略空 filename=%r", filename)
            return
        if not isinstance(url, str) or not url.strip():
            logger.warning("[agent/context] add_file 忽略空 url=%r", url)
            return
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            logger.warning("[agent/context] add_file 忽略非法 size=%r", size)
            return
        self.files.append({
            "filename": filename,
            "url": url,
            "size": size,
            "description": description or "",
        })
