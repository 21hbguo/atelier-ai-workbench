"""make_office 系列工具（make_xlsx/make_docx/make_pptx）单元测试（tmp_path 沙箱）。

覆盖：套餐门控 / 登录校验 / 路径越界 / 扩展名错误 / 参数超限（sheets>10、rows 超限）/
parse_file 回读失败清理 / 大小超限清理 / 三个工具正常生成：写入工作区后分别用
openpyxl / python-docx / python-pptx 读回验证内容，且 ctx.files 入队 1 条
（filename/url/size/description 正确）、返回文本含「已生成并发送」。
测试模式与 test_send_file.py 一致：无 pytest-asyncio，用 asyncio.run 包装协程。
"""
import asyncio
import os
import shutil
import urllib.parse

import pytest
from docx import Document
from openpyxl import load_workbook
from pptx import Presentation
from pptx.enum.dml import MSO_FILL

from backend import config
from backend.services import document_parser
from backend.services.agent.context import AgentContext
from backend.services.agent.tools import make_office as mo
from backend.services.agent.tools.make_office import make_docx, make_pptx, make_xlsx


def _run(coro):
    return asyncio.run(coro)


def _ctx(user_id=123, file_write=True):
    features = {"file_write": True} if file_write else {}
    return AgentContext(
        session_id=1,
        user_id=user_id,
        extra={"entitlements": {"features": features}},
    )


@pytest.fixture
def ws(tmp_path, monkeypatch):
    """把用户工作区根目录重定向到 pytest tmp_path（workspace 动态读 config 属性）。"""
    monkeypatch.setattr(config, "USER_WORKSPACES_DIR", tmp_path)
    return tmp_path


def _root(ws, user_id=123):
    return ws / f"user_{user_id}"


# ---------- 公共门控 / 参数校验 ----------

def test_make_xlsx_requires_entitlement(ws):
    result = _run(make_xlsx({"filename": "a.xlsx", "sheets": [{"name": "S"}]}, _ctx(file_write=False)))
    assert result == "当前套餐不支持文件写入。"


def test_make_docx_requires_login(ws):
    result = _run(make_docx({"filename": "a.docx", "sections": [{"paragraphs": ["x"]}]}, _ctx(user_id=None)))
    assert result == "需要登录后才能使用文件工具"


def test_make_xlsx_empty_filename(ws):
    result = _run(make_xlsx({"filename": "   ", "sheets": [{"name": "S"}]}, _ctx()))
    assert "filename 不能为空" in result


def test_make_pptx_outside_rejected(ws):
    result = _run(make_pptx({"filename": "../a.pptx", "slides": [{"title": "T"}]}, _ctx()))
    assert "路径无效" in result
    assert "越界" in result


def test_make_xlsx_wrong_ext(ws):
    result = _run(make_xlsx({"filename": "a.docx", "sheets": [{"name": "S", "rows": [["x"]]}]}, _ctx()))
    assert result == "文件名必须以 .xlsx 结尾"


def test_make_docx_wrong_ext(ws):
    result = _run(make_docx({"filename": "a.xlsx", "sections": [{"paragraphs": ["x"]}]}, _ctx()))
    assert result == "文件名必须以 .docx 结尾"


def test_make_pptx_wrong_ext(ws):
    result = _run(make_pptx({"filename": "a.xls", "slides": [{"title": "T"}]}, _ctx()))
    assert result == "文件名必须以 .pptx 结尾"


# ---------- 参数超限 ----------

def test_make_xlsx_sheets_over_limit(ws):
    sheets = [{"name": f"S{i}", "rows": [["x"]]} for i in range(11)]
    result = _run(make_xlsx({"filename": "a.xlsx", "sheets": sheets}, _ctx()))
    assert "参数超限" in result
    assert "10" in result


