"""send_file 工具 + file 事件 + 工作区下载端点单元测试（tmp_path 沙箱，不碰真实 data 目录）。

覆盖：套餐门控 / 登录校验 / 路径越界 / 文件不存在 / 大小超限 / 正常发送入队 ctx.files
（filename/url/size/description 字段）、run_agent_stream 的 file 增量事件推送、
workspace.py 下载端点（直接调用 handler 验证 FileResponse 与 404 分支）。
测试模式与 test_agent_image_gen.py 一致：无 pytest-asyncio，用 asyncio.run 包装协程。
"""
import asyncio
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from backend import config
from backend.services.agent.context import AgentContext
from backend.services.agent.loop import run_agent_stream
from backend.services.agent.tools import send_file as send_file_module
from backend.services.agent.tools.send_file import send_file
from backend.services.llm_client import LLMClient
from backend.routers import workspace as workspace_router


def _run(coro):
    return asyncio.run(coro)


def _ctx(user_id=123, file_write=True):
    features = {"file_write": True} if file_write else {}
    return AgentContext(
        session_id=1,
        user_id=user_id,
        extra={"entitlements": {"features": features}},
    )


@pytest.fixture
def ws(tmp_path, monkeypatch):
    """把用户工作区根目录重定向到 pytest tmp_path（workspace 动态读 config 属性）。"""
    monkeypatch.setattr(config, "USER_WORKSPACES_DIR", tmp_path)
    return tmp_path


def _root(ws, user_id=123):
    return ws / f"user_{user_id}"


def _write(root, name, text="hello"):
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


# ---------- send_file 工具 ----------

def test_send_file_requires_entitlement(ws):
    result = _run(send_file({"path": "a.txt"}, _ctx(file_write=False)))
    assert result == "当前套餐不支持文件写入。"


def test_send_file_requires_login(ws):
    result = _run(send_file({"path": "a.txt"}, _ctx(user_id=None)))
    assert result == "需要登录后才能使用文件工具"


def test_send_file_outside_rejected(ws):
    result = _run(send_file({"path": "../x.txt"}, _ctx()))
    assert "路径无效" in result
    assert "越界" in result


def test_send_file_not_found(ws):
    result = _run(send_file({"path": "missing.txt"}, _ctx()))
    assert "文件不存在" in result


def test_send_file_directory_rejected(ws):
    root = _root(ws)
    (root / "adir").mkdir(parents=True, exist_ok=True)
    result = _run(send_file({"path": "adir"}, _ctx()))
    assert "不是文件" in result


def test_send_file_too_large(ws, monkeypatch):
    _write(_root(ws), "big.txt", "x" * 100)
    monkeypatch.setattr(send_file_module, "MAX_SEND_BYTES", 10)  # 上限压到 10 bytes
    ctx = _ctx()
    result = _run(send_file({"path": "big.txt"}, ctx))
    assert "文件过大" in result
    assert ctx.files == []  # 超限不入队


def test_send_file_success_enqueues_file(ws):
    root = _root(ws)
    _write(root, "a.txt", "hello world")
    ctx = _ctx()
    result = _run(send_file({"path": "a.txt", "description": "问候文件"}, ctx))
    assert "已发送文件【a.txt】" in result
    assert len(ctx.files) == 1
    f = ctx.files[0]
    assert f["filename"] == "a.txt"
    assert f["url"] == "/api/workspace/files/download?path=a.txt"
    assert f["size"] == 11
    assert f["description"] == "问候文件"


def test_send_file_url_keeps_rel_path_levels(ws):
    """quote 默认不编码 /：子目录相对路径层级在 URL 中原样保留。"""
    root = _root(ws)
    _write(root, "docs/report.md", "# 报告")
    ctx = _ctx()
    _run(send_file({"path": "docs/report.md"}, ctx))
    assert ctx.files[0]["url"] == "/api/workspace/files/download?path=docs/report.md"
    assert ctx.files[0]["filename"] == "report.md"


def test_send_file_empty_description_defaults(ws):
    _write(_root(ws), "a.txt", "x")
    ctx = _ctx()
    _run(send_file({"path": "a.txt"}, ctx))
    assert ctx.files[0]["description"] == ""


