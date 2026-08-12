"""轻量 Agent 工具系统（anything-llm aibitat 框架的 Python 版）。

用法：:

    from backend.services.agent import AgentContext, run_agent

    ctx = AgentContext(session_id=1, user_id=2)
    text = await run_agent(
        system="你是 AI 助手",
        messages=[{"role": "user", "content": "帮我查一下会话文档里关于 XX 的内容"}],
        tools_names=["rag_memory_search", "document_summary_list", "web_search"],
        ctx=ctx,
    )

导入本包即完成内置工具注册（见 backend.services.agent.tools）。
"""
from backend.services.agent import registry  # noqa: F401
from backend.services.agent.context import AgentContext
from backend.services.agent.loop import run_agent
from backend.services.agent import tools  # noqa: F401  （触发内置工具注册）

# v2: manifest 驱动的工具系统（与上述 v1 体系并存，不互相影响）
from backend.services.agent.manifest import (  # noqa: F401
    ToolManifest,
    ToolContext,
    ToolResult,
    ToolCall,
    ToolCallStatus,
    ToolExecutionEvent,
)
from backend.services.agent.registry_v2 import (  # noqa: F401
    register_tool,
    get_tool,
    list_tools,
    get_tools_schema,
    clear_registry,
)
from backend.services.agent.loop_v2 import run_agent_stream_v2  # noqa: F401

__all__ = [
    # v1
    "AgentContext",
    "registry",
    "run_agent",
    "tools",
    # v2
    "ToolManifest",
    "ToolContext",
    "ToolResult",
    "ToolCall",
    "ToolCallStatus",
    "ToolExecutionEvent",
    "register_tool",
    "get_tool",
    "list_tools",
    "get_tools_schema",
    "clear_registry",
    "run_agent_stream_v2",
]
