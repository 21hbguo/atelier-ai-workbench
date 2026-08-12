"""schema_gen 模块单元测试（pytest，不依赖数据库/聊天模块）。

覆盖 signature_to_parameters 的类型映射 / required 规则 / docstring 解析 /
ctx 与 *args 排除，以及 registry.agent_tool 省略 parameters 时的自动生成
与显式 parameters 的兼容性回归。

异步测试沿用 test_stream_tools.py / test_url_fetcher.py 的写法：
asyncio.run 包装，不依赖 pytest-asyncio 插件。
"""
import asyncio
from typing import Dict, List, Literal, Optional, Sequence, Union

import pytest

from backend.services.agent.schema_gen import signature_to_parameters
from backend.services.agent.registry import agent_tool, get_tool


def _run(coro):
    """同步跑协程（对应 test_url_fetcher.py 的 _run helper）。"""
    return asyncio.run(coro)


# ---------------------------------------------------------------- 基本类型映射 + required

def test_basic_types_and_defaults():
    """str/int/float/bool 基本映射；有默认值的参数不进 required。"""
    def f(query: str, max_results: int = 5, ratio: float = 0.5, enabled: bool = False) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert schema["type"] == "object"
    assert schema["properties"] == {
        "query": {"type": "string"},
        "max_results": {"type": "integer"},
        "ratio": {"type": "number"},
        "enabled": {"type": "boolean"},
    }
    assert schema["required"] == ["query"]


def test_no_annotation_defaults_to_string():
    """无注解的参数保守映射为 string，且无默认值仍算 required。"""
    def f(query) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert schema["properties"]["query"] == {"type": "string"}
    assert schema["required"] == ["query"]


def test_unknown_type_falls_back_to_string():
    """未知类型保守映射为 string。"""
    class CustomType:
        pass

    def f(x: CustomType) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert schema["properties"]["x"] == {"type": "string"}
    assert schema["required"] == ["x"]


# ---------------------------------------------------------------- Optional / X | None

def test_optional_union_not_required():
    """Optional[X] / X | None / Union[X, None] → 映射为 X 且不算 required（即使无默认值）。"""
    def f(a: Optional[int], b: str | None, c: Union[str, None]) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert schema["properties"]["a"] == {"type": "integer"}
    assert schema["properties"]["b"] == {"type": "string"}
    assert schema["properties"]["c"] == {"type": "string"}
    assert "required" not in schema  # 全部可选，省略 required 键


def test_optional_with_default_and_required_mix():
    """Optional 无默认值不算 required，普通参数无默认值算 required。"""
    def f(query: str, tag: Optional[str], limit: int = 10) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert schema["required"] == ["query"]


# ---------------------------------------------------------------- list / Literal / dict

def test_list_and_literal():
    """list[int] → array/items；Literal → string/enum。"""
    def f(tags: list[int], mode: Literal["fast", "slow"]) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert schema["properties"]["tags"] == {"type": "array", "items": {"type": "integer"}}
    assert schema["properties"]["mode"] == {"type": "string", "enum": ["fast", "slow"]}
    assert schema["required"] == ["tags", "mode"]


def test_typing_generics_variants():
    """List[X] / Sequence[X] / 无泛型 list / Optional[list[X]] 各变体。"""
    def f(a: List[int], b: Sequence[str], c: list, d: Optional[list[int]] = None) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert schema["properties"]["a"] == {"type": "array", "items": {"type": "integer"}}
    assert schema["properties"]["b"] == {"type": "array", "items": {"type": "string"}}
    assert schema["properties"]["c"] == {"type": "array"}
    assert schema["properties"]["d"] == {"type": "array", "items": {"type": "integer"}}
    # d 为 Optional（不进 required）；a/b/c 无默认值算 required
    assert schema["required"] == ["a", "b", "c"]


def test_dict_mapping():
    """dict / Dict[str, X] → object（不细粒度展开）。"""
    def f(meta: dict, extra: Dict[str, int]) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert schema["properties"]["meta"] == {"type": "object"}
    assert schema["properties"]["extra"] == {"type": "object"}
    assert schema["required"] == ["meta", "extra"]


# ---------------------------------------------------------------- docstring 描述解析

def test_docstring_google_style():
    """Google style Args: 段解析出 description；Returns 段不混入。"""
    def f(query: str, max_results: int = 5) -> str:
        """搜索工具。

        Args:
            query: 搜索关键词
            max_results: 结果条数

        Returns:
            结果文本
        """
        return ""

    schema = signature_to_parameters(f)
    assert schema["properties"]["query"] == {"type": "string", "description": "搜索关键词"}
    assert schema["properties"]["max_results"] == {"type": "integer", "description": "结果条数"}


def test_docstring_rest_style():
    """:param x: 描述（reST 风格）解析出 description。"""
    def f(query: str) -> str:
        """搜索工具。

        :param query: 搜索关键词
        :param max_results: 结果条数
        """
        return ""

    schema = signature_to_parameters(f)
    assert schema["properties"]["query"] == {"type": "string", "description": "搜索关键词"}
    # 描述里多出的参数（函数没有对应形参）不影响 schema
    assert set(schema["properties"]) == {"query"}


def test_docstring_absent_no_description():
    """无 docstring / 无参数说明时 property 不带 description 键。"""
    def f(query: str) -> str:
        """无参数说明的 docstring。"""
        return ""

    schema = signature_to_parameters(f)
    assert schema["properties"]["query"] == {"type": "string"}
    assert "description" not in schema["properties"]["query"]