def test_make_xlsx_rows_over_limit(ws):
    rows = [["x"] for _ in range(5001)]
    result = _run(make_xlsx({"filename": "a.xlsx", "sheets": [{"name": "S", "rows": rows}]}, _ctx()))
    assert "参数超限" in result
    assert "5000" in result


def test_make_docx_sections_over_limit(ws):
    sections = [{"paragraphs": ["x"]} for _ in range(51)]
    result = _run(make_docx({"filename": "a.docx", "sections": sections}, _ctx()))
    assert "参数超限" in result


def test_make_pptx_slides_over_limit(ws):
    slides = [{"title": f"P{i}"} for i in range(51)]
    result = _run(make_pptx({"filename": "a.pptx", "slides": slides}, _ctx()))
    assert "参数超限" in result


# ---------- 回读失败 / 大小超限：清理 ----------

def test_make_xlsx_parse_failure_cleans_up(ws, monkeypatch):
    def boom(path, ext):
        raise ValueError("模拟损坏：文件不可读")

    monkeypatch.setattr(document_parser, "parse_file", boom)
    ctx = _ctx()
    result = _run(make_xlsx({"filename": "a.xlsx", "sheets": [{"name": "S", "rows": [["x"]]}]}, ctx))
    assert "已清理" in result
    assert not (_root(ws) / "a.xlsx").exists()
    assert ctx.files == []


def test_make_docx_too_large_cleans_up(ws, monkeypatch):
    monkeypatch.setattr(mo, "MAX_SEND_BYTES", 10)  # 上限压到 10 bytes（docx 是 zip，远大于此）
    ctx = _ctx()
    result = _run(make_docx({"filename": "a.docx", "title": "T", "sections": [{"paragraphs": ["x"]}]}, ctx))
    assert "文件过大" in result
    assert not (_root(ws) / "a.docx").exists()
    assert ctx.files == []


# ---------- 正常生成：读回验证 + 入队 ctx.files ----------

def test_make_xlsx_success_enqueues(ws):
    ctx = _ctx()
    args = {
        "filename": "报表.xlsx",
        "sheets": [
            {"name": "销售", "header": ["月份", "金额"], "rows": [["一月", 100], ["二月", 200]]},
        ],
    }
    result = _run(make_xlsx(args, ctx))
    assert "已生成并发送【报表.xlsx】" in result
    assert "文件内容预览" in result
    assert len(ctx.files) == 1
    f = ctx.files[0]
    assert f["filename"] == "报表.xlsx"
    assert f["url"] == f"/api/workspace/files/download?path={urllib.parse.quote('报表.xlsx')}"
    assert f["size"] == os.path.getsize(_root(ws) / "报表.xlsx")
    assert "Excel 工作簿" in f["description"]
    # openpyxl 读回验证内容
    wb = load_workbook(_root(ws) / "报表.xlsx")
    sheet = wb["销售"]
    assert [c.value for c in sheet[1]] == ["月份", "金额"]
    assert [c.value for c in sheet[2]] == ["一月", 100]
    wb.close()


def test_make_docx_success_enqueues(ws):
    ctx = _ctx()
    args = {
        "filename": "report.docx",
        "title": "季度报告",
        "sections": [
            {
                "heading": "概述",
                "paragraphs": ["这是第一段", "这是第二段"],
                "bullets": ["要点A", "要点B"],
            },
            {"table": {"header": ["列1", "列2"], "rows": [["a", "b"]]}},
        ],
    }
    result = _run(make_docx(args, ctx))
    assert "已生成并发送【report.docx】" in result
    assert len(ctx.files) == 1
    f = ctx.files[0]
    assert f["filename"] == "report.docx"
    assert f["url"] == "/api/workspace/files/download?path=report.docx"
    assert f["size"] == os.path.getsize(_root(ws) / "report.docx")
    assert "Word 文档" in f["description"]
    # python-docx 读回验证内容
    doc = Document(str(_root(ws) / "report.docx"))
    paras = [p.text for p in doc.paragraphs]
    assert "季度报告" in paras
    assert "概述" in paras
    assert "这是第一段" in paras
    assert "要点A" in paras
    table = doc.tables[0]
    assert table.rows[0].cells[0].text == "列1"
    assert table.rows[1].cells[1].text == "b"


