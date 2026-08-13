"""用户工作区沙箱：为每个用户提供私有目录，agent 文件工具只能在其内读写。

目录结构：data/user_workspaces/user_{user_id}/（根目录由 config.USER_WORKSPACES_DIR 决定）。

路径解析仿 openai-agents 的 WorkspacePathPolicy：
相对路径拼接在工作区根目录下，绝对路径直接使用；解析（resolve，归一化 ".." 并展开
symlink）后再校验结果必须落在根目录内，否则抛 ValueError。所有工具的错误统一按
"抛 ValueError/OSError，由工具 handler 捕获返回错误文本" 处理。
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

from backend import config

logger = logging.getLogger(__name__)

# 用户工作区根目录。各函数运行时动态读取 config.USER_WORKSPACES_DIR（见 _workspace_root），
# 因此测试里 monkeypatch backend.config.USER_WORKSPACES_DIR 即可整体重定向工作区。
WORKSPACE_ROOT = config.USER_WORKSPACES_DIR

# 读/编辑/搜索单文件大小上限 10MB
MAX_FILE_BYTES = 10 * 1024 * 1024
# 单次写入字符上限
MAX_CONTENT_CHARS = 200_000
# 每个用户工作区总容量上限
MAX_WORKSPACE_BYTES = 100 * 1024 * 1024
# 单次读取行数上限
MAX_READ_LINES = 2000
# 单行最大字符数：read 输出与 grep 命中行均按此截断（防超长单行撑爆模型上下文）
MAX_READ_LINE_CHARS = 1000
# 单次列目录条目上限
MAX_LIST_ITEMS = 200
# glob 结果上限
MAX_GLOB_RESULTS = 100
# grep 结果上限
MAX_GREP_RESULTS = 500
# grep 输出单行截断长度
MAX_LINE_CHARS = 300


def _workspace_root() -> Path:
    """运行时读取工作区根目录（动态引用 config 属性，保证 monkeypatch 生效）。"""
    return Path(config.USER_WORKSPACES_DIR)


def user_workspace_root(user_id: int) -> Path:
    """返回用户工作区根目录（不保证目录已存在）。"""
    return _workspace_root() / f"user_{user_id}"


def ensure_user_workspace(user_id: int) -> Path:
    """创建并返回用户工作区根目录。

    权限设为 0o777（mkdir 后显式 chmod，绕过 umask）：受限沙箱子进程以
    nobody 降权运行时需要能写入该目录。只对 user_{id} 根目录设置，不动
    data/user_workspaces 上层目录的既有权限；已有目录也显式 chmod 兜底。
    """
    root = user_workspace_root(user_id)
    root.mkdir(parents=True, exist_ok=True)
    try:
        root.chmod(0o777)
    except OSError:
        logger.warning("[agent/workspace] chmod 0o777 失败: %s", root)
    return root


def workspace_usage_bytes(user_id: int) -> int:
    root = user_workspace_root(user_id)
    if not root.exists():
        return 0
    total = 0
    for dirpath, _, filenames in os.walk(root):
        for filename in filenames:
            path = Path(dirpath) / filename
            try:
                if not path.is_symlink():
                    total += path.stat().st_size
            except OSError:
                continue
    return total


def ensure_workspace_capacity(user_id: int, path: Path, new_size: int) -> None:
    old_size = 0
    try:
        if path.exists() and path.is_file() and not path.is_symlink():
            old_size = path.stat().st_size
    except OSError:
        pass
    if workspace_usage_bytes(user_id) - old_size + new_size > MAX_WORKSPACE_BYTES:
        raise ValueError(f"工作区总容量超过 {MAX_WORKSPACE_BYTES // (1024 * 1024)}MB 上限")


def remove_user_workspace(user_id: int) -> None:
    root = user_workspace_root(user_id)
    if root.exists():
        shutil.rmtree(root)


def resolve_workspace_path(user_id: int, raw_path: str) -> Path:
    """解析并校验工作区内路径，越界抛 ValueError。

    规则：
    - raw_path 必须是非空字符串，且不含 "\\0"；
    - 相对路径拼接在工作区根目录下；绝对路径直接使用（也必须落在根目录内）；
    - 归一化（resolve）后再校验：结果必须等于根目录或在根目录之内，
      否则抛 ValueError（同时挡住 ".." 穿越与 symlink 逃逸）。
    """
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ValueError("路径不能为空")
    if "\0" in raw_path:
        raise ValueError("路径包含非法字符")
    root = user_workspace_root(user_id)
    root_resolved = root.resolve()
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = root / candidate
    candidate = candidate.resolve(strict=False)
    if candidate != root_resolved and root_resolved not in candidate.parents:
        raise ValueError("路径越界：不允许访问工作区之外的文件")
    return candidate
