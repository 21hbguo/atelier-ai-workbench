"""file_ops_workspace 工具：用户工作区沙箱内的文件读写/编辑/列目录/搜索。

工作区是用户私有目录 data/user_workspaces/user_{id}/，所有路径参数都是相对
工作区根目录的相对路径（绝对路径与 ".." 穿越、symlink 逃逸都会被拒绝）。

权限：除 file_ops_read（只读）外，其余工具均要求套餐含 file_write 特性。
"""
from __future__ import annotations

import asyncio
import fnmatch
import logging
import os
import re
from collections import OrderedDict
from pathlib import Path

from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool
from backend.services.agent.workspace import (
    MAX_CONTENT_CHARS,
    MAX_FILE_BYTES,
    MAX_GLOB_RESULTS,
    MAX_GREP_RESULTS,
    MAX_LINE_CHARS,
    MAX_LIST_ITEMS,
    MAX_READ_LINE_CHARS,
    MAX_READ_LINES,
    resolve_workspace_path,
    user_workspace_root,
)

logger = logging.getLogger(__name__)

# 编辑/写入并发锁：按 resolve 后的绝对路径分锁，read-modify-write 全程持锁；
# LRU：超过 1000 条时淘汰最久未用的锁（popitem），避免整体清空造成竞态窗口。
_EDIT_LOCKS: OrderedDict[str, asyncio.Lock] = OrderedDict()
_EDIT_LOCKS_MAX = 1000

# 工作区说明（各工具 description 共用）
_WORKSPACE_DESC = (
    "工作区是用户私有目录 data/user_workspaces/user_{id}/，所有路径是相对工作区根目录的相对路径。"
)


def _has_file_write(ctx) -> bool:
    extra = getattr(ctx, "extra", None) or {}
    return bool(extra.get("entitlements", {}).get("features", {}).get("file_write"))


def _user_id_or_none(ctx) -> int | None:
    return getattr(ctx, "user_id", None)


def _is_binary(path: Path) -> bool:
    """读文件前 8KB，含 b"\\0" 视为二进制。"""
    try:
        with open(path, "rb") as f:
            return b"\0" in f.read(8192)
    except OSError:
        return False


def _get_edit_lock(path: Path) -> asyncio.Lock:
    key = str(path)
    lock = _EDIT_LOCKS.get(key)
    if lock is None:
        if len(_EDIT_LOCKS) >= _EDIT_LOCKS_MAX:
            _EDIT_LOCKS.popitem(last=False)  # 淘汰最久未用，保留窗口最小
        lock = asyncio.Lock()
        _EDIT_LOCKS[key] = lock
    else:
        _EDIT_LOCKS.move_to_end(key)
    return lock


# ---------- file_ops_read ----------