def test_make_pptx_success_enqueues(ws):
    ctx = _ctx()
    args = {
        "filename": "deck.pptx",
        "slides": [
            {"title": "封面", "layout": "title"},
            {"title": "内容页", "bullets": ["要点1", "要点2"], "notes": "演讲备注"},
        ],
    }
    result = _run(make_pptx(args, ctx))
    assert "已生成并发送【deck.pptx】" in result
    assert len(ctx.files) >= 1  # 本地有 soffice 时还会附 PDF 预览（共 2 条），无则 1 条
    f = ctx.files[0]
    assert f["filename"] == "deck.pptx"
    assert f["url"] == "/api/workspace/files/download?path=deck.pptx"
    assert f["size"] == os.path.getsize(_root(ws) / "deck.pptx")
    assert "PPT 演示文稿" in f["description"]
    if len(ctx.files) == 2:  # soffice 可用：第二条是 PDF 预览
        pdf = ctx.files[1]
        assert pdf["filename"] == "deck.pdf"
        assert pdf["description"] == "PPT 预览（PDF）"
    # python-pptx 读回验证内容
    prs = Presentation(str(_root(ws) / "deck.pptx"))
    assert len(prs.slides) == 2
    assert prs.slides[0].shapes.title.text == "封面"
    body = None
    for ph in prs.slides[1].placeholders:
        if ph.placeholder_format.idx == 1:  # 内容占位符
            body = ph
    assert body is not None
    assert [p.text for p in body.text_frame.paragraphs] == ["要点1", "要点2"]
    assert prs.slides[1].notes_slide.notes_text_frame.text == "演讲备注"


# ---------- PPT PDF 预览（soffice 转换，仅 make_pptx）----------

@pytest.mark.skipif(shutil.which("soffice") is None, reason="本机未安装 LibreOffice（soffice），跳过 PDF 预览用例")
def test_make_pptx_pdf_preview_generated(ws):
    """真实调用 soffice：转换成功 → PDF 落盘非空、ctx.files 先 .pptx 后 .pdf、返回文本含 PDF。"""
    ctx = _ctx()
    args = {
        "filename": "preview.pptx",
        "slides": [
            {"title": "封面", "layout": "title"},
            {"title": "内容页", "bullets": ["要点1", "要点2"]},
        ],
    }
    result = _run(make_pptx(args, ctx))
    assert "已生成并发送【preview.pptx】" in result
    assert "PDF" in result  # 转换成功时返回文本注明已附 PDF 预览版
    assert len(ctx.files) == 2  # 先 .pptx 后 .pdf
    pptx_f = ctx.files[0]
    assert pptx_f["filename"] == "preview.pptx"
    assert "可编辑" in pptx_f["description"]
    pdf_f = ctx.files[1]
    assert pdf_f["filename"] == "preview.pdf"
    assert pdf_f["description"] == "PPT 预览（PDF）"
    assert pdf_f["url"] == "/api/workspace/files/download?path=preview.pdf"
    pdf_file = _root(ws) / "preview.pdf"
    assert pdf_file.is_file()  # PDF 真实落盘
    assert pdf_file.stat().st_size > 0  # 非空
    assert pdf_f["size"] == pdf_file.stat().st_size


def test_make_pptx_pdf_fallback_when_soffice_missing(ws, monkeypatch):
    """soffice 不可用：正常降级，只发 .pptx，返回文本无 PDF 相关提示/错误。"""
    monkeypatch.setattr(shutil, "which", lambda name: None)  # 模拟 soffice 不存在
    ctx = _ctx()
    result = _run(make_pptx({"filename": "fallback.pptx", "slides": [{"title": "T"}]}, ctx))
    assert "已生成并发送【fallback.pptx】" in result
    assert "PDF" not in result  # 正常降级：不出现 PDF 相关提示/错误
    assert len(ctx.files) == 1  # 只发送 .pptx
    assert ctx.files[0]["filename"] == "fallback.pptx"
    assert not (_root(ws) / "fallback.pdf").exists()


