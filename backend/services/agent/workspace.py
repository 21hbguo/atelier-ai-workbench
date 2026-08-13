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
import time
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
# 用户上传原件目录名（工作区根下）
UPLOADS_DIR_NAME = "uploads"
# 回收站目录名（工作区根下，隐藏目录）
TRASH_DIR_NAME = ".trash"
# 回收站独立容量上限
MAX_TRASH_BYTES = 50 * 1024 * 1024
# 回收站文件最长保留天数（过期自动清理）
TRASH_MAX_AGE_DAYS = 30
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
    """用户工作区已用字节数（含 uploads 与普通文件；.trash 回收站不计入 100MB 容量）。"""
    root = user_workspace_root(user_id)
    if not root.exists():
        return 0
    total = 0
    for dirpath, dirnames, filenames in os.walk(root):
        # 回收站内容不计入工作区容量（独立 50MB 上限）
        dirnames[:] = [d for d in dirnames if d != TRASH_DIR_NAME]
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


def user_uploads_root(user_id: int) -> Path:
    """返回用户上传原件目录（user_workspace_root/uploads），不保证存在。"""
    return user_workspace_root(user_id) / UPLOADS_DIR_NAME


def ensure_user_uploads(user_id: int) -> Path:
    """创建并返回用户上传原件目录（0o777，参照 ensure_user_workspace）。"""
    uploads = user_uploads_root(user_id)
    uploads.mkdir(parents=True, exist_ok=True)
    try:
        uploads.chmod(0o777)
    except OSError:
        logger.warning("[agent/workspace] chmod 0o777 失败: %s", uploads)
    return uploads


def trash_root(user_id: int) -> Path:
    """返回用户回收站目录（user_workspace_root/.trash），不保证存在。"""
    return user_workspace_root(user_id) / TRASH_DIR_NAME


def rel_workspace_path(user_id: int, path: Path) -> Path:
    """把工作区内已解析路径转成相对工作区根的 Path（用于判断 uploads/.trash 前缀）。

    越界抛 ValueError（与 resolve_workspace_path 同语义）。
    """
    root = user_workspace_root(user_id).resolve()
    resolved = path.resolve()
    try:
        return resolved.relative_to(root)
    except ValueError:
        raise ValueError("路径越界：不允许访问工作区之外的文件") from None


def is_uploads_path(rel: Path) -> bool:
    """rel 是否为 uploads/ 前缀路径（uploads 目录本身或其中文件）。"""
    return bool(rel.parts) and rel.parts[0] == UPLOADS_DIR_NAME


def purge_expired_trash(user_id: int, max_age_days: int = TRASH_MAX_AGE_DAYS) -> int:
    """清理回收站中 mtime 超过 max_age_days 的文件/目录（不跟随 symlink），返回清理条目数。"""
    trash = trash_root(user_id)
    if not trash.exists():
        return 0
    cutoff = time.time() - max_age_days * 86400
    removed = 0
    for child in trash.iterdir():
        if child.is_symlink():
            continue
        try:
            if child.stat().st_mtime >= cutoff:
                continue
        except OSError:
            continue
        try:
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
            removed += 1
        except OSError:
            logger.exception("[agent/workspace] purge trash 失败: %s", child)
    return removed


def move_to_trash(user_id: int, path: Path) -> Path:
    """把工作区内文件/目录移入回收站 .trash/{毫秒时间戳}_{basename}，返回回收站内目标路径。

    - path 必须已 resolve 且落在工作区内（调用方已校验，此处再兜底）；
    - .trash 内的文件不能再次删除；
    - 移动后顺带清理过期回收站条目，并检查回收站总量，超 MAX_TRASH_BYTES 抛 ValueError。
    """
    root = user_workspace_root(user_id)
    root_resolved = root.resolve()
    resolved = path.resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise ValueError("路径越界：不允许访问工作区之外的文件")
    trash = trash_root(user_id)
    trash_resolved = trash.resolve()
    if resolved == trash_resolved or trash_resolved in resolved.parents:
        raise ValueError("回收站内的文件不能再次删除")
    trash.mkdir(parents=True, exist_ok=True)
    target = trash / f"{int(time.time() * 1000)}_{path.name}"
    path.rename(target)
    # 顺带清理过期条目，再检查回收站总量
    purge_expired_trash(user_id)
    total = 0
    for p in trash.rglob("*"):
        if p.is_file() and not p.is_symlink():
            try:
                total += p.stat().st_size
            except OSError:
                continue
    if total > MAX_TRASH_BYTES:
        raise ValueError(f"回收站已满（{MAX_TRASH_BYTES // (1024 * 1024)}MB），请先清空回收站")
    return target


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
