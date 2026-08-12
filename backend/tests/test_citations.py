"""引用（citations）机制单元测试（pytest，不依赖数据库/聊天模块）。

覆盖：
1. AgentContext.add_citation：追加 / url 去重 / 空 url 忽略；
2. fetch_url 工具：成功时上报 url+title，失败 / 空正文时不加；
3. web_search 工具：供应商成功与缓存命中两条路径都上报引用（前 8 条）；
4. run_agent_stream：工具执行后产出 citations 增量事件，且每次只发新增部分。

异步测试沿用 test_stream_tools.py / test_url_fetcher.py 的写法：
asyncio.run 包装，不依赖 pytest-asyncio 插件。
"""
import asyncio
import os
from unittest.mock import AsyncMock, patch

from backend.services.agent.context import AgentContext
from backend.services.agent.loop import run_agent_stream
from backend.services.agent.tools.fetch_url import fetch_url_tool
from backend.services.agent.tools.web_search import web_search_search
from backend.services.llm_client import LLMClient


def _run(coro):
    """同步跑协程（对应 test_url_fetcher.py 的 _run helper）。"""
    return asyncio.run(coro)


# ---------------------------------------------------------------- AgentContext.add_citation

def test_add_citation_appends_and_dedups():
    ctx = AgentContext()
    ctx.add_citation("https://a.example.com/1", "标题A")
    ctx.add_citation("https://a.example.com/1", "重复的标题")  # 同 url 去重，不覆盖原条目
    ctx.add_citation("https://b.example.com/2")  # title 可空
    assert ctx.citations == [
        {"url": "https://a.example.com/1", "title": "标题A"},
        {"url": "https://b.example.com/2", "title": ""},
    ]


def test_add_citation_ignores_empty_url():
    ctx = AgentContext()
    ctx.add_citation("", "空 url")
    ctx.add_citation(None, "None url")  # type: ignore[arg-type]
    assert ctx.citations == []


# ---------------------------------------------------------------- fetch_url 工具上报引用

def test_fetch_url_tool_reports_citation_on_success():
    ctx = AgentContext()
    fake = AsyncMock(return_value={
        "ok": True,
        "url": "https://final.example.com/page",
        "title": "页面标题",
        "text": "这是正文内容，供回答引用。",
    })
    with patch("backend.services.url_fetcher.fetch_url", fake):
        result = _run(fetch_url_tool({"url": "https://example.com/start"}, ctx))
    assert "这是正文内容" in result
    # 引用 url 用最终地址（重定向后），title 一并上报
    assert ctx.citations == [{"url": "https://final.example.com/page", "title": "页面标题"}]


def test_fetch_url_tool_no_citation_on_failure():
    ctx = AgentContext()
    with patch("backend.services.url_fetcher.fetch_url",
               AsyncMock(return_value={"ok": False, "error": "无法访问该链接"})):
        result = _run(fetch_url_tool({"url": "https://example.com/bad"}, ctx))
    assert "无法访问" in result
    assert ctx.citations == []


def test_fetch_url_tool_no_citation_when_empty_text():
    # ok 但正文为空 → 工具按失败处理，不上报引用
    ctx = AgentContext()
    with patch("backend.services.url_fetcher.fetch_url",
               AsyncMock(return_value={"ok": True, "url": "https://example.com/x",
                                       "title": "t", "text": ""})):
        result = _run(fetch_url_tool({"url": "https://example.com/x"}, ctx))
    assert "未提取到正文" in result
    assert ctx.citations == []


# ---------------------------------------------------------------- web_search 工具上报引用

def test_web_search_reports_citations_on_success():
    ctx = AgentContext()
    items = [
        {"title": "结果标题1", "url": "https://w.example.com/1", "description": "描述1"},
        {"title": "结果标题2", "url": "https://w.example.com/2", "description": "描述2"},
    ]
    with patch("backend.services.agent.tools.web_search._configured_providers", return_value=["serper"]), \
         patch.dict(os.environ, {"SERPER_API_KEY": "test-key"}), \
         patch("backend.services.agent.tools.web_search._serper", new=AsyncMock(return_value=items)):
        _run(web_search_search({"query": "pytest 引用唯一词甲", "max_results": 5}, ctx))
    assert ctx.citations == [
        {"url": "https://w.example.com/1", "title": "结果标题1"},
        {"url": "https://w.example.com/2", "title": "结果标题2"},
    ]