@agent_tool(
    name="file_ops_read",
    description=(
        f"{_WORKSPACE_DESC}读取文本文件内容并带行号展示，支持 offset/limit 分页"
        "（offset 起始行号从 1 起，limit 最大行数上限 2000）。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对工作区根目录的文件路径"},
            "offset": {"type": "integer", "description": "起始行号（从 1 开始），默认 1"},
            "limit": {"type": "integer", "description": "最大读取行数，默认 200，上限 2000"},
        },
        "required": ["path"],
    },
)
async def file_ops_read(args: dict, ctx: AgentContext) -> str:
    user_id = _user_id_or_none(ctx)
    if user_id is None:
        return "需要登录后才能使用文件工具"
    path_str = str(args.get("path") or "").strip()
    try:
        offset = max(1, int(args.get("offset") or 1))
    except (TypeError, ValueError):
        offset = 1
    try:
        limit = min(max(1, int(args.get("limit") or 200)), MAX_READ_LINES)
    except (TypeError, ValueError):
        limit = 200
    try:
        path = resolve_workspace_path(user_id, path_str)
    except ValueError as exc:
        logger.warning("[file_ops_workspace] read 路径无效: %s", exc)
        return f"路径无效：{exc}"
    if not path.exists():
        return f"文件不存在：{path_str}"
    try:
        if os.path.getsize(path) > MAX_FILE_BYTES:
            return f"文件过大（>{MAX_FILE_BYTES // (1024 * 1024)}MB），请用 file_ops_grep 或联系管理员"
    except OSError as exc:
        logger.warning("[file_ops_workspace] read 无法访问 %s: %s", path_str, exc)
        return "读取文件失败"  # 不回显 OSError 消息（可能含服务器绝对路径）
    if _is_binary(path):
        return "二进制文件不支持读取"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception:
        logger.exception("[file_ops_workspace] 读取文件失败")
        return "读取文件失败"
    total = len(lines)
    start = offset - 1
    chunk = lines[start:start + limit]
    body_lines = []
    for i, line in enumerate(chunk):
        if len(line) > MAX_READ_LINE_CHARS:
            line = line[:MAX_READ_LINE_CHARS] + "…（行过长已截断，可用 file_ops_grep 精确定位）"
        body_lines.append(f"{start + i + 1}: {line}")
    body = "\n".join(body_lines)
    tail = f"（共 {total} 行，显示 {len(chunk)} 行"
    if start + len(chunk) < total:
        tail += "，已截断请用 offset/limit 继续读取"
    tail += "）"
    logger.info("[file_ops_workspace] 已读取 %s（%d 行）", path_str, total)
    return body + ("\n" if body else "") + tail


# ---------- file_ops_write ----------

@agent_tool(
    name="file_ops_write",
    description=(
        f"{_WORKSPACE_DESC}把文本内容写入文件，支持 overwrite（覆盖）/ append（追加）/"
        "create（仅新建）三种模式；父目录自动创建。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对工作区根目录的文件路径"},
            "content": {"type": "string", "description": "要写入的文本内容"},
            "mode": {
                "type": "string",
                "enum": ["overwrite", "append", "create"],
                "description": "写入模式：overwrite 覆盖（默认）、append 追加、create 仅新建（已存在则失败）",
            },
        },
        "required": ["path", "content"],
    },
)
async def file_ops_write(args: dict, ctx: AgentContext) -> str:
    if not _has_file_write(ctx):
        return "当前套餐不支持文件写入。"
    user_id = _user_id_or_none(ctx)
    if user_id is None:
        return "需要登录后才能使用文件工具"
    path_str = str(args.get("path") or "").strip()
    content = str(args.get("content") or "")
    mode = str(args.get("mode") or "overwrite")
    if mode not in ("overwrite", "append", "create"):
        return "mode 参数必须是 overwrite / append / create 之一"
    if len(content) > MAX_CONTENT_CHARS:
        return f"写入内容过长（{len(content)} 字符，上限 {MAX_CONTENT_CHARS}），请分段写入。"
    try:
        path = resolve_workspace_path(user_id, path_str)
    except ValueError as exc:
        logger.warning("[file_ops_workspace] write 路径无效: %s", exc)
        return f"路径无效：{exc}"
    try:
        async with _get_edit_lock(path):  # 与 edit 共用锁，防 read-modify-write 并发丢更新
            if mode == "create" and path.exists():
                return "文件已存在，如需覆盖请用 overwrite 模式"
            path.parent.mkdir(parents=True, exist_ok=True)
            if mode == "append":
                with open(path, "a", encoding="utf-8") as f:
                    f.write(content)
            else:
                path.write_text(content, encoding="utf-8")
    except OSError:
        logger.exception("[file_ops_workspace] 写入文件失败")
        return "写入文件失败"
    logger.info("[file_ops_workspace] 已写入 %s（%d 字符，%s）", path_str, len(content), mode)
    return f"已写入 {path_str}（{len(content)} 字符，{mode}）"


# ---------- file_ops_edit ----------

