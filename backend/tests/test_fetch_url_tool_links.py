"""fetch_url 工具「链接扩散」返回节单元测试（pytest，不依赖数据库/聊天模块）。

覆盖：
1. 成功且带 links：返回文本附带「可用链接」节，包含页面内链接（链接扩散入口）；
2. 成功但 links 为空 / 字段缺失：不出现链接节（向后兼容旧版返回值）；
3. 失败（ok=False）：不出现链接节；
4. links 超过 10 条时只保留前 10 条（返回文本长度可控）。

异步测试沿用 test_citations.py 的写法：asyncio.run 包装，不依赖 pytest-asyncio 插件。
"""
import asyncio
from unittest.mock import AsyncMock, patch

from backend.services.agent.context import AgentContext
from backend.services.agent.tools.fetch_url import fetch_url_tool


def _run(coro):
    """同步跑协程（对应 test_citations.py 的 _run helper）。"""
    return asyncio.run(coro)


def test_fetch_url_tool_includes_links():
    ctx = AgentContext()
    fake = AsyncMock(return_value={
        "ok": True,
        "url": "https://example.com/",
        "title": "T",
        "text": "body",
        "links": ["https://example.com/a", "https://example.com/b"],
    })
    with patch("backend.services.url_fetcher.fetch_url", fake):
        result = _run(fetch_url_tool({"url": "https://example.com/"}, ctx))
    assert "可用链接" in result
    assert "https://example.com/a" in result
    assert "https://example.com/b" in result


def test_fetch_url_tool_no_links_section():
    # links 为空列表：成功但无可用链接，不出现链接节
    ctx = AgentContext()
    fake = AsyncMock(return_value={
        "ok": True,
        "url": "https://example.com/",
        "title": "T",
        "text": "body",
        "links": [],
    })
    with patch("backend.services.url_fetcher.fetch_url", fake):
        result = _run(fetch_url_tool({"url": "https://example.com/"}, ctx))
    assert "可用链接" not in result
    assert "body" in result


def test_fetch_url_tool_no_links_section_when_key_missing():
    # 向后兼容：旧版 url_fetcher 返回值没有 links 字段
    ctx = AgentContext()
    fake = AsyncMock(return_value={
        "ok": True,
        "url": "https://example.com/",
        "title": "T",
        "text": "body",
    })
    with patch("backend.services.url_fetcher.fetch_url", fake):
        result = _run(fetch_url_tool({"url": "https://example.com/"}, ctx))
    assert "可用链接" not in result
    assert "body" in result


def test_fetch_url_tool_failure_no_links():
    ctx = AgentContext()
    with patch("backend.services.url_fetcher.fetch_url",
               AsyncMock(return_value={"ok": False, "error": "无法访问该链接"})):
        result = _run(fetch_url_tool({"url": "https://example.com/bad"}, ctx))
    assert "无法访问" in result
    assert "可用链接" not in result


def test_fetch_url_tool_links_capped_at_ten():
    # 链接节最多 10 条：超出的链接不进入返回文本（长度可控）
    ctx = AgentContext()
    links = [f"https://example.com/{i}" for i in range(15)]
    fake = AsyncMock(return_value={
        "ok": True,
        "url": "https://example.com/",
        "title": "T",
        "text": "body",
        "links": links,
    })
    with patch("backend.services.url_fetcher.fetch_url", fake):
        result = _run(fetch_url_tool({"url": "https://example.com/"}, ctx))
    for i in range(10):
        assert f"https://example.com/{i}" in result
    assert "https://example.com/10" not in result  # 第 11 条被截断
    assert "https://example.com/14" not in result
