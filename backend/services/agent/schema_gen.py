"""函数签名 → OpenAI tool 格式 parameters JSON Schema 自动生成。

供 registry.agent_tool 在未显式传 parameters 时调用，避免手写 JSON Schema。
本模块只依赖标准库，不 import backend 任何模块（registry 会 import 本模块，
避免循环依赖）；判断 AgentContext 时按类型名/参数名做字符串比较，
而不是 import context 模块。

支持：
- 类型映射：str/int/float/bool、Optional[X] / X | None / Union[X, None]、
  list[X]/List[X]/Sequence[X]、dict/Dict、Literal["a", "b"]，
  未知类型保守映射为 string；
- 参数描述：Google style（Args: 段）与 reST 风格（:param x: 描述）；
- 排除：AgentContext 类型参数、名为 ctx 的参数、*args / **kwargs；
- required：无默认值且未被排除的参数；Optional 类型即使无默认值也不算 required。

注：项目普遍使用 ``from __future__ import annotations``，注解在运行时是字符串，
因此先尝试 get_type_hints 还原真实类型，失败再对字符串做轻量解析兜底。
"""
from __future__ import annotations

import ast
import collections.abc
import inspect
import re
import types
from typing import Any, Literal, Optional, Union, get_args, get_origin

# AgentContext 的参数名约定（handler 统一签名 (args: dict, ctx: AgentContext)）
_CTX_PARAM_NAMES = frozenset({"ctx", "context"})

# reST 风格的 :param name: 描述 / :param type name: 描述
_REST_PARAM_RE = re.compile(r":param\s+(?:[\w.\[\]]+\s+)?(\w+)\s*:\s*([^\n]*)")

# Google style Args 段结束标志（其他段落标题）
_ARGS_SECTION_END = frozenset({"returns:", "yields:", "raises:", "example:", "examples:", "note:", "notes:"})

# 简单类型名 → 类型对象（字符串注解兜底解析用）
_SIMPLE_TYPES = {"str": str, "int": int, "float": float, "bool": bool, "dict": dict, "list": list}


def _is_agent_context_param(name: str, annotation: Any) -> bool:
    """参数是否应被排除：名为 ctx/context，或类型是 AgentContext（含 Optional 包装）。

    用类型名做字符串比较，不 import backend.services.agent.context，
    避免 schema_gen → context 的循环依赖。
    """
    if name in _CTX_PARAM_NAMES:
        return True
    if annotation is inspect.Parameter.empty:
        return False
    return _type_name_is(annotation, "AgentContext")


def _type_name_is(annotation: Any, type_name: str) -> bool:
    """类型名是否等于 type_name：支持真实类型对象、字符串注解、Optional/Union 包装。"""
    if isinstance(annotation, str):
        s = annotation.strip()
        # 支持 "AgentContext" / "Optional[AgentContext]" / "AgentContext | None" /
        # "Optional[AgentContext] | None" 等字符串形式
        return re.fullmatch(
            rf"(?:Optional\[)?{re.escape(type_name)}(?:\s*\|\s*None)?\]?(?:\s*\|\s*None)?", s
        ) is not None
    # 剥一层 Optional[X] / X | None / Union[X, None] 再看
    inner = _unwrap_optional(annotation)
    if inner is not None and inner is not annotation:
        return _type_name_is(inner, type_name)
    return getattr(annotation, "__name__", "") == type_name


def _unwrap_optional(annotation: Any) -> Any:
    """若注解是 Optional[X] / X | None / Union[X, None]，返回 X；否则返回 None。

    返回 None 同时表示「不是 Optional」与「无法判断」，调用方按需处理。
    字符串注解（from __future__ import annotations）按形态轻量判断，
    返回原字符串仅作「是 Optional」的标记。
    """
    if isinstance(annotation, str):
        s = annotation.strip()
        if (re.fullmatch(r"Optional\[.+\]", s)
                or re.fullmatch(r".+\s*\|\s*None", s)
                or re.fullmatch(r"None\s*\|\s*.+", s)
                or re.fullmatch(r"Union\[.+\]", s) and "None" in s):
            return annotation  # 非 None 占位标记
        return None
    origin = get_origin(annotation)
    if origin is Union or origin is getattr(types, "UnionType", None):
        args = [a for a in get_args(annotation) if a is not type(None)]
        if len(args) == 1:
            return args[0]
    return None


