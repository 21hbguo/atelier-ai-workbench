"""agent 工具调用审查（正确性校验）测试。

覆盖：参数 JSON Schema 校验（validate_tool_args）、loop 层校验失败回填与
模型自纠（错误即结果）、未注册/未开放工具附候选名单、工具执行异常模板。
测试模式与 test_citations.py 一致：fake LLMClient.stream_tools + asyncio.run。
"""
import asyncio

import pytest

from backend.services.agent.context import AgentContext
from backend.services.agent.loop import run_agent_stream
from backend.services.agent.parser import validate_tool_args
from backend.services.agent.registry import agent_tool, _REGISTRY

TOOL_PARAMS = {
    "type": "object",
    "properties": {"path": {"type": "string"}, "limit": {"type": "integer"}},
    "required": ["path"],
}


@agent_tool(name="test.validation_ok", description="测试工具", parameters=TOOL_PARAMS)
async def _tool_validation_ok(args: dict, ctx) -> str:
    return f"ok:{args.get('path')}"


@agent_tool(name="test.validation_boom", description="测试工具（抛异常）", parameters=TOOL_PARAMS)
async def _tool_validation_boom(args: dict, ctx) -> str:
    raise ValueError("boom internal error")


@agent_tool(name="test.validation_huge", description="测试工具（返回超长结果）", parameters=TOOL_PARAMS)
async def _tool_validation_huge(args: dict, ctx) -> str:
    return "H" * int(args.get("limit") or 30000)


def _run(coro):
    return asyncio.run(coro)


def _entry(name, fn):
    """构造 registry 条目（与 @agent_tool 显式 parameters 的注册格式一致）。"""
    return {"handler": fn, "name": name, "description": "测试工具", "parameters": TOOL_PARAMS}


@pytest.fixture(autouse=True)
def _test_tools():
    """确保两个测试工具在注册表中（装饰器只注册一次，测试间清理后需重建）。"""
    _REGISTRY.setdefault("test.validation_ok", _entry("test.validation_ok", _tool_validation_ok))
    _REGISTRY.setdefault("test.validation_boom", _entry("test.validation_boom", _tool_validation_boom))
    _REGISTRY.setdefault("test.validation_huge", _entry("test.validation_huge", _tool_validation_huge))
    yield
    _REGISTRY.pop("test.validation_ok", None)
    _REGISTRY.pop("test.validation_boom", None)
    _REGISTRY.pop("test.validation_huge", None)


def _ctx():
    return AgentContext(user_id=1, session_id=1, extra={"entitlements": {"features": {}}})


class _FakeStreamTools:
    """替换 LLMClient.stream_tools：按调用次数产出预设轮次，并记录每轮收到的 messages。"""

    def __init__(self, rounds):
        self.rounds = rounds
        self.calls = 0
        self.seen_messages: list = []

    async def __call__(self, **kwargs):
        self.calls += 1
        self.seen_messages.append(kwargs.get("messages") or [])
        idx = min(self.calls, len(self.rounds)) - 1
        for ev in self.rounds[idx]:
            yield ev


def _done(text, calls):
    return {"type": "done", "text": text, "tool_calls": calls}


def _call(call_id, name, arguments):
    import json
    return {
        "id": call_id,
        "name": name,
        "arguments": arguments,
        "arguments_raw": json.dumps(arguments, ensure_ascii=False),
    }


async def _collect(rounds, tools_names):
    fake = _FakeStreamTools(rounds)
    ctx = _ctx()
    final_text = ""
    statuses = []
    async for ev in run_agent_stream(
        system="",
        messages=[{"role": "user", "content": "请操作文件"}],
        tools_names=tools_names,
        max_tool_calls=5,
        max_tokens=200,
        ctx=ctx,
    ):
        if ev["type"] == "tool_status":
            statuses.append((ev["name"], ev["status"]))
        elif ev["type"] == "done":
            final_text = str(ev.get("text") or "")
    return fake, final_text, statuses


# ---------- validate_tool_args 单元 ----------

def test_validate_passes_valid_args():
    assert validate_tool_args(TOOL_PARAMS, {"path": "a.txt", "limit": 10}) == []


