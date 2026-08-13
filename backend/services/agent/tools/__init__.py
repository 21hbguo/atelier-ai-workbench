"""内置 agent 工具集。

import 本包即完成全部工具注册（各模块顶层使用 @agent_tool 装饰器）。
"""
from backend.services.agent.tools import document_summary  # noqa: F401
from backend.services.agent.tools import fetch_url  # noqa: F401
from backend.services.agent.tools import file_ops_workspace  # noqa: F401
from backend.services.agent.tools import image_gen  # noqa: F401
from backend.services.agent.tools import make_office  # noqa: F401
from backend.services.agent.tools import rag_memory  # noqa: F401
from backend.services.agent.tools import rename_session  # noqa: F401
from backend.services.agent.tools import send_file  # noqa: F401
from backend.services.agent.tools import svg_widget  # noqa: F401
from backend.services.agent.tools import web_search  # noqa: F401

__all__ = ["document_summary", "fetch_url", "file_ops_workspace", "image_gen", "make_office", "rag_memory", "rename_session", "send_file", "svg_widget", "web_search"]