# ---------- 默认美观模板（theme 主题） ----------

def test_make_xlsx_invalid_theme_rejected(ws):
    result = _run(make_xlsx(
        {"filename": "a.xlsx", "sheets": [{"name": "S"}], "theme": "rainbow"}, _ctx(),
    ))
    assert "theme 必须是" in result


def test_make_xlsx_theme_minimal_header_fill(ws):
    _run(make_xlsx(
        {"filename": "min.xlsx", "sheets": [{"name": "S", "header": ["列1"], "rows": [["a"]]}], "theme": "minimal"},
        _ctx(),
    ))
    wb = load_workbook(_root(ws) / "min.xlsx")
    cell = wb["S"]["A1"]
    assert cell.fill.patternType == "solid"
    # 颜色可能带 '00' alpha 前缀（argb），用 endswith 兼容
    assert str(cell.fill.start_color.rgb).endswith("36454F")
    wb.close()


def test_make_xlsx_default_theme_executive_header_fill(ws):
    _run(make_xlsx({"filename": "def.xlsx", "sheets": [{"name": "S", "header": ["列1"], "rows": [["a"]]}]}, _ctx()))
    wb = load_workbook(_root(ws) / "def.xlsx")
    cell = wb["S"]["A1"]
    assert cell.fill.patternType == "solid"
    assert str(cell.fill.start_color.rgb).endswith("1E2761")
    wb.close()


def test_make_xlsx_number_formats_inferred(ws):
    args = {
        "filename": "fmt.xlsx",
        "sheets": [{
            "name": "S",
            "header": ["数量", "单价", "增长率", "日期"],
            "rows": [[100, 12.5, 0.12, "2026-01-01"], [200, 8.25, 0.05, "2026-02-01"]],
        }],
    }
    _run(make_xlsx(args, _ctx()))
    wb = load_workbook(_root(ws) / "fmt.xlsx")
    sheet = wb["S"]
    assert "#,##0" in sheet["A2"].number_format  # int → 千分位
    assert "0.00" in sheet["B2"].number_format  # float → 千分位两位小数
    assert sheet["C2"].number_format == "0.0%"  # header 含“率” → 百分比
    assert sheet["D2"].number_format == "General"  # 日期字符串不动
    wb.close()


def test_make_docx_title_color_primary(ws):
    _run(make_docx({"filename": "t.docx", "title": "年度报告", "sections": [{"paragraphs": ["正文"]}]}, _ctx()))
    doc = Document(str(_root(ws) / "t.docx"))
    title_p = doc.paragraphs[0]
    assert title_p.text == "年度报告"
    assert title_p.runs and title_p.runs[0].font.color.rgb is not None
    assert str(title_p.runs[0].font.color.rgb).endswith("1E2761")


def test_make_pptx_cover_background_primary(ws):
    _run(make_pptx({"filename": "d.pptx", "slides": [{"title": "封面", "layout": "title"}]}, _ctx()))
    prs = Presentation(str(_root(ws) / "d.pptx"))
    slide = prs.slides[0]
    bg = slide.shapes[0]  # 背景矩形置于最底层，即第一个 shape
    assert bg.fill.type == MSO_FILL.SOLID
    assert str(bg.fill.fore_color.rgb).endswith("1E2761")


# ---------- 注册表 ----------

def test_make_tools_registered_in_registry():
    from backend.services.agent.registry import get_tool

    for name in ("make_xlsx", "make_docx", "make_pptx"):
        tool = get_tool(name)
        assert tool is not None
        assert "filename" in tool["parameters"]["required"]