def test_validate_missing_required():
    errors = validate_tool_args(TOOL_PARAMS, {"limit": 10})
    assert errors and "path" in errors[0]


def test_validate_wrong_type():
    errors = validate_tool_args(TOOL_PARAMS, {"path": 123})
    assert errors and "path" in errors[0] and "string" in errors[0]


def test_validate_ignores_empty_schema():
    assert validate_tool_args(None, {}) == []
    assert validate_tool_args({"type": "object", "properties": {}}, {"x": 1}) == []


def test_validate_non_dict_args():
    errors = validate_tool_args(TOOL_PARAMS, "not a dict")
    assert errors


# ---------- loop 层：校验失败回填 → 模型修正自纠 ----------

def test_validation_failure_filled_back_then_retry_success(monkeypatch):
    from backend.services.llm_client import LLMClient

    rounds = [
        # 第 1 轮：模型传错参数类型（path 应为 string，传了 int）
        [_done("", [_call("call_1", "test.validation_ok", {"path": 123})])],
        # 第 2 轮：模型修正参数后重试
        [_done("", [_call("call_2", "test.validation_ok", {"path": "a.txt"})])],
        # 第 3 轮：直接回答
        [_done("最终回答：完成", [])],
    ]
    fake = _FakeStreamTools(rounds)
    monkeypatch.setattr(LLMClient, "stream_tools", fake)

    async def collect():
        final_text = ""
        statuses = []
        async for ev in run_agent_stream(
            system="",
            messages=[{"role": "user", "content": "请操作文件"}],
            tools_names=["test.validation_ok"],
            max_tool_calls=5,
            max_tokens=200,
            ctx=_ctx(),
        ):
            if ev["type"] == "tool_status":
                statuses.append((ev["name"], ev["status"]))
            elif ev["type"] == "done":
                final_text = str(ev.get("text") or "")
        return final_text, statuses

    final_text, statuses = _run(collect())

    assert final_text == "最终回答：完成"
    # 两轮工具调用（每轮 executing + done 两个事件）
    assert sum(1 for _, s in statuses if s == "done") == 2
    # 第二轮请求的 messages 里带着第一轮校验失败的 tool 回填
    second_msgs = fake.seen_messages[1]
    tool_msgs = [m for m in second_msgs if m.get("role") == "tool"]
    assert tool_msgs, "第二轮应包含第一轮工具调用的回填"
    assert "参数校验失败" in tool_msgs[0]["content"]
    assert "test.validation_ok" in tool_msgs[0]["content"]
    assert "path" in tool_msgs[0]["content"]


def test_validation_failure_skips_handler(monkeypatch):
    """校验失败的调用不得执行 handler（短路）。"""
    from backend.services.llm_client import LLMClient
    from backend.services.agent.registry import get_tool

    calls = []
    orig = get_tool("test.validation_ok")["handler"]

    async def spy(args, ctx):
        calls.append(args)
        return await orig(args, ctx)

    get_tool("test.validation_ok")["handler"] = spy
    rounds = [
        [_done("", [_call("call_1", "test.validation_ok", {"path": 123})])],
        [_done("完成", [])],
    ]
    fake = _FakeStreamTools(rounds)
    monkeypatch.setattr(LLMClient, "stream_tools", fake)
    _run(_collect(rounds, ["test.validation_ok"]))
    assert calls == [], "参数校验失败的调用不应执行 handler"


# ---------- 未注册 / 未开放：候选名单 ----------

def test_unknown_tool_message_lists_available(monkeypatch):
    from backend.services.llm_client import LLMClient

    rounds = [
        [_done("", [_call("call_1", "no.such.tool", {})])],
        [_done("完成", [])],
    ]
    fake = _FakeStreamTools(rounds)
    monkeypatch.setattr(LLMClient, "stream_tools", fake)
    _run(_collect(rounds, ["test.validation_ok", "test.validation_boom"]))
    tool_msgs = [m for m in fake.seen_messages[1] if m.get("role") == "tool"]
    assert tool_msgs
    content = tool_msgs[0]["content"]
    assert "no.such.tool" in content
    assert "Available tools" in content
    assert "test.validation_ok" in content  # 候选名单包含可用工具


