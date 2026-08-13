"""make_deck 工具：生成高级演示文稿（.pptx + .html 双产物）到用户工作区并自动发送。

与 make_office 系列行为一致：
1. 权限：套餐需含 file_write 特性，且用户已登录（与 file_ops_* / send_file / make_office 一致）；
2. 路径：filename 为相对工作区根目录的相对路径（resolve_workspace_path 校验越界），
   必须以 .pptx 结尾（大小写不敏感），父目录自动创建，同名文件直接覆盖；
3. 生成两份产物：x.pptx（python-pptx 可编辑演示文稿，7 种版式）+ x.html（同名自包含
   网页版预览，内联 CSS 主题变量，浏览器直接打开即可浏览，16:9 每页 1280x720）；
4. 任一产物大小超过 50MB 时删除两份并报错；成功则 ctx.add_file 入队两次（先 .pptx
   后 .html），由 loop 以 file 事件增量推给前端（前端 FileCard 展示文件名/大小/说明，
   点击下载 /api/workspace/files/download）。
生成/校验失败返回纯错误文本，不发送任何文件。
"""
from __future__ import annotations

import html
import logging
import os
import urllib.parse
from pathlib import Path

from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool
from backend.services.agent.tools.make_office import BODY_FONT, DEFAULT_THEME, THEMES
from backend.services.agent.tools.send_file import MAX_SEND_BYTES
from backend.services.agent.workspace import resolve_workspace_path

logger = logging.getLogger(__name__)

# ---- 参数上限（防御模型传超大规模数据撑爆内存/事件循环，超限返回明确错误引导缩小规模）----
MAX_DECK_SLIDES = 30
MAX_DECK_BULLETS_PER_SLIDE = 8
MAX_DECK_BULLET_CHARS = 100
MAX_DECK_TITLE_CHARS = 100
MAX_DECK_QUOTE_CHARS = 300
MAX_DECK_TOTAL_CHARS = 100_000  # 全部文本字段（含 notes）累计

# 7 种版式：封面 / 章节分隔 / 标题+要点（默认） / 双栏 / 引用 / 数据大字 / 结束页
LAYOUTS = ("cover", "section", "title_content", "two_column", "quote", "data_callout", "ending")
DEFAULT_LAYOUT = "title_content"

# ---- HTML 网页版预览画布：16:9 固定 1280x720，页间分页符，允许用户滚动浏览 ----
SLIDE_W = 1280
SLIDE_H = 720
PAGE_MARGIN = 48  # 页边距 px
TITLE_FONT_SIZE = 36  # 标题字号 px
BODY_FONT_SIZE = 16  # 正文/要点字号 px


def _has_file_write(ctx) -> bool:
    extra = getattr(ctx, "extra", None) or {}
    return bool(extra.get("entitlements", {}).get("features", {}).get("file_write"))


def _user_id_or_none(ctx) -> int | None:
    return getattr(ctx, "user_id", None)


def _cleanup(*paths: Path) -> None:
    """删除已写文件（失败仅记 warning，不阻断错误返回）。"""
    for p in paths:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            logger.warning("[make_deck] 清理失败: %s", p)


def _validate_theme(args: dict) -> str | None:
    """theme 必须是 THEMES 三套之一；不传则用默认主题 executive（同 make_office）。"""
    theme = args.get("theme")
    if theme is not None and theme not in THEMES:
        return "theme 必须是 executive/minimal/fresh 之一"
    return None


