"""tool call 参数容错解析：三级降级，全部失败返回 {}。

1. json.loads 直接解析
2. json_repair（pip 包名 json-repair）修复后解析；未安装则跳过
3. 正则提取首个 {...} 子串再 json.loads

任何一级解析出 dict 即返回；非 dict 的合法 JSON（如字符串/数字）包一层 {"value": ...} 保留数据。
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

_JSON_REPAIR_AVAILABLE = False


def _json_repair_loads(text: str) -> Any:
    """json_repair 解析入口（未安装时抛 RuntimeError）。"""
    raise RuntimeError("json_repair 不可用")


try:
    import json_repair as _json_repair

    _JSON_REPAIR_AVAILABLE = True
    if hasattr(_json_repair, "loads"):
        _json_repair_loads = _json_repair.loads  # type: ignore[assignment]
    else:
        # 旧版本只暴露 repair_json(str) -> str
        _json_repair_loads = lambda s: json.loads(_json_repair.repair_json(s))  # type: ignore[assignment]
except Exception:  # pragma: no cover - 环境缺依赖时降级
    logger.info("[agent/parser] json_repair 未安装（pip install json-repair），参数容错降级为正则提取")


# 首个 {...} 子串（含嵌套花括号：非贪婪匹配到最后一个 }）
_BRACE_RE = re.compile(r"\{.*\}", re.S)


def _coerce_obj(obj: Any) -> Optional[dict]:
    """把解析结果规范成 dict：已是 dict 直接用；其他合法 JSON 包一层 value。"""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj
    return {"value": obj}


def safe_parse_arguments(raw: Optional[str]) -> dict:
    """把 LLM 返回的 arguments 字符串解析为 dict，三级容错。

    Args:
        raw: LLM 返回的原始参数字符串（可能为 None / 空 / 坏 JSON / 纯文本）。

    Returns:
        解析出的参数 dict；全部失败时返回 {}（调用方据此让模型重试或使用默认值）。
    """
    if raw is None:
        return {}
    text = str(raw).strip()
    if not text:
        return {}

    # 1) 直接 json.loads
    try:
        obj = json.loads(text)
        result = _coerce_obj(obj)
        if result is not None:
            return result
    except (json.JSONDecodeError, TypeError, ValueError):
        pass

    # 2) json_repair 修复 —— 仅当文本含 JSON 结构特征时尝试，
    #    否则纯文本会被 json_repair 当成裸字符串"修复"成 {"value": ...} 误判成功
    if _JSON_REPAIR_AVAILABLE and any(ch in text for ch in "{[\":"):
        try:
            obj = _json_repair_loads(text)
            result = _coerce_obj(obj)
            if result is not None and isinstance(result, dict) and "value" not in result:
                return result
        except Exception:
            logger.debug("[agent/parser] json_repair 解析失败: %s", text[:200])

    # 3) 正则提取 {...} 子串
    match = _BRACE_RE.search(text)
    if match:
        try:
            obj = json.loads(match.group(0))
            result = _coerce_obj(obj)
            if result is not None:
                return result
        except (json.JSONDecodeError, TypeError, ValueError):
            pass

    logger.debug("[agent/parser] 参数解析全部失败，返回 {}: %s", text[:200])
    return {}
