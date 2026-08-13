"""make_office 工具：生成 Office 文件（Excel/Word/PPT）到用户工作区并自动发送到聊天。

三个工具 make_xlsx / make_docx / make_pptx 行为一致：
1. 权限：套餐需含 file_write 特性，且用户已登录（与 file_ops_* / send_file 一致）；
2. 路径：filename 为相对工作区根目录的相对路径（resolve_workspace_path 校验越界），
   必须以对应扩展名结尾（大小写不敏感），父目录自动创建，同名文件直接覆盖；
3. 生成后用 document_parser.parse_file 回读自校验（损坏检测），失败则删除已写文件并报错；
4. 大小超过 50MB 时删除并报错；成功则经 ctx.add_file 入队，由 loop 以 file 事件
   增量推给前端（前端 FileCard 展示文件名/大小/说明，点击下载 /api/workspace/files/download）。
"""
from __future__ import annotations

import logging
import os
import urllib.parse
from pathlib import Path

from backend.services import document_parser
from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool
from backend.services.agent.tools.send_file import MAX_SEND_BYTES
from backend.services.agent.workspace import MAX_CONTENT_CHARS, resolve_workspace_path

logger = logging.getLogger(__name__)

# ---- 参数上限（防御模型传超大规模数据撑爆内存/事件循环，超限返回明确错误引导缩小规模）----
MAX_XLSX_SHEETS = 10
MAX_XLSX_ROWS_PER_SHEET = 5000
MAX_XLSX_COLS = 50
MAX_XLSX_CELLS = 100_000  # 整个工作簿 header+rows 累计
MAX_DOCX_SECTIONS = 50
MAX_DOCX_CHARS = MAX_CONTENT_CHARS  # 对齐 workspace.MAX_CONTENT_CHARS = 200000
MAX_PPTX_SLIDES = 50
MAX_PPTX_BULLETS_PER_SLIDE = 20
MAX_PPTX_BULLET_CHARS = 500

# ---- 默认美观模板：THEMES 主题驱动（参考 Claude office skills 样式规范）----
# 每套主题字段：primary 主色（表头/标题/封面背景）、secondary 辅助色、accent 强调色、
# text 正文色、stripe 斑马纹浅色、border 边框色；正文中文字体统一微软雅黑。
THEMES = {
    # 默认主题：Midnight Executive（深藏青 + 冰蓝 + 珊瑚）
    "executive": {
        "primary": "1E2761",
        "secondary": "CADCFC",
        "accent": "F96167",
        "text": "333333",
        "stripe": "F2F6FC",
        "border": "D9D9D9",
    },
    # Charcoal Minimal（炭黑 + 浅灰）
    "minimal": {
        "primary": "36454F",
        "secondary": "F2F2F2",
        "accent": "212121",
        "text": "333333",
        "stripe": "F5F5F5",
        "border": "D0D0D0",
    },
    # Teal Trust（青绿清新）
    "fresh": {
        "primary": "028090",
        "secondary": "00A896",
        "accent": "02C39A",
        "text": "333333",
        "stripe": "E8F6F6",
        "border": "CCE3E6",
    },
}
DEFAULT_THEME = "executive"
BODY_FONT = "微软雅黑"


def _validate_theme(args: dict) -> str | None:
    """theme 必须是 THEMES 三套之一；不传则用默认主题 executive。"""
    theme = args.get("theme")
    if theme is not None and theme not in THEMES:
        return "theme 必须是 executive/minimal/fresh 之一"
    return None


def _has_file_write(ctx) -> bool:
    extra = getattr(ctx, "extra", None) or {}
    return bool(extra.get("entitlements", {}).get("features", {}).get("file_write"))


def _user_id_or_none(ctx) -> int | None:
    return getattr(ctx, "user_id", None)


def _cleanup(path: Path) -> None:
    """删除已写文件（失败仅记 warning，不阻断错误返回）。"""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("[make_office] 清理失败: %s", path)


