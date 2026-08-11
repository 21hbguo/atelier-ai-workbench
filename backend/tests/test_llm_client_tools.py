"""LLMClient.complete_tools（function calling）单元测试：openai/anthropic 双协议。"""
import asyncio
from unittest.mock import patch

from backend.services.llm_client import LLMClient, LLMError

TOOLS = [
    {
        "name": "rag_memory.search",
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


class FakeClient:
    """记录最后一次请求，返回预设响应。"""

    def __init__(self, data):
        self._data = data
        self.posted = None

    async def post(self, url, headers=None, json=None, timeout=None):
        self.posted = (url, headers, json)
        return FakeResp(self._data)


def _run(coro):
    return asyncio.run(coro)


def _cfg(**kw):
    c = dict(CFG)
    c.update(kw)
    return c


def test_openai_body_contains_tools():
    fake = FakeClient({"choices": [{"message": {"role": "assistant", "content": "ok"}}]})
    with patch("backend.services.llm_client.get_llm_config", return_value=CFG), \
         patch.object(LLMClient, "_get_client", return_value=fake):
        _run(LLMClient.complete_tools(system="s", messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    _, _, body = fake.posted
    assert body["tools"] == [
        {"type": "function", "function": {
            "name": "rag_memory.search",
            "description": "检索已上传文档",
            "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "检索词"}}, "required": ["query"]},
        }}
    ]
    assert body["messages"][0]["role"] == "system"


def test_openai_parses_tool_calls():
    resp = {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "我来查一下",
                "tool_calls": [
                    {"id": "call_1", "type": "function", "function": {
                        "name": "rag_memory.search",
                        "arguments": '{"query": "AnythingLLM 解析"}',
                    }},
                ],
            }
        }]
    }
    fake = FakeClient(resp)
    with patch("backend.services.llm_client.get_llm_config", return_value=CFG), \
         patch.object(LLMClient, "_get_client", return_value=fake):
        result = _run(LLMClient.complete_tools(messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    assert result["text"] == "我来查一下"
    assert len(result["tool_calls"]) == 1
    tc = result["tool_calls"][0]
    assert tc["id"] == "call_1" and tc["name"] == "rag_memory.search"
    assert tc["arguments"] == {"query": "AnythingLLM 解析"}


def test_openai_bad_arguments_keeps_raw():
    resp = {
        "choices": [{
            "message": {"role": "assistant", "content": "", "tool_calls": [
                {"id": "call_x", "type": "function", "function": {
                    "name": "foo.bar", "arguments": "{broken json",
                }},
            ]}
        }]
    }
    fake = FakeClient(resp)
    with patch("backend.services.llm_client.get_llm_config", return_value=CFG), \
         patch.object(LLMClient, "_get_client", return_value=fake):
        result = _run(LLMClient.complete_tools(messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    tc = result["tool_calls"][0]
    assert tc["arguments"] is None
    assert tc["arguments_raw"] == "{broken json"


def test_openai_plain_text_no_tools():
    fake = FakeClient({"choices": [{"message": {"role": "assistant", "content": "普通回答"}}]})
    with patch("backend.services.llm_client.get_llm_config", return_value=CFG), \
         patch.object(LLMClient, "_get_client", return_value=fake):
        result = _run(LLMClient.complete_tools(messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    assert result["text"] == "普通回答"
    assert result["tool_calls"] == []


def test_anthropic_body_and_parsing():
    resp = {
        "content": [
            {"type": "text", "text": "我先检索"},
            {"type": "tool_use", "id": "toolu_1", "name": "rag_memory.search",
             "input": {"query": "AnythingLLM"}},
        ]
    }
    fake = FakeClient(resp)
    cfg = _cfg(protocol="anthropic", base_url="https://api.anthropic.example")
    with patch("backend.services.llm_client.get_llm_config", return_value=cfg), \
         patch.object(LLMClient, "_get_client", return_value=fake):
        result = _run(LLMClient.complete_tools(messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    url, headers, body = fake.posted
    assert url.endswith("/v1/messages")
    assert headers.get("x-api-key") == "sk-test"
    assert body["tools"] == [
        {"name": "rag_memory.search", "description": "检索已上传文档",
         "input_schema": {"type": "object", "properties": {"query": {"type": "string", "description": "检索词"}}, "required": ["query"]}}
    ]
    assert result["text"] == "我先检索"
    assert result["tool_calls"][0]["id"] == "toolu_1"
    assert result["tool_calls"][0]["arguments"] == {"query": "AnythingLLM"}


def test_unconfigured_raises():
    cfg = dict(CFG, enabled=False)
    with patch("backend.services.llm_client.get_llm_config", return_value=cfg):
        try:
            _run(LLMClient.complete_tools(messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
        except LLMError as e:
            assert "未配置" in str(e)
        else:
            raise AssertionError("expected LLMError")


def test_empty_messages_raises():
    with patch("backend.services.llm_client.get_llm_config", return_value=CFG):
        try:
            _run(LLMClient.complete_tools(messages=[], tools=TOOLS))
        except LLMError:
            pass
        else:
            raise AssertionError("expected LLMError")


def test_openai_extracts_thinking():
    resp = {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "最终回答",
                "reasoning_content": "思考过程一",
            }
        }]
    }
    fake = FakeClient(resp)
    with patch("backend.services.llm_client.get_llm_config", return_value=CFG), \
         patch.object(LLMClient, "_get_client", return_value=fake):
        result = _run(LLMClient.complete_tools(messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    assert result["text"] == "最终回答"
    assert result["thinking"] == "思考过程一"


def test_anthropic_extracts_thinking_blocks():
    resp = {
        "content": [
            {"type": "thinking", "thinking": "第一步思考"},
            {"type": "thinking", "thinking": "第二步思考"},
            {"type": "text", "text": "回答"},
        ]
    }
    fake = FakeClient(resp)
    cfg = _cfg(protocol="anthropic", base_url="https://api.anthropic.example")
    with patch("backend.services.llm_client.get_llm_config", return_value=cfg), \
         patch.object(LLMClient, "_get_client", return_value=fake):
        result = _run(LLMClient.complete_tools(messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    assert result["thinking"] == "第一步思考第二步思考"


def test_no_thinking_returns_empty():
    fake = FakeClient({"choices": [{"message": {"role": "assistant", "content": "普通回答"}}]})
    with patch("backend.services.llm_client.get_llm_config", return_value=CFG), \
         patch.object(LLMClient, "_get_client", return_value=fake):
        result = _run(LLMClient.complete_tools(messages=[{"role": "user", "content": "hi"}], tools=TOOLS))
    assert result["thinking"] == ""
