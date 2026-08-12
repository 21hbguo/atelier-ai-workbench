"""工具注册表 v2（manifest 驱动）。

与现有 ``registry.py`` 并存，使用独立的 ``_REGISTRY_V2`` 注册表。
注册工具需提供 ``ToolManifest``（元信息）+ handler（执行函数）；
``get_tools_schema`` 输出 OpenAI function calling 格式。

用法::

    from backend.services.agent.manifest import ToolManifest
    from backend.services.agent.registry_v2 import register_tool

    manifest = ToolManifest(
        name="image_generate",
        description="根据文字描述生成图片",
        parameters={"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"]},
        category="image",
        tags=["图片", "生成"],
    )

    @register_tool(manifest)
    async def image_generate(args: dict, ctx) -> ToolResult:
        return ToolResult(content="已生成图片", files=[{"url": "..."}])

也可以直接调用注册（非装饰器写法）::

    register_tool(manifest, handler_fn)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Optional

from backend.services.agent.manifest import ToolManifest

logger = logging.getLogger(__name__)

# 工具 handler 统一签名：async (args: dict, ctx: ToolContext) -> ToolResult | str
ToolHandler = Callable[..., Any]


@dataclass
class ToolEntry:
    """注册表条目：manifest（元信息）+ handler（执行函数）。

    Attributes:
        manifest: 工具元信息（含 name / description / parameters / ui_hints 等）。
        handler: 工具执行函数，签名 ``async (args: dict, ctx: ToolContext) -> ToolResult | str``。
    """

    manifest: ToolManifest
    handler: ToolHandler


# 注册表：name -> ToolEntry（按注册顺序）
_REGISTRY_V2: dict[str, ToolEntry] = {}


def register_tool(manifest: ToolManifest, handler: Optional[Callable] = None) -> Callable:
    """注册工具（manifest + handler）。

    既支持装饰器风格，也支持直接调用：

    装饰器风格::

        @register_tool(manifest)
        async def my_tool(args, ctx):
            ...

    直接调用::

        register_tool(manifest, my_handler)

    Args:
        manifest: 工具元信息（含 name / description / parameters 等）。
        handler: 工具执行函数。装饰器用法时由装饰器注入，直接调用时需显式传入。

    Returns:
        传入的 handler（便于链式使用）。

    Raises:
        ValueError: handler 为 None（直接调用时未传 handler）。
    """
    def _register(fn: Callable) -> Callable:
        name = manifest.name
        if name in _REGISTRY_V2:
            logger.warning("[agent/registry_v2] 工具 %r 重复注册，覆盖旧定义", name)
        _REGISTRY_V2[name] = ToolEntry(manifest=manifest, handler=fn)
        return fn

    if handler is not None:
        # 直接调用：register_tool(manifest, handler)
        return _register(handler)
    # 装饰器用法：@register_tool(manifest)
    return _register


def get_tool(name: str) -> Optional[ToolEntry]:
    """按名字取工具条目（含 manifest + handler），未注册返回 None。

    Args:
        name: 工具名。

    Returns:
        ``ToolEntry`` 或 None。
    """
    return _REGISTRY_V2.get(name)


def list_tools() -> list[ToolManifest]:
    """返回全部已注册工具的 manifest（按注册顺序）。

    Returns:
        ``[ToolManifest, ...]``
    """
    return [entry.manifest for entry in _REGISTRY_V2.values()]


def get_tools_schema(names: Optional[list[str]] = None) -> list[dict]:
    """把指定工具（缺省全部）转换为 OpenAI function calling 格式。

    输出格式::

        [
            {"type": "function", "function": {"name", "description", "parameters"}},
            ...
        ]

    names 中未注册的名字会被跳过并告警。

    Args:
        names: 要转换的工具名列表；None 表示全部已注册工具。

    Returns:
        OpenAI tools 数组。
    """
    if names is None:
        names = list(_REGISTRY_V2.keys())
    out: list[dict] = []
    for n in names:
        entry = _REGISTRY_V2.get(n)
        if entry is None:
            logger.warning("[agent/registry_v2] 工具 %r 未注册，schema 已跳过", n)
            continue
        out.append(entry.manifest.to_openai_function())
    return out


def clear_registry() -> None:
    """清空注册表（主要用于测试隔离）。"""
    _REGISTRY_V2.clear()