def _validate_deck_args(args: dict) -> str | None:
    """参数校验：结构 + 上限（slides≤30、每页 bullets≤8 条且每条≤100 字符、
    title≤100、quote≤300、全部文本总字符≤100000）。布局特定字段缺省容忍
    （cover 无 bullets、quote 无 title 等都允许，字段全部可选）。"""
    err = _validate_theme(args)
    if err:
        return err
    slides = args.get("slides")
    if not isinstance(slides, list) or not slides:
        return "make_deck 参数错误：slides 不能为空，请提供至少一页幻灯片。"
    if len(slides) > MAX_DECK_SLIDES:
        return f"参数超限：幻灯片最多 {MAX_DECK_SLIDES} 页（当前 {len(slides)} 页），请精简后重试。"
    total = 0
    for i, slide in enumerate(slides):
        if not isinstance(slide, dict):
            return f"make_deck 参数错误：第 {i + 1} 页幻灯片必须是对象（含 layout/title/bullets 等）。"
        layout = slide.get("layout")
        if layout is not None and layout not in LAYOUTS:
            return f"make_deck 参数错误：layout 必须是 {'/'.join(LAYOUTS)} 之一。"
        title = slide.get("title")
        if title is not None and len(str(title)) > MAX_DECK_TITLE_CHARS:
            return f"参数超限：第 {i + 1} 页幻灯片标题最多 {MAX_DECK_TITLE_CHARS} 字符，请精简后重试。"
        for key in ("bullets", "right_bullets"):
            val = slide.get(key)
            if val is None:
                continue
            if not isinstance(val, list):
                return f"make_deck 参数错误：第 {i + 1} 页幻灯片的 {key} 必须是字符串数组。"
            if len(val) > MAX_DECK_BULLETS_PER_SLIDE:
                return f"参数超限：第 {i + 1} 页幻灯片要点最多 {MAX_DECK_BULLETS_PER_SLIDE} 条（当前 {len(val)} 条），请精简后重试。"
            for b in val:
                if len(str(b)) > MAX_DECK_BULLET_CHARS:
                    return f"参数超限：单条要点最多 {MAX_DECK_BULLET_CHARS} 字符，请精简后重试。"
        quote = slide.get("quote")
        if quote is not None and len(str(quote)) > MAX_DECK_QUOTE_CHARS:
            return f"参数超限：第 {i + 1} 页引用文字最多 {MAX_DECK_QUOTE_CHARS} 字符，请精简后重试。"
        for key in ("title", "subtitle", "quote", "author", "stat", "stat_label", "notes"):
            total += len(str(slide.get(key) or ""))
        total += sum(len(str(b)) for b in (slide.get("bullets") or []))
        total += sum(len(str(b)) for b in (slide.get("right_bullets") or []))
        if total > MAX_DECK_TOTAL_CHARS:
            return f"参数超限：全部文本总字符数超过上限 {MAX_DECK_TOTAL_CHARS}，请精简内容后重试。"
    return None


async def _run_deck(ctx, args) -> str:
    """执行骨架：权限/登录 → 路径 → 参数校验 → 生成双产物 → 大小检查 → 发送两次。"""
    if not _has_file_write(ctx):
        return "当前套餐不支持文件写入。"
    user_id = _user_id_or_none(ctx)
    if user_id is None:
        return "需要登录后才能使用文件工具"
    filename = str(args.get("filename") or "").strip()
    if not filename:
        return "make_deck 参数错误：filename 不能为空，请提供以 .pptx 结尾的文件名。"
    if not filename.lower().endswith(".pptx"):
        return "文件名必须以 .pptx 结尾"
    try:
        path = resolve_workspace_path(user_id, filename)
    except ValueError as exc:
        logger.warning("[make_deck] %s 路径无效: %s", filename, exc)
        return f"路径无效：{exc}"
    err = _validate_deck_args(args)
    if err:
        return err
    path.parent.mkdir(parents=True, exist_ok=True)
    # 同名 HTML 自动生成（保留子目录层级，如 docs/report.pptx → docs/report.html）
    html_rel = filename[: -len(".pptx")] + ".html"
    html_path = path.with_suffix(".html")
    theme = args.get("theme") or DEFAULT_THEME
    try:
        _build_pptx(path, args, theme)
        _build_html(html_path, args, theme)
    except Exception as exc:
        logger.exception("[make_deck] 生成失败")
        _cleanup(path, html_path)  # 清掉可能写了一半的文件
        return f"生成失败：{exc}"
    # 大小检查：两份产物任一超过 50MB 都删除并报错
    try:
        pptx_size = os.path.getsize(path)
        html_size = os.path.getsize(html_path)
    except OSError as exc:
        logger.warning("[make_deck] 无法访问 %s: %s", filename, exc)
        _cleanup(path, html_path)
        return "读取文件失败"
    if pptx_size > MAX_SEND_BYTES or html_size > MAX_SEND_BYTES:
        _cleanup(path, html_path)
        return f"文件过大（>{MAX_SEND_BYTES // (1024 * 1024)}MB），无法发送，请先精简文件内容"
    # quote 默认不编码 "/"，正好保留相对路径层级（如 docs/report.pptx）
    pptx_url = f"/api/workspace/files/download?path={urllib.parse.quote(filename)}"
    html_url = f"/api/workspace/files/download?path={urllib.parse.quote(html_rel)}"
    # 先 .pptx 后 .html（前端按入队顺序展示下载卡片）
    ctx.add_file(filename=path.name, url=pptx_url, size=pptx_size, description="PPT 演示文稿（可编辑）")
    ctx.add_file(filename=html_path.name, url=html_url, size=html_size, description="HTML 网页版预览")
    n = len(args.get("slides") or [])
    logger.info("[make_deck] 已生成并发送 %s 与 %s（%d 页）", filename, html_rel, n)
    return f"已生成演示文稿【{path.name}】及网页版预览【{html_path.name}】，用户可在聊天中下载。共 {n} 页。"


