"""受限子进程沙箱执行器（降级版沙箱）。

把 agent 文件工具（file_ops_*）的执行包装进受限子进程：
- prlimit 设置资源上限（CPU 10s / 地址空间 512MB / 进程数 64 / 文件数 1024），
  防死循环、fork bomb、内存炸弹；
- root 下（生产 Docker 容器）额外用 setpriv 降权为 nobody（uid/gid 65534），
  防越权写系统文件；非 root（本地开发机）时跳过降权、只保留 prlimit，
  并在日志中 warning 一次。

子进程入口见 backend/scripts/tool_runner.py：stdin/stdout 各传一行 JSON。
返回字符串契约与进程内 handler 完全一致，可直接作为工具结果回填给 LLM。
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import signal
import sys
from pathlib import Path

from backend import config
from backend.services.agent.workspace import ensure_user_workspace

logger = logging.getLogger(__name__)

# 沙箱名单：这些工具走受限子进程执行
SANDBOXED_TOOLS = frozenset({
    "file_ops_read",
    "file_ops_write",
    "file_ops_edit",
    "file_ops_list",
    "file_ops_glob",
    "file_ops_grep",
})

# prlimit 资源上限
CPU_SECONDS = 10           # --cpu=10
AS_BYTES = 536_870_912     # --as=512MB
NPROC = 64                 # --nproc=64
NOFILE = 1024              # --nofile=1024

DEFAULT_TIMEOUT = 60       # 子进程整体超时（秒）
MAX_STDOUT_BYTES = 1_000_000  # 子进程 stdout 结果上限 1MB
NOBODY_UID = 65534         # nobody
NOBODY_GID = 65534

# 项目根目录：backend/services/agent/sandbox.py 向上 3 级
# （parents[2] 是 backend/，项目根在其上一级；子进程 cwd 必须是项目根，
#   `python -m backend.scripts.tool_runner` 才能找到 backend 包）
PROJECT_ROOT = Path(__file__).resolve().parents[3]

# per-user 串行化锁：同一用户的工作区文件操作排队执行，
# 防同一用户并发编辑同一工作区的竞态（子进程内无共享锁，粗粒度替代）
_locks: dict[int, asyncio.Lock] = {}

# 非 root 降权警告只打一次
_privilege_warned = False


def is_sandboxed(name: str) -> bool:
    """name 是否在受限沙箱名单内。"""
    return name in SANDBOXED_TOOLS


def _build_command() -> list[str]:
    """构造受限子进程命令行。

    - root（os.geteuid()==0）：
      setpriv --reuid=65534 --regid=65534 --clear-groups prlimit --cpu=10 --as=536870912 --nproc=64 --nofile=1024 <python> -m backend.scripts.tool_runner
    - 非 root：
      prlimit --cpu=10 --as=536870912 --nproc=64 --nofile=1024 <python> -m backend.scripts.tool_runner
    """
    global _privilege_warned
    py = sys.executable
    base = [
        "prlimit",
        f"--cpu={CPU_SECONDS}",
        f"--as={AS_BYTES}",
        f"--nproc={NPROC}",
        f"--nofile={NOFILE}",
        py,
        "-m",
        "backend.scripts.tool_runner",
    ]
    if os.geteuid() == 0:
        if shutil.which("setpriv"):
            return [
                "setpriv",
                f"--reuid={NOBODY_UID}",
                f"--regid={NOBODY_GID}",
                "--clear-groups",
            ] + base
        # root 但容器里缺 setpriv（罕见）：降级为仅 prlimit
        logger.warning("[agent/sandbox] root 但未找到 setpriv，跳过 nobody 降权，仅保留 prlimit 限制")
        return base
    if not _privilege_warned:
        _privilege_warned = True
        logger.warning(
            "[agent/sandbox] 非 root 运行，跳过 nobody 降权（仅 prlimit 资源限制生效）；"
            "生产环境（容器内 root）将自动降权为 nobody"
        )
    return base


def _stderr_tail(stderr_text: str | None) -> str:
    """stderr 尾部 500 字符（仅在结果异常时拼进错误信息）。"""
    if not stderr_text:
        return ""
    return "\n[子进程 stderr 尾部] " + stderr_text[-500:]


async def _kill_process_group(proc: asyncio.subprocess.Process) -> None:
    """尽力 kill 整个进程组（SIGKILL），随后回收进程避免僵尸。

    子进程以 start_new_session=True 启动，proc.pid 即进程组组长，
    os.killpg 可覆盖组长及其全部子进程（如 fork bomb 的后代）。
    """
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except Exception:
        pass


async def run_sandboxed(
    name: str,
    args: dict,
    ctx,
    timeout: float = DEFAULT_TIMEOUT,
    extra_module: str | None = None,
) -> str:
    """在受限子进程中执行沙箱工具，返回与进程内 handler 一致的字符串结果。

    Args:
        name: 工具名（须在 SANDBOXED_TOOLS 名单内，否则子进程会拒绝）。
        args: 工具参数 dict。
        ctx: AgentContext（取 user_id 做 per-user 串行化与工作区定位，
            extra 原样透传给子进程，保证套餐门控等语义与进程内一致）。
        timeout: 子进程整体超时（秒），超时 kill 整个进程组。
        extra_module: 仅测试用——把注册了临时工具（@agent_tool）的模块
            绝对路径传给子进程，使其能加载测试工具（超时/资源限制验证）；
            生产路径不传。

    Returns:
        成功返回工具结果原文；失败/超时/解析异常返回错误文本
        （以「工具执行失败」或「工具执行超时」开头），可直接回填给 LLM。
    """
    user_id = getattr(ctx, "user_id", None)
    # per-user 串行化：同一用户的工作区操作排队（防并发读写竞态）
    lock = _locks.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _locks[user_id] = lock
    async with lock:
        return await _run_sandboxed_locked(name, args, ctx, timeout, extra_module)


async def _run_sandboxed_locked(
    name: str,
    args: dict,
    ctx,
    timeout: float,
    extra_module: str | None,
) -> str:
    user_id = getattr(ctx, "user_id", None)
    # 先确保用户工作区根目录存在且 0o777（nobody 降权后需可写；已有目录也兜底）
    if user_id is not None:
        try:
            ensure_user_workspace(user_id)
        except OSError:
            logger.warning("[agent/sandbox] ensure_user_workspace(%s) 失败", user_id, exc_info=True)

    payload = {
        "tool": name,
        "args": args or {},
        "user_id": user_id,
        "workspace_root": str(config.USER_WORKSPACES_DIR),
        "extra": getattr(ctx, "extra", None),
    }
    if extra_module:
        payload["extra_module"] = extra_module
    payload_bytes = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")

    try:
        proc = await asyncio.create_subprocess_exec(
            *_build_command(),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(PROJECT_ROOT),
            start_new_session=True,  # 独立会话：超时后可 killpg 清理整个进程组
        )
    except Exception as exc:
        logger.exception("[agent/sandbox] 启动受限子进程失败")
        return f"工具执行失败：沙箱子进程启动失败（{type(exc).__name__}: {exc}）"

    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(input=payload_bytes), timeout=timeout
        )
    except asyncio.TimeoutError:
        await _kill_process_group(proc)
        return (
            f"工具执行超时（超过 {int(timeout)} 秒），已终止受限子进程，"
            "请缩小操作范围或拆分后重试。"
        )
    except Exception as exc:
        logger.exception("[agent/sandbox] 等待受限子进程失败")
        return f"工具执行失败：沙箱子进程通信失败（{type(exc).__name__}: {exc}）"

    if len(stdout_b) > MAX_STDOUT_BYTES:
        return "工具执行失败：沙箱子进程输出超过 1MB 上限，已丢弃，请缩小操作范围。"
    stdout_text = stdout_b.decode("utf-8", errors="replace").strip()
    stderr_text = stderr_b.decode("utf-8", errors="replace").strip()

    try:
        data = json.loads(stdout_text)
    except (ValueError, TypeError):
        return f"工具执行失败：沙箱子进程输出无法解析（非 JSON）{_stderr_tail(stderr_text)}"
    if not isinstance(data, dict):
        return f"工具执行失败：沙箱子进程输出格式错误{_stderr_tail(stderr_text)}"

    if data.get("ok"):
        # 成功：结果原文直接回填（契约与进程内 handler 完全一致）
        return "" if data.get("result") is None else str(data.get("result"))
    error = str(data.get("error") or "未知错误")[:1000]
    return f"工具执行失败：{error}{_stderr_tail(stderr_text)}"