@agent_tool(
    name="file_ops_edit",
    description=(
        f"{_WORKSPACE_DESC}对文件做局部替换编辑（字符串替换，非行号）：把 old_string "
        "替换为 new_string；replace_all=false 时要求 old_string 在文件中唯一。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对工作区根目录的文件路径"},
            "old_string": {"type": "string", "description": "要查找替换的原文"},
            "new_string": {"type": "string", "description": "替换后的新文本"},
            "replace_all": {"type": "boolean", "description": "是否替换所有出现（默认 false，仅唯一匹配时替换）"},
        },
        "required": ["path", "old_string", "new_string"],
    },
)
async def file_ops_edit(args: dict, ctx: AgentContext) -> str:
    if not _has_file_write(ctx):
        return "当前套餐不支持文件写入。"
    user_id = _user_id_or_none(ctx)
    if user_id is None:
        return "需要登录后才能使用文件工具"
    path_str = str(args.get("path") or "").strip()
    old_string = str(args.get("old_string") or "")
    new_string = str(args.get("new_string") or "")
    replace_all = bool(args.get("replace_all"))
    if not old_string:
        return "old_string 不能为空，请提供要替换的文本。"
    try:
        path = resolve_workspace_path(user_id, path_str)
    except ValueError as exc:
        logger.warning("[file_ops_workspace] edit 路径无效: %s", exc)
        return f"路径无效：{exc}"
    if not path.exists():
        return f"文件不存在：{path_str}"
    try:
        if os.path.getsize(path) > MAX_FILE_BYTES:
            return f"文件过大（>{MAX_FILE_BYTES // (1024 * 1024)}MB），请用 file_ops_grep 或联系管理员"
    except OSError as exc:
        logger.warning("[file_ops_workspace] edit 无法访问 %s: %s", path_str, exc)
        return "读取文件失败"  # 不回显 OSError 消息
    if _is_binary(path):
        return "二进制文件不支持编辑"
    async with _get_edit_lock(path):
        try:
            content = path.read_text(encoding="utf-8")
        except Exception:
            logger.exception("[file_ops_workspace] 读取文件失败")
            return "读取文件失败"
        count = content.count(old_string)
        if count == 0:
            return "未在文件中找到要替换的文本，请先用 file_ops_read 查看文件当前内容"
        if count > 1 and not replace_all:
            return f"待替换文本出现 {count} 次，请提供更多上下文使 old_string 唯一，或设置 replace_all=true"
        try:
            path.write_text(content.replace(old_string, new_string), encoding="utf-8")
        except OSError:
            logger.exception("[file_ops_workspace] 写入文件失败")
            return "写入文件失败"
    logger.info("[file_ops_workspace] 已编辑 %s，替换 %d 处", path_str, count)
    return f"已替换 {count} 处"


# ---------- file_ops_list ----------

def _list_entries(path: Path, recursive: bool):
    """返回 [(显示名, Path)]：目录在前、按名字排序；recursive 时递归收集。"""
    if not recursive:
        entries = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        return [(p.name, p) for p in entries]
    items = []
    for dirpath, dirnames, filenames in os.walk(path):
        rel = Path(dirpath).relative_to(path)
        for d in sorted(dirnames):
            items.append((rel / d, path / rel / d))
        for f in sorted(filenames):
            items.append((rel / f, path / rel / f))
    items.sort(key=lambda pair: (not pair[1].is_dir(), pair[0].as_posix().lower()))
    return [(name.as_posix(), p) for name, p in items]


