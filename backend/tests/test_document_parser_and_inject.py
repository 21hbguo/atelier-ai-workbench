"""文档解析与聊天文档注入的单元测试（不依赖数据库/网络）。"""
import io
import os

import pytest

from backend.services.document_parser import parse_file
from backend.services.agent.parser import safe_parse_arguments
from backend.services.chat_service import ChatService


# ---------- document_parser ----------

def test_parse_txt_removes_bom():
    p = "/tmp/_test_bom.txt"
    with open(p, "wb") as f:
        f.write(b"\xef\xbb\xbfhello \xe4\xb8\xad\xe6\x96\x87")
    try:
        assert parse_file(p, "txt") == "hello 中文"
    finally:
        os.unlink(p)


def test_parse_csv():
    p = "/tmp/_test.csv"
    with open(p, "w", encoding="utf-8") as f:
        f.write("a,b\n1,2\n")
    try:
        assert "a,b" in parse_file(p, "csv")
    finally:
        os.unlink(p)


def test_parse_markdown():
    p = "/tmp/_test.md"
    with open(p, "w", encoding="utf-8") as f:
        f.write("# 标题\n\n正文 **加粗** 内容")
    try:
        text = parse_file(p, "md")
        assert "# 标题" in text and "加粗" in text
    finally:
        os.unlink(p)


def test_parse_json():
    p = "/tmp/_test.json"
    with open(p, "w", encoding="utf-8") as f:
        f.write('{"name": "测试", "items": [1, 2]}')
    try:
        text = parse_file(p, "json")
        assert "测试" in text
    finally:
        os.unlink(p)


def test_parse_pptx():
    from pptx import Presentation
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    tb = slide.shapes.add_textbox(0, 0, 100, 50)
    tb.text_frame.text = "PPT 正文内容"
    p = "/tmp/_test.pptx"
    prs.save(p)
    try:
        text = parse_file(p, "pptx")
        assert "PPT 正文内容" in text
    finally:
        os.unlink(p)


def test_parse_code_files():
    """代码/配置文件走纯文本解析：py/sh/yaml/js/go。"""
    samples = {
        "py": "def hello():\n    return 'hi'",
        "sh": "#!/bin/bash\necho 'hello'",
        "yaml": "name: demo\nversion: 1.0",
        "js": "const x = 1;\nconsole.log(x);",
        "go": "package main\nfunc main() {}",
        "toml": "[server]\nport = 8080",
    }
    for ext, content in samples.items():
        p = f"/tmp/_test_code.{ext}"
        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
        try:
            text = parse_file(p, ext)
            assert text.strip() == content.strip(), f"{ext} 解析结果不一致"
        finally:
            os.unlink(p)


def test_parse_docx():
    from docx import Document
    d = Document()
    d.add_paragraph("第一段")
    d.add_paragraph("第二段")
    p = "/tmp/_test.docx"
    d.save(p)
    try:
        text = parse_file(p, "docx")
        assert "第一段" in text and "第二段" in text
    finally:
        os.unlink(p)


def test_parse_xlsx():
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws["A1"] = "表头"
    ws["B1"] = "值"
    p = "/tmp/_test.xlsx"
    wb.save(p)
    try:
        text = parse_file(p, "xlsx")
        assert "表头" in text and "值" in text
    finally:
        os.unlink(p)


def test_parse_pdf():
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "PDF page one")
    p = "/tmp/_test.pdf"
    doc.save(p)
    try:
        text = parse_file(p, "pdf")
        assert "PDF page one" in text
    finally:
        os.unlink(p)


def test_parse_bad_docx_raises():
    p = "/tmp/_bad.docx"
    with open(p, "wb") as f:
        f.write(b"not a real docx")
    try:
        with pytest.raises(ValueError):
            parse_file(p, "docx")
    finally:
        os.unlink(p)


def test_parse_unknown_ext_raises():
    with pytest.raises(ValueError):
        parse_file("/tmp/_nope.xyz", "xyz")


# ---------- safe_parse_arguments（agent 参数容错） ----------

def test_parse_valid_json():
    assert safe_parse_arguments('{"query": "hello"}') == {"query": "hello"}


def test_parse_bad_json_returns_dict():
    result = safe_parse_arguments('{"query": "oops')
    assert isinstance(result, dict)


def test_parse_plain_text_returns_empty():
    assert safe_parse_arguments("这是纯文本，没有任何 JSON 结构") == {}


def test_parse_fenced_json_extracts():
    result = safe_parse_arguments('```json\n{"query": "x"}\n```')
    assert result == {"query": "x"}


def test_parse_none_empty():
    assert safe_parse_arguments(None) == {}
    assert safe_parse_arguments("") == {}


# ---------- attached_documents 注入 ----------

def test_build_messages_without_docs_unchanged():
    history = [{"role": "user", "content": "你好"}]
    out = ChatService.build_llm_messages(history)
    assert out == [{"role": "user", "content": "你好"}]


def test_build_messages_with_docs_appends_to_last_user():
    history = [{"role": "user", "content": "看看文档"}]
    docs = [{"original_name": "a.txt", "page_content": "文档内容ABC"}]
    out = ChatService.build_llm_messages(history, attached_docs=docs)
    assert len(out) == 1
    content = out[0]["content"]
    assert "<attached_documents>" in content
    assert "文档1「a.txt」" in content
    assert "文档内容ABC" in content


def test_build_messages_docs_when_last_not_user():
    history = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "ok"}]
    docs = [{"original_name": "b.md", "page_content": "正文"}]
    out = ChatService.build_llm_messages(history, attached_docs=docs)
    assert out[-1]["role"] == "user"
    assert "<attached_documents>" in out[-1]["content"]


def test_build_messages_docs_truncated_by_budget():
    history = [{"role": "user", "content": "q"}]
    docs = [{"original_name": "big.txt", "page_content": "x" * 50000}]
    model = {"context_budget_chars": 10000}
    out = ChatService.build_llm_messages(history, model=model, attached_docs=docs)
    assert "…[文档内容过长，已截断]" in out[-1]["content"]


def test_build_messages_empty_docs():
    history = [{"role": "user", "content": "q"}]
    out = ChatService.build_llm_messages(history, attached_docs=[{"original_name": "e.txt", "page_content": "  "}])
    assert "<attached_documents>" not in out[-1]["content"]
