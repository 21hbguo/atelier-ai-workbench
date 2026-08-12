"""show_widget 工具：LLM 在对话中直接绘制线框图/流程图/架构图/时序图等可视化内容。

工具不生成真实图片，而是产出 SVG 或 HTML 片段，通过 ctx.widgets 入队后由
loop 以 widget 事件流式推给前端渲染（前端按 kind 展示：svg 用 <img>/内联渲染，
html 用 iframe sandbox 或容器注入）。code 是纯标记内容，不落库到 LLM 上下文。
"""
from __future__ import annotations

import logging
import re

from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool

logger = logging.getLogger(__name__)

# code 长度限制（去首尾空白后）
MIN_CODE_LEN = 1
MAX_CODE_LEN = 20000

# 危险内容剥离模式（大小写不敏感，按序执行）：
# 先整块剥 <script>/<foreignObject> 及其内容，再剥孤立开标签；
# 事件属性 on*、javascript: 协议、expression( 一律清除。
_STRIP_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"<\s*script\b[^>]*>.*?<\s*/\s*script\s*>", re.IGNORECASE | re.DOTALL), ""),
    (re.compile(r"<\s*script\b[^>]*/?>", re.IGNORECASE), ""),
    (re.compile(r"<\s*iframe\b[^>]*/?>", re.IGNORECASE), ""),
    (re.compile(r"<\s*object\b[^>]*/?>", re.IGNORECASE), ""),
    (re.compile(r"<\s*embed\b[^>]*/?>", re.IGNORECASE), ""),
    (re.compile(r"<\s*foreignObject\b[^>]*>.*?<\s*/\s*foreignObject\s*>", re.IGNORECASE | re.DOTALL), ""),
    (re.compile(r"<\s*foreignObject\b[^>]*/?>", re.IGNORECASE), ""),
    (re.compile(r"\son\w+\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)", re.IGNORECASE), ""),
    (re.compile(r"javascript\s*:", re.IGNORECASE), ""),
    (re.compile(r"expression\s*\(", re.IGNORECASE), ""),
]

_SVG_OPEN_RE = re.compile(r"^\s*<\s*svg\b", re.IGNORECASE)
_SVG_CLOSE_RE = re.compile(r"<\s*/\s*svg\s*>", re.IGNORECASE)


def clean_widget_code(kind: str, code: str) -> str:
    """清理 widget code 中的危险内容（大小写不敏感），返回清理后版本。

    kind=svg 时剥离后仍须以 <svg 开头且以 </svg> 结尾，否则返回空串（调用方丢弃）。
    kind=html 时清理后为空串也视为无效。
    """
    cleaned = code
    for pattern, repl in _STRIP_PATTERNS:
        cleaned = pattern.sub(repl, cleaned)
    cleaned = cleaned.strip()
    if not cleaned:
        return ""
    if kind == "svg":
        if not _SVG_OPEN_RE.match(cleaned) or not _SVG_CLOSE_RE.search(cleaned):
            return ""
    return cleaned


@agent_tool(
    name="show_widget",
    description=(
        "画图/可视化工具：用户要求画线框图、流程图、架构图、时序图、思维导图、"
        "页面原型/网页 mockup 等图表或可视化内容时调用此工具（无需生成真实图片）。\n"
        "参数规范：\n"
        "1. title（可选）：简短标题，如「登录页线框图」，默认取 kind 对应名称；\n"
        "2. kind（必填）：svg 或 html；\n"
        "3. code（必填）：\n"
        "   - kind=svg 时必须是完整 <svg ...>...</svg> 文档：建议 viewBox=\"0 0 680 400\" 类"
        "比例，节点用圆角矩形（rx/ry 属性），连线/箭头用 <marker> 定义后由 <path>/<line> 引用，"
        "样式用属性或内联 style，禁止 <script> 与事件属性（on*）；\n"
        "   - kind=html 时是页面片段：禁止 <!DOCTYPE>/<html>/<head>/<body>/<script>/<iframe>，"
        "可含 <style> 样式。\n"
        "注意：一次调用产出 1 个图，复杂系统可拆成多次调用；调用后附一句说明即可，不要回显 code。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "简短标题（可选），如「登录页线框图」"},
            "kind": {
                "type": "string",
                "enum": ["svg", "html"],
                "description": "可视化类型：svg=矢量图表（线框图/流程图/架构图/时序图/思维导图），html=页面片段（网页原型/mockup）",
            },
            "code": {
                "type": "string",
                "description": "内容：kind=svg 时为完整 <svg>...</svg>；kind=html 时为页面片段（禁 DOCTYPE/html/head/body/script/iframe，可含 <style>）",
            },
        },
        "required": ["kind", "code"],
    },
)
async def show_widget(args: dict, ctx: AgentContext) -> str:
    """执行画图：校验并清理 code → 入队 ctx.widgets（由 loop 增量推送前端渲染）。"""
    try:
        kind = str(args.get("kind") or "").strip().lower()
        title = str(args.get("title") or "").strip()
        raw_code = args.get("code")
        code = str(raw_code).strip() if raw_code is not None else ""
        if kind not in ("svg", "html"):
            return "show_widget 参数错误：kind 仅支持 svg 或 html。"
        if not (MIN_CODE_LEN <= len(code) <= MAX_CODE_LEN):
            return f"show_widget 参数错误：code 长度需在 {MIN_CODE_LEN}-{MAX_CODE_LEN} 字符之间（当前 {len(code)} 字符）。"
        cleaned = clean_widget_code(kind, code)
        if not cleaned:
            return "show_widget 已丢弃：内容不是有效的 SVG（需以 <svg 开头且以 </svg> 结尾）或页面片段，请按规范重新生成。"
        ctx.add_widget(kind, title, cleaned)
        display = title or ("SVG 图表" if kind == "svg" else "页面原型")
        return f"已生成【{display}】，正在展示。"
    except Exception:
        logger.exception("[show_widget] 执行异常")
        return "画图工具执行失败，请稍后重试或换一种描述再试。"