def test_send_file_registered_in_registry():
    from backend.services.agent.registry import get_tool

    tool = get_tool("send_file")
    assert tool is not None
    assert "path" in tool["parameters"]["required"]
    assert tool["parameters"]["properties"]["path"]["type"] == "string"


# ---------- run_agent_stream：file 增量事件 ----------

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
    return {"type": "done", "text": text, "tool_calls": calls}


def test_run_agent_stream_yields_file_event(ws):
    _write(_root(ws), "a.txt", "hello")
    rounds = [
        # 第一轮：模型调用 send_file 发送工作区文件
        [_done_event("", [{"id": "call_1", "name": "send_file",
                           "arguments": {"path": "a.txt", "description": "问候文件"},
                           "arguments_raw": '{"path": "a.txt", "description": "问候文件"}'}])],
        # 第二轮：无 tool_calls，直接回答
        [_done_event("文件已发送", [])],
    ]
    ctx = _ctx()

    async def collect():
        return [e async for e in run_agent_stream(
            messages=[{"role": "user", "content": "把文件发给我"}],
            tools_names=["send_file"],
            ctx=ctx,
        )]

    with patch.object(LLMClient, "stream_tools", new=_FakeStreamTools(rounds)):
        events = _run(collect())

    # 事件顺序：executing → done → file → done
    assert [e["type"] for e in events] == [
        "tool_status", "tool_status", "file", "done",
    ]
    file_events = [e for e in events if e["type"] == "file"]
    assert len(file_events) == 1
    assert file_events[0]["file"] == {
        "filename": "a.txt",
        "url": "/api/workspace/files/download?path=a.txt",
        "size": 5,
        "description": "问候文件",
    }
    assert events[-1]["type"] == "done"
    assert events[-1]["text"] == "文件已发送"
    assert len(ctx.files) == 1


def test_run_agent_stream_file_event_incremental(ws):
    """多次发送只发新增部分（增量模式与 widgets/citations 一致）。"""
    _write(_root(ws), "a.txt", "1")
    _write(_root(ws), "b.txt", "22")
    rounds = [
        [_done_event("", [{"id": "call_1", "name": "send_file",
                           "arguments": {"path": "a.txt"},
                           "arguments_raw": '{"path": "a.txt"}'}])],
        [_done_event("", [{"id": "call_2", "name": "send_file",
                           "arguments": {"path": "b.txt"},
                           "arguments_raw": '{"path": "b.txt"}'}])],
        [_done_event("完成", [])],
    ]
    ctx = _ctx()

    async def collect():
        return [e async for e in run_agent_stream(
            messages=[{"role": "user", "content": "发两个文件"}],
            tools_names=["send_file"],
            ctx=ctx,
        )]

    with patch.object(LLMClient, "stream_tools", new=_FakeStreamTools(rounds)):
        events = _run(collect())

    file_events = [e for e in events if e["type"] == "file"]
    assert [f["file"]["filename"] for f in file_events] == ["a.txt", "b.txt"]
    assert len(ctx.files) == 2


# ---------- 工作区下载端点（直接调用 handler，避免 TestClient 依赖） ----------

def test_download_ok(ws):
    _write(_root(ws), "a.txt", "hello")
    resp = _run(workspace_router.download_workspace_file(path="a.txt", user={"user_id": 123}))
    assert resp.path == str(_root(ws) / "a.txt")
    assert resp.filename == "a.txt"  # 只带 basename，防服务器路径泄露


def test_download_outside_404(ws):
    with pytest.raises(HTTPException) as exc:
        _run(workspace_router.download_workspace_file(path="../x.txt", user={"user_id": 123}))
    assert exc.value.status_code == 404
    assert exc.value.detail == "文件不存在"


def test_download_not_found_404(ws):
    with pytest.raises(HTTPException) as exc:
        _run(workspace_router.download_workspace_file(path="missing.txt", user={"user_id": 123}))
    assert exc.value.status_code == 404


def test_download_directory_404(ws):
    (_root(ws) / "adir").mkdir(parents=True, exist_ok=True)
    with pytest.raises(HTTPException) as exc:
        _run(workspace_router.download_workspace_file(path="adir", user={"user_id": 123}))
    assert exc.value.status_code == 404
