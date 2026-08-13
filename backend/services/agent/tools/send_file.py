"""send_file 工具：把工作区内已写入的文件发送到聊天里供用户下载。

工作区是用户私有目录 data/user_workspaces/user_{id}/（与 file_ops_* 工具同一沙箱），
path 是相对工作区根目录的相对路径。调用前文件必须已由 file_ops_* 工具写入；
本工具只负责把已存在的文件以可下载卡片形式入队 ctx.files，由 loop 以 file
事件增量推给前端（前端展示文件名/大小/说明，点击下载 /api/workspace/files/download）。

权限：与 file_ops_* 写入类工具一致，要求套餐含 file_write 特性。
"""
from __future__ import annotations

import logging
import os
import urllib.parse

from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool
from backend.services.agent.workspace import resolve_workspace_path

logger = logging.getLogger(__name__)

# 可发送文件大小上限 50MB
MAX_SEND_BYTES = 50 * 1024 * 1024


def _has_file_write(ctx) -> bool:
    extra = getattr(ctx, "extra", None) or {}
    return bool(extra.get("entitlements", {}).get("features", {}).get("file_write"))


def _user_id_or_none(ctx) -> int | None:
    return getattr(ctx, "user_id", None)


@agent_tool(
    name="send_file",
    description=(
        "把工作区内已写入的文件发送到聊天里供用户下载/保存：用户明确要求拿到、下载、"
        "导出某个文件时调用此工具（如「把刚才写的文件发给我」「我要下载这个脚本」）。\n"
        "参数规范：\n"
        "1. path（必填）：相对工作区根目录的文件路径（如 report.md、scripts/run.py），"
        "调用前该文件必须已由 file_ops_* 工具写入工作区；\n"
        "2. description（可选）：一句话说明文件内容，展示在文件卡片上。\n"
        "注意：发送后附一句说明即可；文件已发送过就不要重复发送；不要频繁发送无关文件。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "相对工作区根目录的文件路径（调用前文件必须已由 file_ops_* 工具写入）",
            },
            "description": {
                "type": "string",
                "description": "可选，一句话说明文件内容，展示在文件卡片上",
            },
        },
        "required": ["path"],
    },
)
async def send_file(args: dict, ctx: AgentContext) -> str:
    """执行发送：校验权限与路径 → 校验文件存在/大小 → 入队 ctx.files（由 loop 推送前端）。"""
    if not _has_file_write(ctx):
        return "当前套餐不支持文件写入。"
    user_id = _user_id_or_none(ctx)
    if user_id is None:
        return "需要登录后才能使用文件工具"
    path_str = str(args.get("path") or "").strip()
    if not path_str:
        return "send_file 参数错误：path 不能为空，请提供相对工作区根目录的文件路径。"
    description = str(args.get("description") or "").strip()
    try:
        path = resolve_workspace_path(user_id, path_str)
    except ValueError as exc:
        logger.warning("[send_file] 路径无效: %s", exc)
        return f"路径无效：{exc}"
    if not path.exists():
        return f"文件不存在：{path_str}"
    if not path.is_file():
        return f"不是文件：{path_str}"
    try:
        size = os.path.getsize(path)
    except OSError as exc:
        logger.warning("[send_file] 无法访问 %s: %s", path_str, exc)
        return "读取文件失败"
    if size > MAX_SEND_BYTES:
        return f"文件过大（>{MAX_SEND_BYTES // (1024 * 1024)}MB），无法发送，请先拆分或精简文件内容"
    # quote 默认不编码 "/"，正好保留相对路径层级（如 docs/report.md）
    url = f"/api/workspace/files/download?path={urllib.parse.quote(path_str)}"
    ctx.add_file(filename=path.name, url=url, size=size, description=description)
    logger.info("[send_file] 已发送 %s（%d bytes）", path_str, size)
    return f"已发送文件【{path.name}】，用户可在聊天中下载。"