@agent_tool(
    name="file_ops_list",
    description=(
        f"{_WORKSPACE_DESC}列出目录内容（目录在前、按名字排序），每行显示 "
        "{name}（{dir|file}，{size} bytes）；recursive=true 时递归列出子目录。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对工作区根目录的目录路径，默认 ."},
            "recursive": {"type": "boolean", "description": "是否递归列出子目录，默认 false"},
        },
        "required": [],
    },
)
async def file_ops_list(args: dict, ctx: AgentContext) -> str:
    if not _has_file_write(ctx):
        return "当前套餐不支持文件写入。"
    user_id = _user_id_or_none(ctx)
    if user_id is None:
        return "需要登录后才能使用文件工具"
    path_str = str(args.get("path") or ".").strip() or "."
    recursive = bool(args.get("recursive"))
    try:
        path = resolve_workspace_path(user_id, path_str)
    except ValueError as exc:
        logger.warning("[file_ops_workspace] list 路径无效: %s", exc)
        return f"路径无效：{exc}"
    if not path.exists():
        return f"目录不存在：{path_str}"
    if not path.is_dir():
        return f"不是目录：{path_str}"
    try:
        entries = _list_entries(path, recursive)
    except OSError:
        logger.exception("[file_ops_workspace] 列目录失败")
        return "列目录失败"
    if not entries:
        return "（空目录）"
    truncated = len(entries) > MAX_LIST_ITEMS
    lines = []
    for name, p in entries[:MAX_LIST_ITEMS]:
        try:
            size = p.stat().st_size
        except OSError:
            size = 0
        kind = "dir" if p.is_dir() else "file"
        lines.append(f"{name}（{kind}，{size} bytes）")
    if truncated:
        lines.append(f"（条目过多，已截断，仅显示前 {MAX_LIST_ITEMS} 个）")
    logger.info("[file_ops_workspace] 已列出 %s（%d 个条目）", path_str, len(entries))
    return "\n".join(lines)


# ---------- file_ops_glob ----------

