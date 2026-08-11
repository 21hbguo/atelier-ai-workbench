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

__all__ = ["AgentContext", "registry", "run_agent", "tools"]
