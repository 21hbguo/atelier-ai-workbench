"""Agent 工具注册表（aibitat 风格）。

提供 @agent_tool 装饰器注册异步工具函数，注册表按 name 存取；
get_tools_schema() 把已注册工具转换为 LLMClient.complete_tools 的统一 tools 格式
（[{"name", "description", "parameters"}]），内部由 LLMClient 按协议（openai/anthropic）转换。

用法：:

    from backend.services.agent.registry import agent_tool

    # 省略 parameters 时自动从函数签名 + docstring 生成 JSON Schema
    # （docstring 可用 Google style 的 Args: 段或 reST 的 :param x: 描述）
    @agent_tool(name="demo.ping", description="测试工具")
    async def demo_ping(question: str, max_results: int = 5, ctx=None) -> str:
        \"\"\"... Args:
            question: 问题
        \"\"\"
        return "pong"

    # 需要精细控制时仍可显式传 parameters（含空 dict），行为与旧版一致
    @agent_tool(name="demo.manual", description="手动 schema", parameters={"type": "object", "properties": {}})
    async def demo_manual(args: dict, ctx) -> str:
        return "ok"
"""
from __future__ import annotations

import inspect
import logging
from typing import Any, Awaitable, Callable, Optional

from backend.services.agent.schema_gen import signature_to_parameters

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
            省略（None）时自动从 handler 函数签名 + docstring 生成；
            显式传 dict（含空 dict）时保持原样。
    """
    if not name or not str(name).strip():
        raise ValueError("agent_tool 注册需要非空 name")

    def decorator(fn: ToolHandler) -> ToolHandler:
        if name in _REGISTRY:
            logger.warning("[agent/registry] 工具 %r 重复注册，覆盖旧定义", name)
        # parameters 省略时从函数签名 + docstring 自动生成（无需手写 JSON Schema）
        params = parameters if parameters is not None else signature_to_parameters(fn)
        handler: ToolHandler = fn
        if parameters is None:
            # 新式工具：handler 是具名参数签名（如 question: str, max_results: int = 5, ctx=None），
            # 而执行器按 (args: dict, ctx) 调用——包一层适配器，把 args dict 按签名展开为
            # 关键字参数（多余的键过滤，ctx/context 参数注入上下文对象）。
            sig_params = inspect.signature(fn).parameters
            if not sig_params or next(iter(sig_params)) not in ("args", "params"):
                ctx_names = {p.name for p in sig_params.values() if p.name in ("ctx", "context")}

                async def _adapted(args: dict, ctx=None) -> str:  # type: ignore[misc]
                    kwargs = {k: v for k, v in (args or {}).items() if k in sig_params}
                    if ctx_names:
                        kwargs["ctx"] = ctx
                    return await fn(**kwargs)  # type: ignore[call-arg]

                handler = _adapted
        _REGISTRY[name] = {
            "handler": handler,
            "name": name,
            "description": (description or "").strip() or (fn.__doc__ or "").strip(),
            "parameters": params or {"type": "object", "properties": {}},
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