# ---------------------------------------------------------------- ctx / *args 排除

def test_ctx_excluded_by_name():
    """参数名等于 ctx（无注解）被排除。"""
    def f(query: str, ctx=None) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert "ctx" not in schema["properties"]
    assert schema["required"] == ["query"]


def test_agent_context_type_excluded():
    """类型注解为 AgentContext 的参数被排除（按类型名匹配，不依赖 import 顺序）。"""
    from backend.services.agent.context import AgentContext

    def f(query: str, ctx: AgentContext) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert "ctx" not in schema["properties"]
    assert schema["required"] == ["query"]


def test_optional_agent_context_excluded():
    """Optional[AgentContext] 同样被排除。"""
    from backend.services.agent.context import AgentContext

    def f(query: str, ctx: Optional[AgentContext] = None) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert "ctx" not in schema["properties"]
    assert schema["required"] == ["query"]


def test_var_args_excluded():
    """*args / **kwargs 被排除。"""
    def f(query: str, *args, **kwargs) -> str:
        return ""

    schema = signature_to_parameters(f)
    assert set(schema["properties"]) == {"query"}
    assert schema["required"] == ["query"]


# ---------------------------------------------------------------- 无参数函数

def test_no_params_empty_properties_no_required():
    """无参数函数 → properties 为空 dict、无 required 键。"""
    def f() -> str:
        return ""

    assert signature_to_parameters(f) == {"type": "object", "properties": {}}


# ---------------------------------------------------------------- 字符串注解（future annotations 场景）

def test_string_annotations_path():
    """from __future__ import annotations 下注解为字符串，仍能正确生成（含 Optional/Literal）。"""
    ns = {"Optional": Optional, "Literal": Literal, "__builtins__": __builtins__}
    exec(
        "def _f(query: 'str', n: 'Optional[int]', mode: 'Literal[\"a\", \"b\"]' = 'a') -> 'str':\n"
        "    return ''\n",
        ns,
    )
    schema = signature_to_parameters(ns["_f"])
    assert schema["properties"]["query"] == {"type": "string"}
    assert schema["properties"]["n"] == {"type": "integer"}
    assert schema["properties"]["mode"] == {"type": "string", "enum": ["a", "b"]}
    # Optional 字符串注解无默认值也不进 required
    assert schema["required"] == ["query"]


# ---------------------------------------------------------------- registry 集成（装饰器自动生成）

def test_agent_tool_auto_generate_schema():
    """省略 parameters 时装饰器自动从签名 + docstring 生成 schema。"""
    @agent_tool(name="test.auto_ping", description="自动生成 schema 的测试工具")
    async def auto_ping(question: str, max_results: int = 5, ctx=None) -> str:
        """测试工具。

        Args:
            question: 问题内容
            max_results: 结果条数
        """
        return "pong"

    item = get_tool("test.auto_ping")
    assert item is not None
    assert item["parameters"] == {
        "type": "object",
        "properties": {
            "question": {"type": "string", "description": "问题内容"},
            "max_results": {"type": "integer", "description": "结果条数"},
        },
        "required": ["question"],
    }
    # 自动生成的 schema 与真实 handler 一致，可正常执行
    assert _run(auto_ping(question="hi")) == "pong"
    # 执行器路径：registry 里存的 handler 被 loop.py 以 (args: dict, ctx) 调用，
    # 适配器应把 args dict 按签名展开为关键字参数
    item = get_tool("test.auto_ping")
    assert _run(item["handler"]({"question": "hi", "max_results": 3}, None)) == "pong"
    # 多余的键被过滤、ctx 注入
    assert _run(item["handler"]({"question": "hi", "extra": 1}, "CTX")) == "pong"
    # 缺少必填参数 → 抛 TypeError（与直接调用语义一致，由调用方兜底）
    try:
        _run(item["handler"]({}, None))
        raise AssertionError("应抛出 TypeError")
    except TypeError:
        pass


def test_agent_tool_explicit_parameters_unchanged():
    """显式传 parameters（含空 dict）时装饰器行为与旧版一致。"""
    @agent_tool(
        name="test.manual_ping",
        description="手动 schema 工具",
        parameters={"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]},
    )
    async def manual_ping(args: dict, ctx) -> str:
        return "pong"

    assert get_tool("test.manual_ping")["parameters"] == {
        "type": "object",
        "properties": {"q": {"type": "string"}},
        "required": ["q"],
    }

    # 显式空 dict → 保持旧行为（默认空 schema）
    @agent_tool(name="test.empty_params", description="空 dict 工具", parameters={})
    async def empty_params(args: dict, ctx) -> str:
        return "pong"

    assert get_tool("test.empty_params")["parameters"] == {"type": "object", "properties": {}}


def test_existing_tools_schema_unchanged():
    """回归：现有显式 parameters 工具（web_search）schema 与之前完全一致。

    只 import web_search 模块（依赖链 httpx + context + registry），
    不 import 整个 tools 包（document_summary/rag_memory 会拖入 database 依赖）。
    """
    import backend.services.agent.tools.web_search  # noqa: F401 - import 即完成工具注册

    params = get_tool("web_search")["parameters"]
    assert params["type"] == "object"
    assert params["required"] == ["query"]
    assert set(params["properties"]) == {"query", "max_results"}
    assert params["properties"]["query"] == {"type": "string", "description": "搜索关键词"}
    assert params["properties"]["max_results"]["type"] == "integer"
