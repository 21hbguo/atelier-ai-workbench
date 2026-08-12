"""fetch_url 工具：访问用户给出的网页链接并获取正文内容。

依赖 backend.services.url_fetcher（并行开发中的独立模块），import 放在
handler 内部并做 ImportError 兜底，避免该模块未就绪时工具注册/调用崩溃。
"""
from __future__ import annotations

from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool


@agent_tool(
    name="fetch_url",
    description=(
        "访问用户消息中给出的网页链接并获取正文内容。\n"
        "适用场景：用户直接贴出链接（如新闻、文章、文档页）并提问，或回答需要引用该链接内容时，"
        "先调用本工具获取正文，再基于正文回答，不要凭空猜测链接内容。\n"
        "参数说明：url 为用户给出的完整网页链接（http/https）；question 可选，"
        "用于带上用户针对该网页的具体问题（当前仅用于标注，正文内容不依赖它）。\n"
        "返回该网页的标题、URL 与正文文本（正文过长会自动截断并在末尾标注）。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "要访问的完整网页链接（http/https）"},
            "question": {"type": "string", "description": "可选：针对该网页内容的具体问题"},
        },
        "required": ["url"],
    },
)
async def fetch_url_tool(args: dict, ctx: AgentContext) -> str:
    """访问用户给出的网页链接并返回正文内容。"""
    url = str(args.get("url") or "").strip()
    if not url:
        return "请提供要访问的网页链接（url 参数，http/https 开头）。"

    try:
        from backend.services.url_fetcher import fetch_url
    except ImportError:
        return (
            "无法访问该链接：网页抓取模块（url_fetcher）尚未就绪，请稍后再试。"
            "可先用 web_search 搜索该链接相关页面。"
        )

    try:
        result = await fetch_url(url, max_chars=12000)
    except Exception as e:  # noqa: BLE001 - 兜底，任何异常都转为可读错误
        return f"无法访问该链接：{e}"

    if not result.get("ok"):
        return f"无法访问该链接：{result.get('error') or '未知错误'}"

    title = (result.get("title") or "").strip()
    text = (result.get("text") or "").strip()
    if not text:
        return f"链接 {result.get('url') or url} 可访问，但未提取到正文内容。"

    parts = [f"标题：{title}", f"URL：{result.get('url') or url}", "正文：", text]
    return "\n".join(parts)