def _split_top_level(s: str) -> list[str]:
    """按顶层逗号分割（忽略引号内与 [] 内的逗号），用于解析 Union/Literal 参数。"""
    parts, depth = [], 0
    cur, quote = "", None
    for ch in s:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote, cur = ch, cur + ch
        elif ch in "[(":
            depth, cur = depth + 1, cur + ch
        elif ch in ")]":
            depth, cur = depth - 1, cur + ch
        elif ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return parts


def _parse_literal_token(token: str) -> Any:
    """把 Literal 的单个值 token 解析回 Python 字面量（"a" / 123 / True 等）。"""
    try:
        return ast.literal_eval(token.strip())
    except (ValueError, SyntaxError):
        return _UNPARSED


_UNPARSED = object()


def _parse_string_annotation(s: str) -> Any:
    """把字符串形式注解（from __future__ import annotations）解析回类型对象。

    支持 str/int/float/bool/dict/list、Optional[X]、Union[A, B]、X | None、
    List[X]/Sequence[X]、Dict[str, X]、Literal["a", "b"] 等常见形式；
    无法解析（自定义类型如 AgentContext）返回 None。
    """
    s = s.strip()
    if not s:
        return None
    m = re.fullmatch(r"Optional\[(.+)\]", s)
    if m:
        inner = _parse_string_annotation(m.group(1))
        return Optional[inner] if inner is not None else None
    m = re.fullmatch(r"Union\[(.+)\]", s)
    if m:
        parts = [_parse_string_annotation(p) for p in _split_top_level(m.group(1))]
        if parts and all(p is not None for p in parts):
            return Union[tuple(parts)]  # type: ignore[valid-type]
        return None
    m = re.fullmatch(r"(.+)\s*\|\s*None", s) or re.fullmatch(r"None\s*\|\s*(.+)", s)
    if m:
        inner = _parse_string_annotation(m.group(1))
        return Optional[inner] if inner is not None else None
    m = re.fullmatch(r"Literal\[(.+)\]", s)
    if m:
        vals = [_parse_literal_token(t) for t in _split_top_level(m.group(1))]
        if vals and all(v is not _UNPARSED for v in vals):
            return Literal[tuple(vals)]  # type: ignore[valid-type]
        return None
    m = re.fullmatch(r"(?:list|List|Sequence)\[(.+)\]", s)
    if m:
        inner = _parse_string_annotation(m.group(1))
        return list[inner] if inner is not None else None
    if re.fullmatch(r"(?:dict|Dict)(?:\[.+\])?", s):
        return dict
    return _SIMPLE_TYPES.get(s)


def _map_type(annotation: Any) -> dict:
    """单个参数注解 → JSON Schema 片段（{"type": ...} 或带 items/enum）。"""
    if annotation is None or annotation is inspect.Parameter.empty:
        return {"type": "string"}
    if isinstance(annotation, str):
        parsed = _parse_string_annotation(annotation)
        if parsed is None:
            return {"type": "string"}  # 无法解析（自定义类型）→ 保守 string
        return _map_type(parsed)

    # Optional[X] / X | None / Union[X, None] → 剥壳后映射 X
    inner = _unwrap_optional(annotation)
    if inner is not None:
        return _map_type(inner)

    origin = get_origin(annotation)
    name = getattr(annotation, "__name__", "")
    # list[X] / List[X] / Sequence[X]（typing.Sequence 的 get_origin 是 collections.abc.Sequence）
    if origin is list or origin is collections.abc.Sequence:
        args = get_args(annotation)
        if args:
            return {"type": "array", "items": _map_type(args[0])}
        return {"type": "array"}
    # dict / Dict / Dict[str, X] → object（不细粒度展开）
    if origin is dict or annotation is dict or name == "Dict":
        return {"type": "object"}
    # list / List / Sequence（无泛型参数）→ array
    if annotation is list or name in ("List", "Sequence"):
        return {"type": "array"}
    # Literal["a", "b"] → string + enum（值类型跟随字面量）
    if origin is Literal:
        vals = list(get_args(annotation))
        if vals and all(isinstance(v, int) and not isinstance(v, bool) for v in vals):
            return {"type": "integer", "enum": vals}
        if vals and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in vals):
            return {"type": "number", "enum": vals}
        if vals and all(isinstance(v, bool) for v in vals):
            return {"type": "boolean", "enum": vals}
        return {"type": "string", "enum": [str(v) for v in vals]}

    if name == "str":
        return {"type": "string"}
    if name == "int":
        return {"type": "integer"}
    if name == "float":
        return {"type": "number"}
    if name == "bool":
        return {"type": "boolean"}
    return {"type": "string"}  # 其他未知类型 → 保守 string


