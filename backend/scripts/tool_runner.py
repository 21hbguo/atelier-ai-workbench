"""受限沙箱的子进程入口：单次执行一个 file_ops_* 工作区文件工具。

父进程（backend.services.agent.sandbox.run_sandboxed）以受限命令启动本模块：
``prlimit --cpu=10 --as=512MB --nproc=64 --nofile=1024 <python> -m backend.scripts.tool_runner``
（root 下还会经 setpriv 降权为 nobody）。任务经 stdin 传一行 JSON，结果写
stdout 一行 JSON，进程退出码恒为 0（结果好坏以 stdout JSON 的 ok 字段表达）。

stdin JSON::
    {"tool": "file_ops_write", "args": {...}, "user_id": 1,
     "workspace_root": "/path/to/user_workspaces",   # 可选：父进程当前工作区根
     "extra": {...},                                  # 可选：ctx.extra 透传
     "extra_module": "/abs/path/mod.py"}              # 可选：测试注册临时工具

stdout JSON::
    {"ok": true, "result": "<工具返回字符串>"}  或  {"ok": false, "error": "..."}

安全与隔离：
- 本模块绝不 import backend.main / backend.database 等任何会连数据库或启动
  后台任务的模块，只加载 registry / context / workspace / tools.file_ops_workspace。
- backend.services.agent 包的 __init__.py 会全量导入内置工具（进而触发
  backend.database 与连接池初始化），因此这里不能走常规 import 路径：改用
  importlib 按文件路径加载所需模块，并预先在 sys.modules 放置
  backend.services.agent / backend.services.agent.tools 占位包，阻止 Python
  执行这两个包的 __init__.py。
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import sys
import types
from pathlib import Path

# 项目根目录（backend/scripts/tool_runner.py 的上两级；子进程 cwd 即此）
PROJECT_ROOT = Path(__file__).resolve().parents[2]

# 沙箱白名单：只允许 file_ops_* 六个工作区文件工具
ALLOWED_TOOLS = frozenset({
    "file_ops_read",
    "file_ops_write",
    "file_ops_edit",
    "file_ops_list",
    "file_ops_glob",
    "file_ops_grep",
})

logger = logging.getLogger("tool_runner")


def _load_module(name: str, path: Path):
    """按文件路径加载模块并注册进 sys.modules（name 为完整模块名）。"""
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        raise ImportError(f"无法加载模块 {name}（{path}）")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_backend_modules() -> None:
    """加载 tool_runner 依赖的最小模块集合（不触发数据库连接/后台任务）。"""
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))
    backend_dir = PROJECT_ROOT / "backend"
    agent_dir = backend_dir / "services" / "agent"
    # 1) 常规导入 backend 与 backend.services（两者的 __init__ 无副作用）
    import backend  # noqa: F401
    import backend.services  # noqa: F401
    # 2) 占位 backend.services.agent 与 backend.services.agent.tools：
    #    阻止 Python 执行这两个包的 __init__.py（会全量导入工具 → backend.database）
    agent_pkg = types.ModuleType("backend.services.agent")
    agent_pkg.__path__ = [str(agent_dir)]
    sys.modules["backend.services.agent"] = agent_pkg
    tools_pkg = types.ModuleType("backend.services.agent.tools")
    tools_pkg.__path__ = [str(agent_dir / "tools")]
    sys.modules["backend.services.agent.tools"] = tools_pkg
    # 3) 按依赖顺序加载具体模块（均在 sys.modules 预注册，模块内部
    #    的 `from backend.services.agent.xxx import ...` 会直接命中）
    _load_module("backend.config", backend_dir / "config.py")
    _load_module("backend.services.agent.schema_gen", agent_dir / "schema_gen.py")
    _load_module("backend.services.agent.registry", agent_dir / "registry.py")
    _load_module("backend.services.agent.context", agent_dir / "context.py")
    _load_module("backend.services.agent.workspace", agent_dir / "workspace.py")
    _load_module(
        "backend.services.agent.tools.file_ops_workspace",
        agent_dir / "tools" / "file_ops_workspace.py",
    )


def _emit_ok(result: str) -> None:
    sys.stdout.write(json.dumps({"ok": True, "result": result}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _emit_error(error: str) -> None:
    sys.stdout.write(json.dumps({"ok": False, "error": error}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


async def _run_once(payload: dict) -> None:
    """执行单个工具调用并把结果写到 stdout（handler 异常也转成 ok:false）。"""
    # 以下 import 必须在 _load_backend_modules 之后（sys.modules 已预注册）
    from backend import config  # noqa: PLC0415
    from backend.services.agent.context import AgentContext  # noqa: PLC0415
    from backend.services.agent.registry import get_tool, list_tools  # noqa: PLC0415

    name = str(payload.get("tool") or "").strip()
    args = payload.get("args")
    if not isinstance(args, dict):
        args = {}
    user_id = payload.get("user_id")

    # 可选：把父进程当前的工作区根目录透传进来（测试 monkeypatch 重定向场景），
    # 工具执行前临时覆盖 config.USER_WORKSPACES_DIR（workspace 动态读取该属性）
    workspace_root = payload.get("workspace_root")
    if workspace_root:
        config.USER_WORKSPACES_DIR = Path(str(workspace_root))

    # 可选：加载测试注册的临时工具模块（仅测试用；生产路径不传该字段）。
    # 模块顶层用 @agent_tool 注册的工具会进入本进程的 registry。
    allowed = ALLOWED_TOOLS
    extra_module = payload.get("extra_module")
    if extra_module:
        mod_path = Path(str(extra_module)).resolve()
        if not mod_path.is_file():
            raise RuntimeError(f"extra_module 不存在: {mod_path}")
        _load_module("sandbox_extra_tools", mod_path)
        allowed = set(ALLOWED_TOOLS) | set(list_tools())

    tool_entry = get_tool(name)
    if name not in allowed or tool_entry is None:
        raise RuntimeError(f"工具 {name} 不允许在受限沙箱中执行")

    extra = payload.get("extra")
    ctx = AgentContext(user_id=user_id, extra=extra if isinstance(extra, dict) else {})
    result = await tool_entry["handler"](args, ctx)
    _emit_ok("" if result is None else str(result))


def main() -> None:
    """子进程入口：一切异常（含 import/JSON 解析失败）都输出 ok:false JSON。"""
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.WARNING,
        format="[tool_runner] %(levelname)s %(message)s",
    )
    try:
        _load_backend_modules()
    except Exception as exc:  # 模块加载失败（如环境缺依赖）
        _emit_error(f"沙箱子进程模块加载失败: {type(exc).__name__}: {str(exc)[:500]}")
        return
    try:
        raw = sys.stdin.buffer.readline()
        if not raw:
            _emit_error("沙箱子进程未收到任务（stdin 为空）")
            return
        try:
            payload = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception as exc:
            _emit_error(f"任务 JSON 解析失败: {type(exc).__name__}: {str(exc)[:500]}")
            return
        if not isinstance(payload, dict):
            _emit_error("任务 JSON 必须是对象")
            return
        asyncio.run(_run_once(payload))
    except Exception as exc:
        logger.exception("工具执行异常")
        _emit_error(f"{type(exc).__name__}: {str(exc)[:500]}")


if __name__ == "__main__":
    main()