@agent_tool(
    name="file_ops_glob",
    description=(
        f"{_WORKSPACE_DESC}按 glob 模式查找文件（如 **/*.md），返回相对工作区根目录"
        "的路径列表，每行一个。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "pattern": {"type": "string", "description": "glob 模式，如 **/*.md"},
            "base_path": {"type": "string", "description": "搜索起始目录（相对工作区根目录），默认 ."},
        },
        "required": ["pattern"],
    },
)
async def file_ops_glob(args: dict, ctx: AgentContext) -> str:
    if not _has_file_write(ctx):
        return "当前套餐不支持文件写入。"
    user_id = _user_id_or_none(ctx)
    if user_id is None:
        return "需要登录后才能使用文件工具"
    pattern = str(args.get("pattern") or "").strip()
    if not pattern:
        return "glob 模式不能为空，例如 **/*.md"
    if "\0" in pattern:
        return "路径包含非法字符"
    # 预校验：拒绝绝对模式与 .. 穿越（否则 ** 可对工作区外目录树做递归遍历）
    pattern_parts = Path(pattern).parts
    if Path(pattern).is_absolute() or ".." in pattern_parts:
        return "glob 模式不能包含绝对路径或 .. 穿越"
    base_str = str(args.get("base_path") or ".").strip() or "."
    try:
        base = resolve_workspace_path(user_id, base_str)
        root_resolved = user_workspace_root(user_id).resolve()
    except ValueError as exc:
        logger.warning("[file_ops_workspace] glob 路径无效: %s", exc)
        return f"路径无效：{exc}"
    try:
        matches = sorted(base.glob(pattern), key=lambda p: p.name.lower())
    except (ValueError, NotImplementedError, OSError) as exc:
        logger.warning("[file_ops_workspace] glob 模式无效: %s", exc)
        return f"glob 模式无效：{exc}"
    results: list[str] = []
    truncated = False
    for p in matches:
        try:
            rel = p.resolve().relative_to(root_resolved)
        except (ValueError, OSError):
            continue  # 越过工作区的结果（如模式含 .. 或 symlink 逃逸）直接丢弃
        results.append(rel.as_posix())
        if len(results) >= MAX_GLOB_RESULTS:
            truncated = True
            break
    if not results:
        return "未找到匹配文件"
    out = "\n".join(results)
    if truncated:
        out += f"\n（结果过多，已截断，仅显示前 {MAX_GLOB_RESULTS} 个）"
    logger.info("[file_ops_workspace] glob %r 找到 %d 个文件", pattern, len(results))
    return out


# ---------- file_ops_grep ----------

@agent_tool(
    name="file_ops_grep",
    description=(
        f"{_WORKSPACE_DESC}用正则表达式在目录内递归搜索文件内容，命中输出 "
        "{相对路径}:{行号}: {行内容}；可用 file_pattern（fnmatch）按文件名过滤。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "pattern": {"type": "string", "description": "正则表达式"},
            "path": {"type": "string", "description": "搜索目录（相对工作区根目录），默认 ."},
            "file_pattern": {"type": "string", "description": "可选，fnmatch 文件名过滤，如 *.py"},
            "max_results": {"type": "integer", "description": "最大命中数，默认 100，上限 500"},
        },
        "required": ["pattern"],
    },
)
async def file_ops_grep(args: dict, ctx: AgentContext) -> str:
    if not _has_file_write(ctx):
        return "当前套餐不支持文件写入。"
    user_id = _user_id_or_none(ctx)
    if user_id is None:
        return "需要登录后才能使用文件工具"
    pattern = str(args.get("pattern") or "")
    if not pattern:
        return "pattern（正则表达式）不能为空"
    if len(pattern) > 200:
        return "正则表达式过长（上限 200 字符）"
    try:
        compiled = re.compile(pattern)
    except re.error as exc:
        return f"正则表达式无效：{exc}"
    path_str = str(args.get("path") or ".").strip() or "."
    file_pattern = str(args.get("file_pattern") or "") or None
    try:
        max_results = max(1, min(int(args.get("max_results") or 100), MAX_GREP_RESULTS))
    except (TypeError, ValueError):
        max_results = 100
    try:
        search_path = resolve_workspace_path(user_id, path_str)
        root_resolved = user_workspace_root(user_id).resolve()
    except ValueError as exc:
        logger.warning("[file_ops_workspace] grep 路径无效: %s", exc)
        return f"路径无效：{exc}"
    if not search_path.exists():
        return f"目录不存在：{path_str}"

    hits: list[str] = []
    truncated = False

    def _scan_file(fpath: Path, rel_dir: Path) -> bool:
        """扫描单个文件；命中写入 hits；返回是否已达到 max_results 上限。"""
        nonlocal truncated
        if fpath.is_symlink():  # 防 symlink 逃逸到工作区外
            return False
        try:
            if _is_binary(fpath) or os.path.getsize(fpath) > MAX_FILE_BYTES:
                return False
        except OSError:
            return False
        if file_pattern and not fnmatch.fnmatch(fpath.name, file_pattern):
            return False
        try:
            with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                for lineno, line in enumerate(f, 1):
                    if len(line) > 4096:
                        continue  # 超长行跳过：防灾难性回溯正则阻塞事件循环
                    if compiled.search(line):
                        snippet = line.rstrip("\n")[:MAX_LINE_CHARS]
                        hits.append(f"{(rel_dir / fpath.name).as_posix()}:{lineno}: {snippet}")
                        if len(hits) >= max_results:
                            truncated = True
                            return True
        except OSError:
            return False
        return False

    if search_path.is_file():
        try:
            rel_dir = search_path.parent.relative_to(root_resolved)
        except ValueError:
            rel_dir = Path(".")
        _scan_file(search_path, rel_dir)
    else:
        for dirpath, dirnames, filenames in os.walk(search_path):
            dirnames.sort()
            try:
                rel_dir = Path(dirpath).relative_to(root_resolved)
            except ValueError:
                continue
            for fname in sorted(filenames):
                if _scan_file(Path(dirpath) / fname, rel_dir):
                    break
            if truncated:
                break
    if not hits:
        return "未找到匹配"
    out = "\n".join(hits)
    if truncated:
        out += "\n（结果过多，已截断）"
    logger.info("[file_ops_workspace] grep %r 命中 %d 处", pattern, len(hits))
    return out