# ---------- HTML 网页版预览（自包含单文件） ----------

def _esc(value) -> str:
    """HTML 转义（防注入）：所有模型文本进 HTML 前必须转义。"""
    return html.escape(str(value), quote=True)


def _bullets_html(items: list) -> str:
    """要点列表 <ul>（每项已转义）。"""
    if not items:
        return ""
    lis = "".join(f"<li>{_esc(b)}</li>" for b in items)
    return f'<ul class="slide-bullets">{lis}</ul>'


def _render_slide(spec: dict, index: int) -> str:
    """渲染一页 <section class="slide layout-xxx">（1280x720 固定画布，内容全部模板生成）。

    版式结构：
    - cover：深色主色整页背景 + 白色大标题居中 + 副标题（浅色）；
    - section：深色主色背景分隔页 + 大标题居中；ending：深色背景 + 结束语（title）；
    - title_content：白底 + 主色标题左上 + 深灰要点列表；
    - two_column：白底 + 标题 + 左右两列（bullets 左列、right_bullets 右列）；
    - quote：居中大引号 + 引用大字 + 作者小字；
    - data_callout：stat 超大字号（80px 主色）+ stat_label。
    """
    layout = str(spec.get("layout") or DEFAULT_LAYOUT)
    title = _esc(spec.get("title") or "")
    subtitle = _esc(spec.get("subtitle") or "")
    bullets = list(spec.get("bullets") or [])
    right_bullets = list(spec.get("right_bullets") or [])
    quote = _esc(spec.get("quote") or "")
    author = _esc(spec.get("author") or "")
    stat = _esc(spec.get("stat") or "")
    stat_label = _esc(spec.get("stat_label") or "")
    pagenum = f'<div class="page-num">{index}</div>'
    if layout == "cover":
        body = (
            (f'<div class="deck-cover-title">{title}</div>' if title else "")
            + (f'<div class="deck-cover-subtitle">{subtitle}</div>' if subtitle else "")
        )
    elif layout == "section":
        body = f'<div class="deck-section-title">{title}</div>' if title else ""
    elif layout == "title_content":
        body = (f'<div class="slide-title">{title}</div>' if title else "") + _bullets_html(bullets)
    elif layout == "two_column":
        body = (
            (f'<div class="slide-title">{title}</div>' if title else "")
            + '<div class="columns">'
            + f'<div class="column">{_bullets_html(bullets)}</div>'
            + f'<div class="column">{_bullets_html(right_bullets)}</div>'
            + "</div>"
        )
    elif layout == "quote":
        body = (
            '<div class="quote-mark">“</div>'
            + (f'<div class="quote-text">{quote}</div>' if quote else "")
            + (f'<div class="quote-author">— {author}</div>' if author else "")
        )
    elif layout == "data_callout":
        body = (
            (f'<div class="deck-stat">{stat}</div>' if stat else "")
            + (f'<div class="deck-stat-label">{stat_label}</div>' if stat_label else "")
        )
    else:  # ending
        body = f'<div class="deck-ending-title">{title}</div>' if title else ""
    return f'<section class="slide layout-{layout}">{body}{pagenum}</section>'


