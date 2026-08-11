"""LLMClient.stream_tools（流式 function calling）单元测试。

覆盖：tool_call 分片按 index 累积、文本+思考+tool_calls 同轮混发、
纯工具调用轮不被误判为空、流式失败自动降级非流式重试。
"""
import asyncio
import json
from unittest.mock import patch

import httpx

from backend.services.llm_client import LLMClient

TOOLS = [
    {
        "name": "rag_memory_search",
        "description": "检索已上传文档",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "检索词"}},
            "required": ["query"],
        },
    }
]

CFG = {
    "base_url": "https://api.example.com/v1",
    "api_key": "sk-test",
    "protocol": "openai",
    "model": "test-model",
    "enabled": True,
    "timeout_seconds": 10,
}


class FakeResp:
    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data

    def raise_for_status(self):
        pass


class _FakeStreamCtx:
    """模拟 httpx.AsyncClient.stream() 的 async context manager。"""

    def __init__(self, resp):
        self._resp = resp

    async def __aenter__(self):
        return self._resp

    async def __aexit__(self, *exc):
        return False


class FakeStreamResp:
    """模拟流式响应：aiter_lines() 按行产出 SSE 文本。"""

    def __init__(self, lines):
        self._lines = lines

    def raise_for_status(self):
        pass

    async def aiter_lines(self):
        for ln in self._lines:
            yield ln


class FakeStreamClient:
    """记录最后一次请求，stream() 返回预设 SSE 行；post() 返回预设 JSON。"""

    def __init__(self, lines, post_data=None):
        self._lines = lines
        self._post_data = post_data or {"choices": [{"message": {"role": "assistant", "content": ""}}]}
        self.posted = None
        self.stream_calls = 0

    def stream(self, method, url, headers=None, json=None, timeout=None):
        # httpx.AsyncClient.stream() 是普通方法返回 async context manager（非 coroutine）
        self.stream_calls += 1
        self.posted = (url, headers, json)
        return _FakeStreamCtx(FakeStreamResp(self._lines))

    async def post(self, url, headers=None, json=None, timeout=None):
        self.posted = (url, headers, json)
        return FakeResp(self._post_data)


def _sse(*events):
    """把事件 dict 转成 SSE data 行，末尾追加 [DONE]。"""
    lines = ["data: " + json.dumps(ev, ensure_ascii=False) for ev in events]
    lines.append("data: [DONE]")
    return lines


def _run(coro):
    return asyncio.run(coro)


def _collect(agen):
    async def _a():
        out = []
        async for e in agen:
            out.append(e)
        return out

    return asyncio.run(_a())


def _patch(fake):
    return patch("backend.services.llm_client.get_llm_config", return_value=CFG), \
        patch.object(LLMClient, "_get_client", return_value=fake)


def _enter(fake):
    return patch("backend.services.llm_client.get_llm_config", return_value=CFG), \
        patch.object(LLMClient, "_get_client", return_value=fake)