async def _run_make(ctx, args, *, tool_label: str, ext: str, validate, build, describe) -> str:
    """三个 Office 工具的公共执行骨架：权限/登录 → 路径 → 参数校验 → 生成 → 回读 → 发送。"""
    if not _has_file_write(ctx):
        return "当前套餐不支持文件写入。"
    user_id = _user_id_or_none(ctx)
    if user_id is None:
        return "需要登录后才能使用文件工具"
    filename = str(args.get("filename") or "").strip()
    if not filename:
        return f"{tool_label} 参数错误：filename 不能为空，请提供以 .{ext} 结尾的文件名。"
    if not filename.lower().endswith(f".{ext}"):
        return f"文件名必须以 .{ext} 结尾"
    try:
        path = resolve_workspace_path(user_id, filename)
    except ValueError as exc:
        logger.warning("[make_office] %s 路径无效: %s", tool_label, exc)
        return f"路径无效：{exc}"
    err = validate(args)
    if err:
        return err
    path.parent.mkdir(parents=True, exist_ok=True)
    theme = args.get("theme") or DEFAULT_THEME
    try:
        build(path, args, theme)  # 生成（同名文件直接覆盖）
    except Exception as exc:
        logger.exception("[make_office] %s 生成失败", tool_label)
        _cleanup(path)  # 清掉可能写了一半的文件
        return f"生成失败：{exc}"
    # 回读自校验（损坏检测）：解析失败说明文件不可用，删除并报错
    try:
        text = document_parser.parse_file(str(path), ext)
    except ValueError as exc:
        logger.warning("[make_office] %s 回读校验失败: %s", tool_label, exc)
        _cleanup(path)
        return f"生成失败，已清理：{exc}"
    preview = text[:500]
    try:
        size = os.path.getsize(path)
    except OSError as exc:
        logger.warning("[make_office] %s 无法访问 %s: %s", tool_label, filename, exc)
        return "读取文件失败"
    if size > MAX_SEND_BYTES:
        _cleanup(path)
        return f"文件过大（>{MAX_SEND_BYTES // (1024 * 1024)}MB），无法发送，请先精简文件内容"
    # quote 默认不编码 "/"，正好保留相对路径层级（如 docs/报表.xlsx）
    url = f"/api/workspace/files/download?path={urllib.parse.quote(filename)}"
    ctx.add_file(filename=path.name, url=url, size=size, description=describe(args))
    logger.info("[make_office] %s 已生成并发送 %s（%d bytes）", tool_label, filename, size)
    return f"已生成并发送【{path.name}】（{size} 字节），用户可在聊天中下载。\n文件内容预览：\n{preview}"


# ---------- make_xlsx ----------

def _validate_xlsx_args(args: dict) -> str | None:
    """参数校验：结构 + 上限（sheets≤10、每表 rows≤5000、列≤50、总单元格≤100000）。"""
    err = _validate_theme(args)
    if err:
        return err
    sheets = args.get("sheets")
    if not isinstance(sheets, list) or not sheets:
        return "make_xlsx 参数错误：sheets 不能为空，请提供 1-10 个工作表。"
    if len(sheets) > MAX_XLSX_SHEETS:
        return f"参数超限：工作表最多 {MAX_XLSX_SHEETS} 个（当前 {len(sheets)} 个），请精简后重试。"
    total_cells = 0
    for i, sheet in enumerate(sheets):
        if not isinstance(sheet, dict):
            return f"make_xlsx 参数错误：第 {i + 1} 个工作表必须是对象（含 name/header/rows/column_widths）。"
        header = sheet.get("header") or []
        rows = sheet.get("rows") or []
        if not isinstance(header, list) or not isinstance(rows, list):
            return f"make_xlsx 参数错误：第 {i + 1} 个工作表的 header/rows 必须是数组。"
        if len(rows) > MAX_XLSX_ROWS_PER_SHEET:
            return f"参数超限：第 {i + 1} 个工作表 {len(rows)} 行超过上限 {MAX_XLSX_ROWS_PER_SHEET} 行，请精简数据后重试。"
        ncols = len(header)
        for r in rows:
            if not isinstance(r, list):
                return f"make_xlsx 参数错误：第 {i + 1} 个工作表的 rows 必须是数组的数组（每行是单元格数组）。"
            ncols = max(ncols, len(r))
        if ncols > MAX_XLSX_COLS:
            return f"参数超限：第 {i + 1} 个工作表 {ncols} 列超过上限 {MAX_XLSX_COLS} 列，请精简列数后重试。"
        total_cells += len(header) + sum(len(r) for r in rows)
        if total_cells > MAX_XLSX_CELLS:
            return f"参数超限：工作簿总单元格数超过上限 {MAX_XLSX_CELLS}，请精简数据规模后重试。"
    return None