def _deck_css(theme: str) -> str:
    """内联 CSS：主题色经 THEMES 常量拼接（内部常量，无需转义）；--bg 为内容页白底。"""
    t = THEMES[theme]
    return f""":root {{
    --primary: #{t['primary']};
    --secondary: #{t['secondary']};
    --accent: #{t['accent']};
    --text: #{t['text']};
    --bg: #FFFFFF;
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: "Microsoft YaHei", "微软雅黑", sans-serif; background: #EDEDED; color: var(--text); }}
.slide {{
    width: {SLIDE_W}px;
    height: {SLIDE_H}px;
    margin: 24px auto;
    position: relative;
    overflow: hidden;
    background: var(--bg);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
    page-break-after: always;
}}
.slide-title {{
    position: absolute;
    top: {PAGE_MARGIN}px;
    left: {PAGE_MARGIN}px;
    right: {PAGE_MARGIN}px;
    font-size: {TITLE_FONT_SIZE}px;
    font-weight: bold;
    color: var(--primary);
}}
.slide-bullets {{
    position: absolute;
    top: 140px;
    left: {PAGE_MARGIN}px;
    right: {PAGE_MARGIN}px;
    list-style: disc;
    padding-left: 24px;
}}
.slide-bullets li {{ font-size: {BODY_FONT_SIZE}px; line-height: 1.7; color: var(--text); margin-bottom: 10px; }}
.columns {{ position: absolute; top: 140px; left: {PAGE_MARGIN}px; right: {PAGE_MARGIN}px; display: flex; gap: 40px; }}
.column {{ flex: 1; min-width: 0; }}
.column .slide-bullets {{ position: static; }}
/* 深色整页版式：cover / section / ending（不加装饰线、不加彩色条） */
.layout-cover, .layout-section, .layout-ending {{ background: var(--primary); }}
.layout-cover .deck-cover-title, .layout-section .deck-section-title, .layout-ending .deck-ending-title {{
    position: absolute;
    left: 80px;
    right: 80px;
    text-align: center;
    color: #FFFFFF;
    font-weight: bold;
}}
.layout-cover .deck-cover-title {{ top: 280px; font-size: 44px; }}
.layout-cover .deck-cover-subtitle {{ position: absolute; top: 380px; left: 80px; right: 80px; text-align: center; font-size: 20px; color: var(--secondary); }}
.layout-section .deck-section-title {{ top: 300px; font-size: {TITLE_FONT_SIZE}px; }}
.layout-ending .deck-ending-title {{ top: 300px; font-size: {TITLE_FONT_SIZE}px; }}
/* 引用页：居中大引号 + 引用大字 + 作者小字 */
.layout-quote .quote-mark {{ position: absolute; top: 130px; left: 80px; font-size: 120px; line-height: 1; color: var(--accent); font-family: Georgia, serif; }}
.layout-quote .quote-text {{ position: absolute; top: 250px; left: 80px; right: 80px; text-align: center; font-size: 30px; line-height: 1.6; color: var(--text); }}
.layout-quote .quote-author {{ position: absolute; top: 480px; left: 80px; right: 80px; text-align: center; font-size: {BODY_FONT_SIZE}px; color: #888888; }}
/* 数据大字页：stat 80px 主色 + stat_label 小字灰 */
.layout-data_callout .deck-stat {{ position: absolute; top: 220px; left: 80px; right: 80px; text-align: center; font-size: 80px; font-weight: bold; color: var(--primary); }}
.layout-data_callout .deck-stat-label {{ position: absolute; top: 410px; left: 80px; right: 80px; text-align: center; font-size: {BODY_FONT_SIZE}px; color: #888888; }}
.page-num {{ position: absolute; right: {PAGE_MARGIN}px; bottom: 24px; font-size: 14px; color: #AAAAAA; }}
"""