# ① tool_call 分片按 index 累积：两个分片拼成完整 arguments
def test_stream_tools_tool_call_chunks_accumulate():
    lines = _sse(
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "type": "function",
                                                "function": {"name": "rag_memory_search", "arguments": ""}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": '{"query": "测试"}'}}]}}]},
    )
    fake = FakeStreamClient(lines)
    with _enter(fake)[0], _enter(fake)[1]:
        events = _collect(LLMClient.stream_tools(system="s", messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    done = events[-1]
    assert done["type"] == "done"
    assert done["text"] == ""
    assert len(done["tool_calls"]) == 1
    tc = done["tool_calls"][0]
    assert tc["id"] == "call_1"
    assert tc["name"] == "rag_memory_search"
    assert tc["arguments"] == {"query": "测试"}
    assert tc["arguments_raw"] == '{"query": "测试"}'


# ② 文本 + thinking + tool_calls 同一轮混发
def test_stream_tools_mixed_text_thinking_tool_calls():
    lines = _sse(
        {"choices": [{"delta": {"content": "我在"}}]},
        {"choices": [{"delta": {"reasoning_content": "先想一下"}}]},
        {"choices": [{"delta": {"content": "查一下"}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "web_search", "arguments": '{"q":'}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": '"x"}'}}]}}]},
    )
    fake = FakeStreamClient(lines)
    with _enter(fake)[0], _enter(fake)[1]:
        events = _collect(LLMClient.stream_tools(system="s", messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    chunks = [e for e in events if e["type"] == "chunk"]
    thinking = [e for e in events if e["type"] == "thinking"]
    assert [e["text"] for e in chunks] == ["我在", "查一下"]
    assert [e["text"] for e in thinking] == ["先想一下"]
    done = events[-1]
    assert done["type"] == "done"
    assert done["text"] == "我在查一下"
    assert done["thinking"] == "先想一下"
    assert len(done["tool_calls"]) == 1
    assert done["tool_calls"][0]["arguments"] == {"q": "x"}


# ③ 纯工具调用轮：无文本/思考但带 tool_calls，done 不误判为空
def test_stream_tools_pure_tool_call_round_not_empty():
    lines = _sse(
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c2", "function": {"name": "web_search", "arguments": '{"query":"a"}'}}]}}]},
    )
    fake = FakeStreamClient(lines)
    with _enter(fake)[0], _enter(fake)[1]:
        events = _collect(LLMClient.stream_tools(system="s", messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    assert [e["type"] for e in events] == ["done"]
    done = events[-1]
    assert done["text"] == ""
    assert "thinking" not in done
    assert len(done["tool_calls"]) == 1
    assert done["tool_calls"][0]["id"] == "c2"
    assert done["tool_calls"][0]["arguments"] == {"query": "a"}


# 请求体校验：带 tools 且 stream=True
def test_stream_tools_body_contains_tools_and_stream():
    lines = _sse({"choices": [{"delta": {"content": "ok"}}]})
    fake = FakeStreamClient(lines)
    with _enter(fake)[0], _enter(fake)[1]:
        _collect(LLMClient.stream_tools(system="s", messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    _, _, body = fake.posted
    assert body["stream"] is True
    assert body["tools"] == [
        {"type": "function", "function": {
            "name": "rag_memory_search",
            "description": "检索已上传文档",
            "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "检索词"}}, "required": ["query"]},
        }}
    ]


# ④ 流式抛异常 → 自动降级非流式 complete_tools 重试成功
def test_stream_tools_fallback_to_non_stream_on_error():
    class BoomClient(FakeStreamClient):
        async def stream(self, method, url, headers=None, json=None, timeout=None):
            raise httpx.ConnectError("connection boom", request=None)

        async def post(self, url, headers=None, json=None, timeout=None):
            self.posted = (url, headers, json)
            return FakeResp({"choices": [{"message": {"role": "assistant", "content": "降级成功"}}]})

    fake = BoomClient([])
    with _enter(fake)[0], _enter(fake)[1]:
        events = _collect(LLMClient.stream_tools(system="s", messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    assert events[-1]["type"] == "done"
    assert events[-1]["text"] == "降级成功"
    assert events[-1]["tool_calls"] == []
    # 非流式重试请求不带 stream
    _, _, body = fake.posted
    assert "stream" not in body


# 降级重试也失败 → 透传 error 事件
def test_stream_tools_fallback_fails_returns_error():
    class BoomClient(FakeStreamClient):
        async def stream(self, method, url, headers=None, json=None, timeout=None):
            raise httpx.ConnectError("connection boom", request=None)

        async def post(self, url, headers=None, json=None, timeout=None):
            raise httpx.ConnectError("post boom", request=None)

    fake = BoomClient([])
    with _enter(fake)[0], _enter(fake)[1]:
        events = _collect(LLMClient.stream_tools(system="s", messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    assert events[-1]["type"] == "error"
    assert events[-1]["detail"] == "LLM 调用失败，请重试"
