"""画图承诺兜底（drawing nudge）机制单元测试。

场景：用户要求画图（如"弄个svg出来"/"重新画"），但 LLM 第一轮只回文字描述、
未调用 show_widget 工具 → run_agent_stream 应注入提示强制再走一轮，
让模型真正调用 show_widget 产出 widget，避免"只有文字没有图"。
"""
import asyncio
from unittest.mock import patch

from backend.services.agent.context import AgentContext
from backend.services.agent.loop import run_agent_stream, _is_drawing_request
from backend.services.llm_client import LLMClient


def _run(coro):
    return asyncio.run(coro)


class _FakeStreamTools:
    """替换 LLMClient.stream_tools：按调用次数依次产出预设轮次事件。"""

    def __init__(self, rounds):
        self.rounds = rounds
        self.calls = 0

    async def __call__(self, **kwargs):
        self.calls += 1
        idx = min(self.calls, len(self.rounds)) - 1
        for ev in self.rounds[idx]:
            yield ev


def _done_event(text, calls):
    return {"type": "done", "text": text, "tool_calls": calls}


def test_is_drawing_request_detects_keywords():
    """_is_drawing_request：最近一条用户消息含画图关键词时返回 True。"""
    assert _is_drawing_request([{"role": "user", "content": "弄个svg出来"}])
    assert _is_drawing_request([{"role": "user", "content": "帮我画个流程图"}])
    assert _is_drawing_request([{"role": "user", "content": "重新画一下"}])
    assert _is_drawing_request([{"role": "assistant", "content": "好的"}, {"role": "user", "content": "图呢"}])
    # 不含画图关键词 → False
    assert not _is_drawing_request([{"role": "user", "content": "今天天气怎么样"}])
    assert not _is_drawing_request([{"role": "assistant", "content": "你好"}])
    assert not _is_drawing_request([])


def test_drawing_nudge_forces_show_widget_when_llm_only_speaks():
    """LLM 只回文字不调工具时，兜底注入提示再走一轮，最终产出 widget。"""
    ctx = AgentContext()
    widget = {"kind": "svg", "title": "流程图", "code": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"}
    rounds = [
        # 第一轮：模型只回文字，未调用任何工具（触发现象）
        [_done_event("明白，这次配一张贺卡风格 SVG，信纸、楷体见字如晤……", [])],
        # 第二轮（兜底提示后）：模型调用 show_widget
        [_done_event("", [{"id": "call_1", "name": "show_widget",
                           "arguments": widget,
                           "arguments_raw": '{"kind":"svg","title":"流程图","code":"<svg></svg>"}'}])],
        # 第三轮：无 tool_calls，最终回答
        [_done_event("画好了，SVG 已展示。", [])],
    ]
    fake = _FakeStreamTools(rounds)

    async def collect():
        return [e async for e in run_agent_stream(
            messages=[{"role": "user", "content": "弄个svg出来"}],
            tools_names=["show_widget", "rename_session"],
            ctx=ctx,
        )]

    with patch.object(LLMClient, "stream_tools", new=fake):
        events = _run(collect())

    # 事件：tool_status(executing) → tool_status(done) → widget → done
    types = [e["type"] for e in events]
    assert "widget" in types
    assert types[-1] == "done"
    assert events[-1]["text"] == "画好了，SVG 已展示。"
    assert ctx.widgets == [widget]
    # 兜底注入必须发生在第一轮之后：LLM 被提示后再调用工具（共 3 轮 LLM 调用）
    assert fake.calls == 3


def test_drawing_nudge_only_once_then_normal_done():
    """兜底提示只注入一次：第二轮模型仍只回文字时直接结束，不死循环。"""
    ctx = AgentContext()
    rounds = [
        [_done_event("我描述一下画面：红色背景、白色文字……", [])],
        [_done_event("我再次描述：蓝色背景……", [])],
    ]

    async def collect():
        return [e async for e in run_agent_stream(
            messages=[{"role": "user", "content": "画个流程图"}],
            tools_names=["show_widget"],
            ctx=ctx,
        )]

    fake = _FakeStreamTools(rounds)
    with patch.object(LLMClient, "stream_tools", new=fake):
        events = _run(collect())

    assert [e["type"] for e in events] == ["done"]
    assert events[0]["text"] == "我再次描述：蓝色背景……"
    assert ctx.widgets == []
    assert fake.calls == 2


def test_no_nudge_when_widget_already_produced():
    """已有 widget 产出时不再注入提示（正常路径）。"""
    ctx = AgentContext()
    ctx.add_widget("svg", "已产出", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")
    rounds = [
        [_done_event("画好了。", [])],
    ]

    async def collect():
        return [e async for e in run_agent_stream(
            messages=[{"role": "user", "content": "弄个svg出来"}],
            tools_names=["show_widget"],
            ctx=ctx,
        )]

    fake = _FakeStreamTools(rounds)
    with patch.object(LLMClient, "stream_tools", new=fake):
        events = _run(collect())

    assert [e["type"] for e in events] == ["done"]
    assert fake.calls == 1


def test_no_nudge_when_not_drawing_request():
    """非画图请求（如普通问答）不触发兜底，保持原有行为。"""
    ctx = AgentContext()
    rounds = [
        [_done_event("今天天气不错。", [])],
    ]

    async def collect():
        return [e async for e in run_agent_stream(
            messages=[{"role": "user", "content": "今天天气怎么样"}],
            tools_names=["show_widget", "web_search"],
            ctx=ctx,
        )]

    fake = _FakeStreamTools(rounds)
    with patch.object(LLMClient, "stream_tools", new=fake):
        events = _run(collect())

    assert [e["type"] for e in events] == ["done"]
    assert fake.calls == 1


def test_no_nudge_when_show_widget_not_enabled():
    """show_widget 不在本轮工具列表时不触发兜底。"""
    ctx = AgentContext()
    rounds = [
        [_done_event("我不太确定怎么画，先解释一下概念。", [])],
    ]

    async def collect():
        return [e async for e in run_agent_stream(
            messages=[{"role": "user", "content": "弄个svg出来"}],
            tools_names=["web_search"],
            ctx=ctx,
        )]

    fake = _FakeStreamTools(rounds)
    with patch.object(LLMClient, "stream_tools", new=fake):
        events = _run(collect())

    assert [e["type"] for e in events] == ["done"]
    assert fake.calls == 1