def _parse_docstring_args(doc: str) -> dict[str, str]:
    """从 docstring 解析 {参数名: 描述}，支持 Google style 与 reST 两种风格。"""
    out: dict[str, str] = {}
    if not doc:
        return out

    # 1) reST 风格：:param query: 描述（每行一条）
    for m in _REST_PARAM_RE.finditer(doc):
        out[m.group(1)] = m.group(2).strip()

    # 2) Google style：Args: 段（已有 reST 解析结果的参数不覆盖，避免两种风格并存时打架）
    in_args, last_name = False, None
    for line in doc.splitlines():
        stripped = line.strip()
        if not in_args:
            if stripped in ("Args:", "Arguments:", "参数:") or re.fullmatch(r"Args\s*:", stripped):
                in_args = True
            continue
        if not stripped:
            continue  # 段内空行跳过
        if stripped.lower() in _ARGS_SECTION_END or re.fullmatch(r"[A-Za-z\u4e00-\u9fff]+:", stripped):
            break  # 遇到其他段落标题（Returns: / Example: 等）结束
        m = re.match(r"^(\w+)\s*:\s*(.*)$", stripped)
        if m:
            last_name = m.group(1)
            if last_name not in out:
                out[last_name] = m.group(2).strip()
        elif last_name and stripped and out.get(last_name):
            # 缩进续行：追加到上一条参数描述
            out[last_name] = out[last_name] + " " + stripped
    return out


def signature_to_parameters(fn) -> dict:
    """从函数签名 + docstring 生成 OpenAI tool 格式的 parameters JSON Schema。

    返回 {"type": "object", "properties": {name: schema}, "required": [...]}
    （无 required 时省略该键；无参数时 properties 为空 dict）。
    """
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return {"type": "object", "properties": {}}

    # 优先用真实类型（处理 from __future__ import annotations 的字符串注解）
    annotations: dict[str, Any] = {}
    try:
        annotations = {n: p.annotation for n, p in inspect.signature(fn).parameters.items()}
        annotations = {
            n: a for n, a in inspect.get_type_hints(fn, include_extras=True).items() if n in annotations
        }
    except Exception:  # noqa: BLE001 - forward ref 无法解析等场景，回退原始注解
        pass

    descriptions = _parse_docstring_args(fn.__doc__ or "")
    properties: dict[str, dict] = {}
    required: list[str] = []

    for name, param in sig.parameters.items():
        # 排除 *args / **kwargs
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        annotation = annotations.get(name, param.annotation)
        # 排除 AgentContext 类型参数（类型名匹配，不 import backend）
        if _is_agent_context_param(name, annotation):
            continue

        is_optional = _unwrap_optional(annotation) is not None
        prop = _map_type(annotation)
        if name in descriptions:
            prop["description"] = descriptions[name]
        properties[name] = prop

        # required：无默认值且未被排除；Optional 类型即使无默认值也不算 required
        if param.default is inspect.Parameter.empty and not is_optional:
            required.append(name)

    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema
