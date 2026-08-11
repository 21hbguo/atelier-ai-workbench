"""agent 包快速自检（非 pytest，直接运行）：

    python3 backend/services/agent/_quick_selfcheck.py

验证内容：
1. import backend.services.agent 无报错（不会连数据库，表未建也不影响导入）
2. 内置工具注册齐全，schema 为统一格式
3. parser 三级容错：合法 JSON / 坏 JSON / 纯文本 三种输入

坏 JSON 的精确结果依赖 json_repair 是否安装，断言只要求「返回 dict 且不抛异常」；
合法 JSON 要求精确解析；纯文本要求返回 {}。
"""
import sys
from pathlib import Path

# 允许从任意目录直接运行：把项目根加入 sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))


def _check_import_and_registry():
    import backend.services.agent  # noqa: F401
    from backend.services.agent import registry
    from backend.services.agent.parser import _JSON_REPAIR_AVAILABLE

    tools = registry.list_tools()
    print(f"[OK] import backend.services.agent 成功")
    print(f"[OK] json_repair 可用: {_JSON_REPAIR_AVAILABLE}")
    print(f"[OK] 已注册工具 ({len(tools)}): {tools}")
    assert tools, "没有任何工具被注册"

    schema = registry.get_tools_schema()
    assert len(schema) == len(tools), "schema 数量与注册工具不一致"
    for t in schema:
        assert set(t.keys()) == {"name", "description", "parameters"}, f"schema 格式不符: {t}"
        assert t["name"] in tools
        assert isinstance(t["parameters"], dict) and t["parameters"].get("type") == "object"
    # 指定 names 过滤 + 未注册名跳过
    subset = registry.get_tools_schema(["rag_memory_search", "no.such.tool"])
    assert [t["name"] for t in subset] == ["rag_memory_search"]
    print(f"[OK] get_tools_schema 格式与过滤逻辑正确")


def _check_parser():
    from backend.services.agent.parser import safe_parse_arguments

    # 合法 JSON：必须精确解析
    assert safe_parse_arguments('{"query": "hello", "n": 3}') == {"query": "hello", "n": 3}
    assert safe_parse_arguments('{"query":"单引号?没问题"}') == {"query": "单引号?没问题"}
    # 标量 JSON（非对象）包一层 value，仍是 dict
    scalar = safe_parse_arguments('"just a string"')
    assert isinstance(scalar, dict) and scalar.get("value") == "just a string"
    # 坏 JSON：必须返回 dict 且不抛异常（精确值取决于 json_repair 是否安装）
    for bad in (
        '{"query": "a", "n": 3,}',          # trailing comma
        '{"query": "a" "n": 3}',            # 缺逗号
        'query: "hello"',                   # 裸对象
        '{"query": "未闭合',                 # 未闭合
    ):
        got = safe_parse_arguments(bad)
        assert isinstance(got, dict), f"坏 JSON 应返回 dict，实际 {got!r}（输入 {bad!r}）"
    # 纯文本 / 空 / None：返回 {}
    for raw in ("这是纯文本，没有任何 JSON 结构", "", "   ", None):
        assert safe_parse_arguments(raw) == {}, f"输入 {raw!r} 应返回 {{}}"
    # 带围栏的 JSON 块：正则提取兜底成功
    fenced = safe_parse_arguments('```json\n{"query": "x"}\n```')
    assert fenced.get("query") == "x", f"围栏 JSON 应被正则提取，实际 {fenced!r}"
    print("[OK] safe_parse_arguments 断言通过（合法/坏 JSON/纯文本/围栏）")


def main():
    _check_import_and_registry()
    _check_parser()
    print("\n自检全部通过 ✔")


if __name__ == "__main__":
    main()