def _build_html(path: Path, args: dict, theme: str = DEFAULT_THEME) -> None:
    """生成自包含 HTML 网页版预览（单文件：内联 CSS + 每页固定 1280x720 <section>）。"""
    slides_html = "\n".join(_render_slide(s, i) for i, s in enumerate(args.get("slides") or [], start=1))
    first = next((s for s in (args.get("slides") or []) if isinstance(s, dict) and s.get("title")), None)
    doc_title = _esc((first or {}).get("title") or "演示文稿")
    html_text = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{doc_title}</title>
<style>
{_deck_css(theme)}
</style>
</head>
<body>
{slides_html}
</body>
</html>
"""
    path.write_text(html_text, encoding="utf-8")


# ---------- PPTX 可编辑演示文稿（python-pptx） ----------

def _set_pptx_style(tf, *, size: float, bold: bool, color: str, align) -> None:
    """设置 text frame 全部 run：微软雅黑 + 字号/加粗/颜色/对齐（同 make_office._set_pptx_text）。"""
    from pptx.dml.color import RGBColor
    from pptx.util import Pt

    for para in tf.paragraphs:
        para.alignment = align
        for run in para.runs:
            run.font.name = BODY_FONT
            run.font.size = Pt(size)
            run.font.bold = bold
            run.font.color.rgb = RGBColor.from_string(color)


def _add_bullets(slide, items: list, left, top, width, height, t: dict) -> None:
    """在 (left,top) 处添加要点文本框：14pt 微软雅黑，首条 accent 加粗，其余深灰。"""
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
    from pptx.util import Pt

    items = [str(b) for b in items if str(b).strip()]
    if not items:
        return
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    tf.text = ""
    for i, item in enumerate(items):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        run = para.add_run()
        run.text = item
        run.font.name = BODY_FONT
        run.font.size = Pt(14)
        run.font.bold = i == 0  # 首条要点 accent 加粗
        run.font.color.rgb = RGBColor.from_string(t["accent"] if i == 0 else t["text"])
        para.alignment = PP_ALIGN.LEFT


def _build_pptx(path: Path, args: dict, theme: str = DEFAULT_THEME) -> None:
    """python-pptx 生成 16:9 演示文稿（Blank 版式 + 文本框精确控制 7 种版式）：

    - cover/section/ending：primary 全页背景矩形置于底层 + 白色标题居中（cover 含浅色副标题）；
    - title_content：primary 32pt bold 标题 + 14pt 深灰要点（首条 accent 加粗）；
    - two_column：标题 + 左右两个文本框（左 bullets、右 right_bullets）；
    - quote：居中引用文字 24pt + 作者 14pt 灰；
    - data_callout：stat 60pt bold 主色 + stat_label 16pt 灰；
    - notes 写入 slide.notes_slide.notes_text_frame.text；字体统一微软雅黑；
    - 不画装饰条、标题下不加线。
    """
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import PP_ALIGN
    from pptx.util import Inches

    t = THEMES[theme]
    prs = Presentation()
    prs.slide_width = Inches(13.333)  # 16:9
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]  # Blank 版式：全部内容用文本框精确控制
    for spec in args.get("slides") or []:
        slide = prs.slides.add_slide(blank)
        layout = str(spec.get("layout") or DEFAULT_LAYOUT)
        title = str(spec.get("title") or "").strip()
        if layout in ("cover", "section", "ending"):
            # 全页主题色背景矩形（无边框、无阴影），置于底层
            bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
            bg.fill.solid()
            bg.fill.fore_color.rgb = RGBColor.from_string(t["primary"])
            bg.line.fill.background()
            bg.shadow.inherit = False
            sp_tree = slide.shapes._spTree
            sp_tree.remove(bg._element)
            sp_tree.insert(2, bg._element)  # grpSpPr 之后第一个 shape，即最底层
            if title:
                box = slide.shapes.add_textbox(Inches(1.0), Inches(3.0), Inches(11.333), Inches(1.2))
                tf = box.text_frame
                tf.word_wrap = True
                tf.text = title
                _set_pptx_style(tf, size=36, bold=True, color="FFFFFF", align=PP_ALIGN.CENTER)
            if layout == "cover" and spec.get("subtitle"):
                box = slide.shapes.add_textbox(Inches(1.0), Inches(4.4), Inches(11.333), Inches(0.9))
                tf = box.text_frame
                tf.word_wrap = True
                tf.text = str(spec.get("subtitle"))
                _set_pptx_style(tf, size=16, bold=False, color=t["secondary"], align=PP_ALIGN.CENTER)
        elif layout == "two_column":
            if title:
                box = slide.shapes.add_textbox(Inches(0.6), Inches(0.5), Inches(12.1), Inches(0.9))
                tf = box.text_frame
                tf.word_wrap = True
                tf.text = title
                _set_pptx_style(tf, size=32, bold=True, color=t["primary"], align=PP_ALIGN.LEFT)
            _add_bullets(slide, spec.get("bullets") or [], Inches(0.6), Inches(1.6), Inches(5.9), Inches(5.4), t)
            _add_bullets(slide, spec.get("right_bullets") or [], Inches(6.8), Inches(1.6), Inches(5.9), Inches(5.4), t)
        elif layout == "quote":
            quote = str(spec.get("quote") or "").strip()
            if quote:
                box = slide.shapes.add_textbox(Inches(1.0), Inches(2.6), Inches(11.333), Inches(1.8))
                tf = box.text_frame
                tf.word_wrap = True
                tf.text = quote
                _set_pptx_style(tf, size=24, bold=False, color=t["text"], align=PP_ALIGN.CENTER)
            author = str(spec.get("author") or "").strip()
            if author:
                box = slide.shapes.add_textbox(Inches(1.0), Inches(4.8), Inches(11.333), Inches(0.6))
                tf = box.text_frame
                tf.word_wrap = True
                tf.text = f"— {author}"
                _set_pptx_style(tf, size=14, bold=False, color="808080", align=PP_ALIGN.CENTER)
        elif layout == "data_callout":
            stat = str(spec.get("stat") or "").strip()
            if stat:
                box = slide.shapes.add_textbox(Inches(1.0), Inches(2.4), Inches(11.333), Inches(1.8))
                tf = box.text_frame
                tf.word_wrap = True
                tf.text = stat
                _set_pptx_style(tf, size=60, bold=True, color=t["primary"], align=PP_ALIGN.CENTER)
            stat_label = str(spec.get("stat_label") or "").strip()
            if stat_label:
                box = slide.shapes.add_textbox(Inches(1.0), Inches(4.6), Inches(11.333), Inches(0.6))
                tf = box.text_frame
                tf.word_wrap = True
                tf.text = stat_label
                _set_pptx_style(tf, size=16, bold=False, color="808080", align=PP_ALIGN.CENTER)
        else:  # title_content（默认版式）
            if title:
                box = slide.shapes.add_textbox(Inches(0.6), Inches(0.5), Inches(12.1), Inches(0.9))
                tf = box.text_frame
                tf.word_wrap = True
                tf.text = title
                _set_pptx_style(tf, size=32, bold=True, color=t["primary"], align=PP_ALIGN.LEFT)
            _add_bullets(slide, spec.get("bullets") or [], Inches(0.6), Inches(1.6), Inches(12.1), Inches(5.4), t)
        notes = str(spec.get("notes") or "").strip()
        if notes:
            slide.notes_slide.notes_text_frame.text = notes
    prs.save(path)


# ---------- 工具注册 ----------

@agent_tool(
    name="make_deck",
    description=(
        "生成高级演示文稿到用户工作区并自动发送：同时产出同名 .pptx（可编辑交付）与 .html"
        "（网页版预览，浏览器直接打开即可浏览）两份文件。用户需要精美、结构化的演示文稿"
        "（封面、章节分隔页、双栏对比、引用页、数据大字页、结束页等版式）时调用"
        "（如「做一份带封面和章节页的产品发布会 PPT」）。\n"
        "参数规范：\n"
        "1. filename（必填）：文件名，必须以 .pptx 结尾（相对工作区根目录的路径，父目录自动创建，"
        "同名文件会被覆盖）；网页版预览为同名 .html 自动生成；\n"
        "2. slides（必填）：幻灯片列表（1-30 页），每页是对象：layout（可选，版式：cover 封面 / "
        "section 章节分隔 / title_content 标题+要点（默认） / two_column 双栏对比 / quote 引用 / "
        "data_callout 数据大字 / ending 结束页）、title（可选，标题，≤100 字符）、subtitle（可选，"
        "封面副标题）、bullets（可选，要点数组，最多 8 条、每条≤100 字符）、right_bullets（可选，"
        "双栏右列要点）、quote（可选，引用文字，≤300 字符）、author（可选，引用作者）、stat（可选，"
        "大字指标数字/文字）、stat_label（可选，指标说明）、notes（可选，演讲者备注）；\n"
        "3. theme（可选）：主题风格，同 make_pptx（executive/minimal/fresh，默认 executive）。\n"
        "注意：全部文本总字符上限 100000，超限工具会报错，请精简内容；生成后工具会自动发送"
        "两个文件卡片（先 .pptx 后 .html），回复附一句说明即可，不要回显全部内容；简单 PPT"
        "（普通标题+要点页）用 make_pptx 即可，无需使用本工具。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "文件名，必须以 .pptx 结尾（相对工作区根目录，父目录自动创建）；同名 .html 网页版预览自动生成",
            },
            "slides": {
                "type": "array",
                "description": "幻灯片列表（1-30 页），每项含 layout/title/subtitle/bullets/right_bullets/quote/author/stat/stat_label/notes",
                "items": {
                    "type": "object",
                    "properties": {
                        "layout": {
                            "type": "string",
                            "enum": ["cover", "section", "title_content", "two_column", "quote", "data_callout", "ending"],
                            "description": "可选，版式：cover 封面 / section 章节分隔 / title_content 标题+要点（默认）/ two_column 双栏 / quote 引用 / data_callout 数据大字 / ending 结束页",
                        },
                        "title": {"type": "string", "description": "可选，标题（≤100 字符）"},
                        "subtitle": {"type": "string", "description": "可选，副标题（封面页）"},
                        "bullets": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "可选，要点列表（最多 8 条、每条≤100 字符）",
                        },
                        "right_bullets": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "可选，双栏版式右列要点（最多 8 条、每条≤100 字符）",
                        },
                        "quote": {"type": "string", "description": "可选，引用文字（≤300 字符）"},
                        "author": {"type": "string", "description": "可选，引用作者"},
                        "stat": {"type": ["string", "number"], "description": "可选，数据大字页的指标数字/文字"},
                        "stat_label": {"type": "string", "description": "可选，指标说明文字"},
                        "notes": {"type": "string", "description": "可选，演讲者备注"},
                    },
                    "required": [],
                },
            },
            "theme": {
                "type": "string",
                "enum": ["executive", "minimal", "fresh"],
                "description": "可选，主题风格：不传即默认专业主题（executive）；用户要求简约/清新风格时可传 minimal/fresh",
            },
        },
        "required": ["filename", "slides"],
    },
)
async def make_deck(args: dict, ctx: AgentContext) -> str:
    """生成高级演示文稿（.pptx + .html 双产物）到工作区并自动发送（共同行为见模块 docstring）。"""
    return await _run_deck(ctx, args)