def _infer_number_format(header: list, col_idx: int, value) -> str | None:
    """按单元格值类型推断数字格式；拿不准时只对 int/float 应用千分位。

    int → 千分位（零显示 -）；float → 千分位两位小数（零显示 -）；
    百分比列（header 含 % 或“率”，值为 float）→ 0.0%（值按分数存，如 0.12）；
    货币列（header 含 价格/金额/费用/收入/成本/¥/$/元）→ ¥#,##0.00；
    日期字符串等其他类型不动。
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, int):
        return "#,##0;-#,##0;-"
    col_name = str(header[col_idx - 1]) if col_idx - 1 < len(header) else ""
    if "%" in col_name or "率" in col_name:
        return "0.0%"
    if any(k in col_name for k in ("价格", "金额", "费用", "收入", "成本", "¥", "$", "元")):
        return "¥#,##0.00"
    return "#,##0.00;-#,##0.00;-"


def _estimate_column_width(values: list) -> float:
    """按内容估算列宽：str 长度按中文字符×2 计，取最宽值 + 2，上限 40。"""
    max_width = 8.0
    for v in values:
        if v is None:
            continue
        if isinstance(v, bool):
            width = 5.0
        elif isinstance(v, (int, float)):
            width = float(len(str(v)))
        else:
            width = float(sum(2 if ord(ch) > 127 else 1 for ch in str(v)))
        max_width = max(max_width, width)
    return min(max_width + 2, 40)


def _build_xlsx(path: Path, args: dict, theme: str = DEFAULT_THEME) -> None:
    """openpyxl 生成工作簿：主题表头（primary 填充 + 白色加粗居中）+ 全表细边框 +
    偶数行斑马纹 + 数字格式推断 + 冻结首行 + 列宽（column_widths 优先，否则按内容估算）。"""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    t = THEMES[theme]
    header_font = Font(name=BODY_FONT, size=11, bold=True, color="FFFFFF")
    data_font = Font(name=BODY_FONT, size=11, color=t["text"])
    header_fill = PatternFill("solid", fgColor=t["primary"])
    stripe_fill = PatternFill("solid", fgColor=t["stripe"])
    header_align = Alignment(horizontal="center", vertical="center")
    thin_side = Side(style="thin", color=t["border"])
    thin_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    wb = Workbook()
    wb.remove(wb.active)  # 移除默认空 sheet，统一按参数创建
    for i, sheet in enumerate(args.get("sheets") or []):
        name = str(sheet.get("name") or f"Sheet{i + 1}").strip() or f"Sheet{i + 1}"
        # sheet 名唯一化（openpyxl 不允许重名）：重名时追加序号，超长截断到 31 字符
        base = name[:28]
        candidate = name
        seq = 1
        while candidate in wb.sheetnames:
            candidate = f"{base}_{seq}"[:31]
            seq += 1
        name = candidate
        ws = wb.create_sheet(title=name)
        header = sheet.get("header") or []
        rows = sheet.get("rows") or []
        if header:
            ws.append(list(header))
            for cell in ws[1]:
                cell.font = header_font
                cell.fill = header_fill
                cell.alignment = header_align
                cell.border = thin_border
            ws.freeze_panes = "A2"  # 冻结首行
        for r_idx, row in enumerate(rows, start=2):  # 数据从第 2 行起
            ws.append(list(row))  # 数值保持数字类型，字符串原样写入
            stripe = r_idx % 2 == 0  # 偶数行斑马纹（浅色填充，不影响数字格式）
            for c_idx, value in enumerate(row, start=1):
                cell = ws.cell(row=r_idx, column=c_idx)
                cell.font = data_font
                cell.border = thin_border
                if stripe:
                    cell.fill = stripe_fill
                fmt = _infer_number_format(header, c_idx, value)
                if fmt is not None:
                    cell.number_format = fmt
        # 列宽：column_widths 优先，否则按内容估算（中文字符×2，上限 40）
        column_widths = sheet.get("column_widths") or []
        if column_widths:
            for col_idx, width in enumerate(column_widths, start=1):
                ws.column_dimensions[get_column_letter(col_idx)].width = float(width)
        else:
            ncols = len(header)
            for row in rows:
                ncols = max(ncols, len(row))
            for col_idx in range(1, ncols + 1):
                values = []
                if col_idx - 1 < len(header):
                    values.append(header[col_idx - 1])
                for row in rows:
                    if col_idx - 1 < len(row):
                        values.append(row[col_idx - 1])
                ws.column_dimensions[get_column_letter(col_idx)].width = _estimate_column_width(values)
    wb.save(path)


def _xlsx_description(args: dict) -> str:
    names = [str(s.get("name") or f"Sheet{i + 1}") for i, s in enumerate(args.get("sheets") or [])]
    shown = "、".join(names[:3])
    if len(names) > 3:
        shown += f" 等 {len(names)} 个工作表"
    return f"Excel 工作簿：{shown}"


# ---------- make_docx ----------

def _validate_docx_args(args: dict) -> str | None:
    """参数校验：结构 + 上限（sections≤50、全部文本总字符≤200000）。"""
    err = _validate_theme(args)
    if err:
        return err
    sections = args.get("sections")
    if not isinstance(sections, list) or not sections:
        return "make_docx 参数错误：sections 不能为空，请提供至少一个章节。"
    if len(sections) > MAX_DOCX_SECTIONS:
        return f"参数超限：章节最多 {MAX_DOCX_SECTIONS} 个（当前 {len(sections)} 个），请精简后重试。"
    total = len(str(args.get("title") or ""))
    for i, sec in enumerate(sections):
        if not isinstance(sec, dict):
            return f"make_docx 参数错误：第 {i + 1} 个章节必须是对象（含 heading/paragraphs/bullets/table）。"
        for key in ("heading", "paragraphs", "bullets"):
            val = sec.get(key)
            if val is None:
                continue
            if key in ("paragraphs", "bullets"):
                if not isinstance(val, list):
                    return f"make_docx 参数错误：第 {i + 1} 个章节的 {key} 必须是字符串数组。"
                total += sum(len(str(x)) for x in val)
            else:
                total += len(str(val))
        table = sec.get("table")
        if table is not None:
            if not isinstance(table, dict):
                return f"make_docx 参数错误：第 {i + 1} 个章节的 table 必须是对象（含 header/rows）。"
            rows = table.get("rows") or []
            if not isinstance(rows, list):
                return f"make_docx 参数错误：第 {i + 1} 个章节的 table.rows 必须是数组的数组。"
            for row in rows:
                if not isinstance(row, list):
                    return f"make_docx 参数错误：第 {i + 1} 个章节的 table.rows 必须是数组的数组。"
                total += sum(len(str(x)) for x in row)
            total += sum(len(str(x)) for x in (table.get("header") or []))
        if total > MAX_DOCX_CHARS:
            return f"参数超限：文档总字符数超过上限 {MAX_DOCX_CHARS}，请精简内容后重试。"
    return None


def _set_run_style(run, *, size: float = 11, bold: bool = False, color: str = "333333") -> None:
    """统一设置 run 样式：微软雅黑（含 w:eastAsia 中文字体）+ 字号/加粗/颜色。"""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Pt, RGBColor

    run.font.name = BODY_FONT  # 设置 w:ascii / w:hAnsi
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)
    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.find(qn("w:rFonts"))
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.append(r_fonts)
    r_fonts.set(qn("w:eastAsia"), BODY_FONT)  # 中文字体


def _shade_cell(cell, fill_hex: str) -> None:
    """给表格单元格加主题色底纹（w:shd fill）。"""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill_hex)
    tc_pr.append(shd)


def _build_docx(path: Path, args: dict, theme: str = DEFAULT_THEME) -> None:
    """python-docx 生成文档：title 用 Heading 0（primary 20pt bold）、章节 heading 用
    Heading 1（primary 16pt bold）、正文深灰 11pt 行距 1.3 段后 6pt、要点同正文、
    表格保留 Table Grid 边框且表头加 primary 底纹 + 白色加粗文字。"""
    from docx import Document
    from docx.shared import Pt

    t = THEMES[theme]
    doc = Document()
    title = str(args.get("title") or "").strip()
    if title:
        p = doc.add_heading(title, level=0)
        for run in p.runs:
            _set_run_style(run, size=20, bold=True, color=t["primary"])
    for sec in args.get("sections") or []:
        heading = str(sec.get("heading") or "").strip()
        if heading:
            p = doc.add_heading(heading, level=1)
            for run in p.runs:
                _set_run_style(run, size=16, bold=True, color=t["primary"])
        for para in sec.get("paragraphs") or []:
            p = doc.add_paragraph(str(para))
            for run in p.runs:
                _set_run_style(run, size=11, bold=False, color=t["text"])
            pf = p.paragraph_format
            pf.line_spacing = 1.3
            pf.space_after = Pt(6)
        for bullet in sec.get("bullets") or []:
            p = doc.add_paragraph(str(bullet), style="List Bullet")
            for run in p.runs:
                _set_run_style(run, size=11, bold=False, color=t["text"])
            p.paragraph_format.line_spacing = 1.3
        table = sec.get("table")
        if table:
            header = table.get("header") or []
            rows = table.get("rows") or []
            ncols = len(header)
            for row in rows:
                ncols = max(ncols, len(row))
            if ncols:
                tbl = doc.add_table(rows=1 + len(rows), cols=ncols)
                tbl.style = "Table Grid"  # 保留边框
                for j, h in enumerate(header):
                    cell = tbl.rows[0].cells[j]
                    cell.text = str(h)
                    _shade_cell(cell, t["primary"])
                    for run in cell.paragraphs[0].runs:
                        _set_run_style(run, size=11, bold=True, color="FFFFFF")
                for i, row in enumerate(rows, start=1):
                    for j, cell_val in enumerate(row[:ncols]):
                        cell = tbl.rows[i].cells[j]
                        cell.text = str(cell_val)
                        for run in cell.paragraphs[0].runs:
                            _set_run_style(run, size=11, bold=False, color=t["text"])
    doc.save(path)


def _docx_description(args: dict) -> str:
    title = str(args.get("title") or "").strip()
    return f"Word 文档：{title}" if title else "Word 文档"


# ---------- make_pptx ----------

def _validate_pptx_args(args: dict) -> str | None:
    """参数校验：结构 + 上限（slides≤50、每页 bullets≤20、每条≤500 字符）。"""
    err = _validate_theme(args)
    if err:
        return err
    slides = args.get("slides")
    if not isinstance(slides, list) or not slides:
        return "make_pptx 参数错误：slides 不能为空，请提供至少一页幻灯片。"
    if len(slides) > MAX_PPTX_SLIDES:
        return f"参数超限：幻灯片最多 {MAX_PPTX_SLIDES} 页（当前 {len(slides)} 页），请精简后重试。"
    for i, slide in enumerate(slides):
        if not isinstance(slide, dict):
            return f"make_pptx 参数错误：第 {i + 1} 页幻灯片必须是对象（含 title/layout/bullets/notes）。"
        layout = slide.get("layout")
        if layout is not None and layout not in ("title", "title_content"):
            return "make_pptx 参数错误：layout 必须是 title 或 title_content 之一。"
        bullets = slide.get("bullets") or []
        if not isinstance(bullets, list):
            return f"make_pptx 参数错误：第 {i + 1} 页幻灯片的 bullets 必须是字符串数组。"
        if len(bullets) > MAX_PPTX_BULLETS_PER_SLIDE:
            return f"参数超限：第 {i + 1} 页幻灯片要点最多 {MAX_PPTX_BULLETS_PER_SLIDE} 条（当前 {len(bullets)} 条），请精简后重试。"
        for b in bullets:
            if len(str(b)) > MAX_PPTX_BULLET_CHARS:
                return f"参数超限：单条要点最多 {MAX_PPTX_BULLET_CHARS} 字符，请精简后重试。"
    return None


def _set_pptx_text(tf, *, size: float, bold: bool, color: str, align) -> None:
    """设置 text frame 全部 run：微软雅黑 + 字号/加粗/颜色/对齐。"""
    from pptx.dml.color import RGBColor
    from pptx.util import Pt

    for para in tf.paragraphs:
        para.alignment = align
        for run in para.runs:
            run.font.name = BODY_FONT
            run.font.size = Pt(size)
            run.font.bold = bold
            run.font.color.rgb = RGBColor.from_string(color)


def _build_pptx(path: Path, args: dict, theme: str = DEFAULT_THEME) -> None:
    """python-pptx 生成演示文稿：封面页（layout=title）primary 全页背景矩形置于底层 +
    白色 36pt 大标题居中；内容页（title_content）白底 + primary 32pt bold 左对齐标题 +
    14pt 深灰要点（首条 accent 色加粗）；不画装饰条、标题下不加线；notes 原样保留。"""
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import PP_ALIGN
    from pptx.util import Pt

    t = THEMES[theme]
    prs = Presentation()
    slide_w, slide_h = prs.slide_width, prs.slide_height
    for slide_spec in args.get("slides") or []:
        layout_name = str(slide_spec.get("layout") or "title_content")
        layout = prs.slide_layouts[0 if layout_name == "title" else 1]
        slide = prs.slides.add_slide(layout)
        title = str(slide_spec.get("title") or "").strip()
        if layout_name == "title":
            # 封面：覆盖全页的 primary 背景矩形（无边框、无阴影），置于底层
            bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, slide_w, slide_h)
            bg.fill.solid()
            bg.fill.fore_color.rgb = RGBColor.from_string(t["primary"])
            bg.line.fill.background()
            bg.shadow.inherit = False
            sp_tree = slide.shapes._spTree
            sp_tree.remove(bg._element)
            sp_tree.insert(2, bg._element)  # grpSpPr 之后第一个 shape，即最底层
            if title and slide.shapes.title is not None:
                slide.shapes.title.text = title
                _set_pptx_text(slide.shapes.title.text_frame, size=36, bold=True, color="FFFFFF", align=PP_ALIGN.CENTER)
        else:
            if title and slide.shapes.title is not None:
                slide.shapes.title.text = title
                _set_pptx_text(slide.shapes.title.text_frame, size=32, bold=True, color=t["primary"], align=PP_ALIGN.LEFT)
            bullets = slide_spec.get("bullets") or []
            if bullets:
                body = None
                for ph in slide.placeholders:
                    if ph.placeholder_format.idx == 1:  # 内容占位符
                        body = ph
                        break
                if body is not None:
                    tf = body.text_frame
                    tf.text = ""
                    for i, b in enumerate(bullets):
                        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                        para.text = str(b)
                    for i, para in enumerate(tf.paragraphs):
                        para.alignment = PP_ALIGN.LEFT
                        for run in para.runs:
                            run.font.name = BODY_FONT
                            run.font.size = Pt(14)
                            run.font.bold = i == 0  # 首条要点 accent 加粗
                            run.font.color.rgb = RGBColor.from_string(t["accent"] if i == 0 else t["text"])
        notes = str(slide_spec.get("notes") or "").strip()
        if notes:
            slide.notes_slide.notes_text_frame.text = notes
    prs.save(path)


def _pptx_description(args: dict) -> str:
    slides = args.get("slides") or []
    titles = [str(s.get("title") or "").strip() for s in slides if isinstance(s, dict)]
    titles = [t for t in titles if t]
    shown = "、".join(titles[:3])
    if len(titles) > 3:
        shown += " 等"
    if shown:
        return f"PPT 演示文稿：{shown}"
    return f"PPT 演示文稿（共 {len(slides)} 页）"


# ---------- 工具注册 ----------

@agent_tool(
    name="make_xlsx",
    description=(
        "生成 Excel 工作簿（.xlsx）到用户工作区并自动发送到聊天供用户下载：用户需要表格、"
        "数据报表、统计清单等 Excel 文件时调用（如「生成一份销售报表」「把这份数据做成表格文件」）。\n"
        "参数规范：\n"
        "1. filename（必填）：文件名，必须以 .xlsx 结尾（相对工作区根目录的路径，父目录自动创建，"
        "同名文件会被覆盖）；\n"
        "2. sheets（必填）：工作表列表（1-10 个），每个工作表是对象：name（表名，最长 31 字符，"
        "超长自动截断）、header（可选，表头行，加粗并冻结首行）、rows（可选，数据行，rows 必须是"
        "数组的数组，每行是字符串或数字的单元格数组；单表最多 5000 行、50 列）、column_widths"
        "（可选，各列宽度）。\n"
        "3. theme（可选）：主题风格，不传即默认专业主题（executive 深藏青）；用户要求简约风格可传 "
        "minimal（炭黑），清新风格可传 fresh（青绿）。\n"
        "注意：整个工作簿单元格总数（header+rows）上限 100000，超限工具会报错，请精简数据规模；"
        "生成后工具会自动发送文件卡片，回复附一句说明即可，不要回显全部内容。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "文件名，必须以 .xlsx 结尾（相对工作区根目录，父目录自动创建）",
            },
            "sheets": {
                "type": "array",
                "description": "工作表列表（1-10 个），每项含 name/header/rows/column_widths",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "工作表名称，最长 31 字符，超长自动截断"},
                        "header": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "可选，表头行（加粗并冻结首行）",
                        },
                        "rows": {
                            "type": "array",
                            "items": {
                                "type": "array",
                                "description": "一行单元格值（字符串或数字）",
                            },
                            "description": "可选，数据行：rows 必须是数组的数组，每行是字符串/数字单元格数组（单表最多 5000 行、50 列）",
                        },
                        "column_widths": {
                            "type": "array",
                            "items": {"type": "number"},
                            "description": "可选，各列宽度（数字，单位字符宽度）",
                        },
                    },
                    "required": ["name"],
                },
            },
            "theme": {
                "type": "string",
                "enum": ["executive", "minimal", "fresh"],
                "description": "可选，主题风格：不传即默认专业主题（executive）；用户要求简约/清新风格时可传 minimal/fresh",
            },
        },
        "required": ["filename", "sheets"],
    },
)
async def make_xlsx(args: dict, ctx: AgentContext) -> str:
    """生成 Excel 工作簿到工作区并自动发送到聊天（共同行为见模块 docstring）。"""
    return await _run_make(
        ctx, args,
        tool_label="make_xlsx", ext="xlsx",
        validate=_validate_xlsx_args, build=_build_xlsx, describe=_xlsx_description,
    )


@agent_tool(
    name="make_docx",
    description=(
        "生成 Word 文档（.docx）到用户工作区并自动发送到聊天供用户下载：用户需要 Word 格式的"
        "文档、简历、合同、报告等文件时调用（如「帮我写一份简历」「生成一份产品说明文档」）。\n"
        "参数规范：\n"
        "1. filename（必填）：文件名，必须以 .docx 结尾（相对工作区根目录的路径，父目录自动创建，"
        "同名文件会被覆盖）；\n"
        "2. title（可选）：文档大标题；\n"
        "3. sections（必填）：章节列表（1-50 个），每章是对象：heading（可选，章节标题）、"
        "paragraphs（可选，段落数组）、bullets（可选，要点数组）、table（可选，表格：header 表头"
        "数组 + rows 数据行数组）。\n"
        "4. theme（可选）：主题风格，不传即默认专业主题（executive 深藏青）；用户要求简约风格传 "
        "minimal，清新风格传 fresh。\n"
        "注意：全文档文本总字符上限 200000，超限工具会报错，请精简内容；生成后工具会自动发送"
        "文件卡片，回复附一句说明即可，不要回显全部内容。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "文件名，必须以 .docx 结尾（相对工作区根目录，父目录自动创建）",
            },
            "title": {"type": "string", "description": "可选，文档大标题"},
            "sections": {
                "type": "array",
                "description": "章节列表（1-50 个），每项含 heading/paragraphs/bullets/table",
                "items": {
                    "type": "object",
                    "properties": {
                        "heading": {"type": "string", "description": "可选，章节标题"},
                        "paragraphs": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "可选，段落数组",
                        },
                        "bullets": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "可选，要点数组（项目符号列表）",
                        },
                        "table": {
                            "type": "object",
                            "properties": {
                                "header": {"type": "array", "items": {"type": "string"}, "description": "表头行"},
                                "rows": {
                                    "type": "array",
                                    "items": {"type": "array", "items": {"type": "string"}},
                                    "description": "数据行（数组的数组）",
                                },
                            },
                            "description": "可选，表格（带边框）",
                        },
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
        "required": ["filename", "sections"],
    },
)
async def make_docx(args: dict, ctx: AgentContext) -> str:
    """生成 Word 文档到工作区并自动发送到聊天（共同行为见模块 docstring）。"""
    return await _run_make(
        ctx, args,
        tool_label="make_docx", ext="docx",
        validate=_validate_docx_args, build=_build_docx, describe=_docx_description,
    )


@agent_tool(
    name="make_pptx",
    description=(
        "生成 PPT 演示文稿（.pptx）到用户工作区并自动发送到聊天供用户下载：用户需要演示文稿、"
        "PPT、幻灯片时调用（如「把这份大纲做成 PPT」「做一份产品介绍演示文稿」）。\n"
        "参数规范：\n"
        "1. filename（必填）：文件名，必须以 .pptx 结尾（相对工作区根目录的路径，父目录自动创建，"
        "同名文件会被覆盖）；\n"
        "2. slides（必填）：幻灯片列表（1-50 页），每页是对象：title（可选，标题）、layout（可选，"
        "title 仅标题版式 / title_content 标题+内容版式，默认 title_content）、bullets（可选，要点"
        "数组，最多 20 条、每条最多 500 字符，写入内容占位符）、notes（可选，演讲者备注）。\n"
        "3. theme（可选）：主题风格，不传即默认专业主题（executive 深藏青）；用户要求简约风格传 "
        "minimal，清新风格传 fresh。\n"
        "注意：生成后工具会自动发送文件卡片，回复附一句说明即可，不要回显全部内容。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "文件名，必须以 .pptx 结尾（相对工作区根目录，父目录自动创建）",
            },
            "slides": {
                "type": "array",
                "description": "幻灯片列表（1-50 页），每项含 title/layout/bullets/notes",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "可选，幻灯片标题"},
                        "layout": {
                            "type": "string",
                            "enum": ["title", "title_content"],
                            "description": "可选，版式：title 仅标题 / title_content 标题+内容占位符（默认）",
                        },
                        "bullets": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "可选，要点列表（最多 20 条、每条最多 500 字符），写入内容占位符",
                        },
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
async def make_pptx(args: dict, ctx: AgentContext) -> str:
    """生成 PPT 演示文稿到工作区并自动发送到聊天（共同行为见模块 docstring）。"""
    return await _run_make(
        ctx, args,
        tool_label="make_pptx", ext="pptx",
        validate=_validate_pptx_args, build=_build_pptx, describe=_pptx_description,
    )
