"""工具熔断开关（DISABLED_TOOLS）回归测试。"""
from backend import config
from backend.routers.chat import _apply_tool_blacklist


def test_blacklist_returns_same_list_when_unset(monkeypatch):
    monkeypatch.setattr(config, "DISABLED_TOOLS", [])
    names = ["image_gen", "scientific_plot", "web_search"]
    assert _apply_tool_blacklist(names) == names


def test_blacklist_filters_disabled_tools(monkeypatch):
    monkeypatch.setattr(config, "DISABLED_TOOLS", ["scientific_plot", "web_search"])
    names = ["image_gen", "scientific_plot", "web_search", "fetch_url"]
    assert _apply_tool_blacklist(names) == ["image_gen", "fetch_url"]


def test_blacklist_handles_none(monkeypatch):
    monkeypatch.setattr(config, "DISABLED_TOOLS", ["image_gen"])
    assert _apply_tool_blacklist(None) is None


def test_blacklist_is_applied_in_chat_tools_assembly():
    """chat.py 组装 tools_names 后必须经过熔断过滤，且过滤发生在 image_recognize 追加之后。"""
    import inspect

    from backend.routers import chat as chat_module

    source = inspect.getsource(chat_module.send_message)
    assert "_apply_tool_blacklist(tools_names)" in source
    assert "tools_names.append(\"image_recognize\")" in source
    assert source.index("tools_names.append(\"image_recognize\")") < source.index("_apply_tool_blacklist(tools_names)")