def test_web_search_cached_hit_reports_citations():
    # 固定缓存 TTL，避免环境变量 SEARCH_CACHE_TTL=0 时缓存失效
    items = [
        {"title": "缓存标题", "url": "https://w.example.com/cache", "description": "缓存描述"},
    ]
    patch_ctx = [
        patch("backend.services.agent.tools.web_search._CACHE_TTL", 300),
        patch("backend.services.agent.tools.web_search._configured_providers", return_value=["serper"]),
        patch.dict(os.environ, {"SERPER_API_KEY": "test-key"}),
        patch("backend.services.agent.tools.web_search._serper", new=AsyncMock(return_value=items)),
    ]
    # 第一次调用写入缓存
    with patch_ctx[0], patch_ctx[1], patch_ctx[2], patch_ctx[3]:
        _run(web_search_search({"query": "pytest 引用唯一词乙", "max_results": 5}, AgentContext()))
    # 第二次相同 query 命中缓存（不再打供应商），引用仍要上报
    ctx2 = AgentContext()
    with patch_ctx[0], patch_ctx[1], patch_ctx[2], patch("backend.services.agent.tools.web_search._serper",
                                                         new=AsyncMock(return_value=items)) as m:
        _run(web_search_search({"query": "pytest 引用唯一词乙", "max_results": 5}, ctx2))
    assert m.await_count == 0  # 命中缓存，未调用供应商
    assert ctx2.citations == [{"url": "https://w.example.com/cache", "title": "缓存标题"}]


# ---------------------------------------------------------------- run_agent_stream citations 事件

class _FakeStreamTools:
    """替换 LLMClient.stream_tools：按调用次数依次产出预设轮次事件（async generator）。"""

    def __init__(self, rounds):
        self.rounds = rounds
        self.calls = 0

    async def __call__(self, **kwargs):
        self.calls += 1
        idx = min(self.calls, len(self.rounds)) - 1
        for ev in self.rounds[idx]:
            yield ev


def _done_event(text, calls):
    """构造 stream_tools 的 done 事件（calls 为空表示本轮直接回答）。"""
    ev = {"type": "done", "text": text, "tool_calls": calls}
    return ev


def test_run_agent_stream_yields_citations_increments():
    ctx = AgentContext()
    rounds = [
        # 第一轮：调用 fetch_url 抓 https://a.example.com/1
        [_done_event("", [{"id": "call_1", "name": "fetch_url",
                           "arguments": {"url": "https://a.example.com/1"},
                           "arguments_raw": '{"url": "https://a.example.com/1"}'}])],
        # 第二轮：调用 fetch_url 抓 https://b.example.com/2
        [_done_event("", [{"id": "call_2", "name": "fetch_url",
                           "arguments": {"url": "https://b.example.com/2"},
                           "arguments_raw": '{"url": "https://b.example.com/2"}'}])],
        # 第三轮：无 tool_calls，直接回答
        [_done_event("最终回答", [])],
    ]

    async def fake_fetch_url(url, max_chars=12000):
        titles = {"https://a.example.com/1": "标题A", "https://b.example.com/2": "标题B"}
        return {"ok": True, "url": url, "title": titles[url], "text": "正文内容"}

    async def collect():
        return [e async for e in run_agent_stream(
            messages=[{"role": "user", "content": "hi"}],
            tools_names=["fetch_url"],
            ctx=ctx,
        )]

    with patch.object(LLMClient, "stream_tools", new=_FakeStreamTools(rounds)), \
         patch("backend.services.url_fetcher.fetch_url", new=fake_fetch_url):
        events = _run(collect())

    # 事件顺序：每轮 executing → done → （有新增引用时）citations → 最后 done
    assert [e["type"] for e in events] == [
        "tool_status", "tool_status", "citations",
        "tool_status", "tool_status", "citations",
        "done",
    ]
    # 每次只发新增部分：第一轮发 A，第二轮只发 B（不重复 A）
    cit_events = [e for e in events if e["type"] == "citations"]
    assert cit_events[0]["citations"] == [{"url": "https://a.example.com/1", "title": "标题A"}]
    assert cit_events[1]["citations"] == [{"url": "https://b.example.com/2", "title": "标题B"}]
    # ctx 累积全部引用，事件里无重复
    assert ctx.citations == [
        {"url": "https://a.example.com/1", "title": "标题A"},
        {"url": "https://b.example.com/2", "title": "标题B"},
    ]
    assert events[-1]["type"] == "done"
    assert events[-1]["text"] == "最终回答"
