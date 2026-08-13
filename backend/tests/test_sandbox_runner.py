"""降级版沙箱（受限子进程执行 file_ops_*）测试。

真实起受限子进程（本机非 root，prlimit 可用；root 环境自动降权 nobody）。
用例覆盖：端到端写读、越界路径拒绝、超时 kill、nproc 资源限制（fork bomb）。
测试工作区重定向到 pytest tmp_path（不碰真实 data/），测完清理。
模式与 test_file_ops_workspace.py 一致：无 pytest-asyncio，asyncio.run 包装。
"""
import asyncio
import shutil
import time

import pytest

from backend import config
from backend.services.agent.context import AgentContext
from backend.services.agent.registry import _REGISTRY, agent_tool
from backend.services.agent.sandbox import is_sandboxed, run_sandboxed

# 本机若无 prlimit（如非 util-linux 环境）则整组跳过——沙箱依赖 prlimit
pytestmark = pytest.mark.skipif(
    shutil.which("prlimit") is None,
    reason="prlimit 不可用，无法运行受限子进程测试",
)


def _run(coro):
    return asyncio.run(coro)


def _ctx(user_id=1, file_write=True):
    features = {"file_write": True} if file_write else {}
    return AgentContext(
        session_id=1,
        user_id=user_id,
        extra={"entitlements": {"features": features}},
    )


@pytest.fixture
def ws(tmp_path, monkeypatch):
    """把用户工作区根目录重定向到 pytest tmp_path。

    tmp_path 默认 0o700：root 环境下子进程降权 nobody 后无法进入，
    显式放开为 0o777；子进程侧经 run_sandboxed 的 workspace_root 字段
    透传同一目录（独立进程里 monkeypatch 不生效）。
    """
    tmp_path.chmod(0o777)
    monkeypatch.setattr(config, "USER_WORKSPACES_DIR", tmp_path)
    yield tmp_path
    shutil.rmtree(tmp_path, ignore_errors=True)  # 测完清理临时工作区


# ---------- 测试用临时工具（经 extra_module 让子进程也能加载） ----------

@agent_tool(
    name="sandbox_test_sleep",
    description="测试用：长时间睡眠（验证超时 kill）",
    parameters={"type": "object", "properties": {}},
)
async def _sandbox_test_sleep(args: dict, ctx) -> str:
    await asyncio.sleep(100)
    return "woke up"


@agent_tool(
    name="sandbox_test_forkbomb",
    description="测试用：fork 循环（验证 nproc 资源限制）",
    parameters={"type": "object", "properties": {}},
)
async def _sandbox_test_forkbomb(args: dict, ctx) -> str:
    import os

    forks = 0
    while True:
        try:
            pid = os.fork()
        except OSError as exc:
            # 抛异常走 ok:false 错误路径（"错误形式"），供 run_sandboxed 返回
            # 「工具执行失败：...」文本；孩子已全部 _exit，无残留进程
            raise RuntimeError(f"fork 失败（第 {forks} 次）：{exc}") from exc
        forks += 1
        if pid == 0:
            os._exit(0)  # 子进程立即退出，不继承 fork 循环


@pytest.fixture(autouse=True)
def _cleanup_registered_tools():
    """测试结束后清理临时注册的工具（装饰器在模块 import 时注册一次）。"""
    yield
    _REGISTRY.pop("sandbox_test_sleep", None)
    _REGISTRY.pop("sandbox_test_forkbomb", None)


# ---------- is_sandboxed ----------

def test_is_sandboxed():
    for name in ("file_ops_read", "file_ops_write", "file_ops_edit",
                 "file_ops_list", "file_ops_glob", "file_ops_grep"):
        assert is_sandboxed(name)
    assert not is_sandboxed("web_search")
    assert not is_sandboxed("image_gen")
    assert not is_sandboxed("")


# ---------- 端到端：沙箱写 → 父进程验证 → 沙箱读回 ----------

def test_sandbox_write_then_read(ws):
    ctx = _ctx()
    content = "hello sandbox\nsecond line\n"

    result = _run(run_sandboxed(
        "file_ops_write",
        {"path": "test_sandbox.txt", "content": content},
        ctx,
    ))
    assert "已写入" in result, result

    # 父进程直接读文件验证内容（真实落盘，非子进程内存态）
    f = ws / "user_1" / "test_sandbox.txt"
    assert f.read_text(encoding="utf-8") == content

    # 再沙箱执行 file_ops_read 读回内容一致
    result2 = _run(run_sandboxed("file_ops_read", {"path": "test_sandbox.txt"}, ctx))
    assert "1: hello sandbox" in result2, result2
    assert "2: second line" in result2, result2


# ---------- 越界路径：子进程内 resolve_workspace_path 拒绝 ----------

def test_sandbox_outside_path_rejected(ws):
    ctx = _ctx()
    result = _run(run_sandboxed("file_ops_read", {"path": "../../etc/passwd"}, ctx))
    assert any(k in result for k in ("路径", "越界", "无效")), result
    assert "passwd" not in result  # 不得回显系统文件内容


# ---------- 超时 kill：sleep 工具 3 秒被终止 ----------

def test_sandbox_timeout_kills(ws):
    ctx = _ctx()
    started = time.monotonic()
    result = _run(run_sandboxed(
        "sandbox_test_sleep", {}, ctx, timeout=3, extra_module=__file__,
    ))
    elapsed = time.monotonic() - started
    assert elapsed < 10, f"超时未及时返回（{elapsed:.1f}s）"
    assert "超时" in result, result


# ---------- 资源限制：fork bomb 被 nproc=64 快速挡下 ----------

def test_sandbox_nproc_limits_forkbomb(ws):
    ctx = _ctx()
    started = time.monotonic()
    result = _run(run_sandboxed(
        "sandbox_test_forkbomb", {}, ctx, extra_module=__file__,
    ))
    elapsed = time.monotonic() - started
    # nproc=64 限制下 fork 很快失败返回错误；即使 prlimit 意外未生效，
    # CPU=10s 限制也会杀掉进程并得到"输出无法解析"错误文本
    assert result, "应返回非空错误文本"
    assert result.startswith("工具执行失败"), result
    assert elapsed < 30, f"fork bomb 未被快速终止（{elapsed:.1f}s）"
