"""Agent 工具注册表（aibitat 风格）。

提供 @agent_tool 装饰器注册异步工具函数，注册表按 name 存取；
get_tools_schema() 把已注册工具转换为 LLMClient.complete_tools 的统一 tools 格式
（[{"name", "description", "parameters"}]），内部由 LLMClient 按协议（openai/anthropic）转换。

用法：:

    from backend.services.agent.registry import agent_tool

    @agent_tool(name="demo.ping", description="测试工具", parameters={"type": "object", "properties": {}})
    async def demo_ping(args: dict, ctx) -> str:
        return "pong"
"""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

# 工具 handler 统一签名：async (args: dict, ctx: AgentContext) -> str
ToolHandler = Callable[..., Awaitable[str]]

# 注册表：name -> {"handler", "name", "description", "parameters"}（按注册顺序）
_REGISTRY: dict[str, dict[str, Any]] = {}


def agent_tool(*, name: str, description: str = "", parameters: Optional[dict] = None):
    """装饰器：把异步函数注册为 agent 工具。

    Args:
        name: 工具唯一名（如 "web_search"），模型通过该名字调用。
        description: 工具用途说明（模型据此决定是否调用）。
        parameters: JSON Schema（{"type":"object","properties":...,"required":[...]}）。
    """
    if not name or not str(name).strip():
        raise ValueError("agent_tool 注册需要非空 name")

    def decorator(fn: ToolHandler) -> ToolHandler:
        if name in _REGISTRY:
            logger.warning("[agent/registry] 工具 %r 重复注册，覆盖旧定义", name)
        _REGISTRY[name] = {
            "handler": fn,
            "name": name,
            "description": (description or "").strip() or (fn.__doc__ or "").strip(),
            "parameters": parameters or {"type": "object", "properties": {}},
        }
        return fn

    return decorator


def get_tool(name: str) -> Optional[dict[str, Any]]:
    """按名字取工具条目（含 handler），未注册返回 None。"""
    return _REGISTRY.get(name)


def list_tools() -> list[str]:
    """已注册工具名列表（按注册顺序）。"""
    return list(_REGISTRY.keys())


def get_tools_schema(names: Optional[list[str]] = None) -> list[dict[str, Any]]:
    """返回统一 tools 格式 [{"name","description","parameters"}]。

    names=None 时返回全部已注册工具；names 中未注册的名字会被跳过并告警。
    """
    if names is None:
        names = list(_REGISTRY.keys())
    out: list[dict[str, Any]] = []
    for n in names:
        item = _REGISTRY.get(n)
        if item is None:
            logger.warning("[agent/registry] 工具 %r 未注册，schema 已跳过", n)
            continue
        out.append({
            "name": item["name"],
            "description": item["description"],
            "parameters": item["parameters"],
        })
    return out