def test_not_allowed_tool_message_lists_available(monkeypatch):
    from backend.services.llm_client import LLMClient

    # test.validation_boom 已注册但不在本轮 tools_names
    rounds = [
        [_done("", [_call("call_1", "test.validation_boom", {"path": "x"})])],
        [_done("完成", [])],
    ]
    fake = _FakeStreamTools(rounds)
    monkeypatch.setattr(LLMClient, "stream_tools", fake)
    _run(_collect(rounds, ["test.validation_ok"]))
    tool_msgs = [m for m in fake.seen_messages[1] if m.get("role") == "tool"]
    assert tool_msgs
    content = tool_msgs[0]["content"]
    assert "not available" in content
    assert "test.validation_ok" in content
    # 候选名单部分只列本轮可用工具（被拒工具名出现在"Function X is not available"中属正常）
    assert "Available tools: test.validation_ok." in content


# ---------- 执行异常：规范模板 ----------

def test_exec_exception_message_contains_context(monkeypatch):
    from backend.services.llm_client import LLMClient

    rounds = [
        [_done("", [_call("call_1", "test.validation_boom", {"path": "x"})])],
        [_done("完成", [])],
    ]
    fake = _FakeStreamTools(rounds)
    monkeypatch.setattr(LLMClient, "stream_tools", fake)
    _run(_collect(rounds, ["test.validation_boom"]))
    tool_msgs = [m for m in fake.seen_messages[1] if m.get("role") == "tool"]
    assert tool_msgs
    content = tool_msgs[0]["content"]
    assert "test.validation_boom" in content
    assert "ValueError" in content          # 异常类型
    assert "boom internal error" in content  # 异常消息
    assert "请修正后重试" in content          # 引导文案


# ---------- 工具结果长度封顶（单条 + 当轮累积） ----------

def test_truncate_tool_result_helper():
    from backend.services.agent.loop import _truncate_tool_result

    assert _truncate_tool_result("short", 100) == "short"
    long_text = "A" * 10000 + "B" * 10000
    truncated = _truncate_tool_result(long_text, 5000)
    assert len(truncated) <= 5000
    assert "结果过大已截断" in truncated
    assert truncated.startswith("A") and truncated.endswith("B")  # 保留头尾


def test_tool_result_single_truncated(monkeypatch):
    """单条工具结果超 20K 字符时截断回填（保留头尾 + 标记），不撑爆上下文。"""
    from backend.services.llm_client import LLMClient

    rounds = [
        [_done("", [_call("call_1", "test.validation_huge", {"path": "x", "limit": 30000})])],
        [_done("完成", [])],
    ]
    fake = _FakeStreamTools(rounds)
    monkeypatch.setattr(LLMClient, "stream_tools", fake)
    _run(_collect(rounds, ["test.validation_huge"]))
    tool_msgs = [m for m in fake.seen_messages[1] if m.get("role") == "tool"]
    assert tool_msgs
    content = tool_msgs[0]["content"]
    assert len(content) < 30000  # 已被截断
    assert "结果过大已截断" in content
    assert content.endswith("H")  # 保留尾部


def test_tool_result_total_budget_shrinks(monkeypatch):
    """当轮工具结果总累积超过 60K 后，后续结果压缩到 2K 并提示模型收敛。"""
    from backend.services.llm_client import LLMClient

    rounds = [
        [_done("", [_call(f"call_{i}", "test.validation_huge", {"path": "x", "limit": 30000})])]
        for i in range(1, 5)
    ] + [[_done("完成", [])]]
    fake = _FakeStreamTools(rounds)
    monkeypatch.setattr(LLMClient, "stream_tools", fake)
    _run(_collect(rounds, ["test.validation_huge"]))
    # 第 4 轮请求里应看到第 3 轮回填（累积已达 ~60K → 压缩到 2K）
    tool_msgs = [m for m in fake.seen_messages[3] if m.get("role") == "tool"]
    assert tool_msgs
    last_content = tool_msgs[-1]["content"]
    assert len(last_content) <= 2000 + len("…（结果过大已截断，如需完整内容请缩小范围或分页获取）…\n")
