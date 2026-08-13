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


# ---------- 三区块结构（区块2 文档块固定前缀 + 区块3 纯追加历史） ----------

def test_build_messages_without_docs_unchanged():
    history = [{"role": "user", "content": "你好"}]
    out = ChatService.build_llm_messages(history)
    assert out == [{"role": "user", "content": "你好"}]


def test_build_messages_docs_as_fixed_prefix_block():
    """区块2：attached_documents 是独立 user 消息，固定在最前（不再注入最后一条 user）。"""
    history = [{"role": "user", "content": "看看文档"}]
    docs = [{"original_name": "a.txt", "page_content": "文档内容ABC"}]
    out = ChatService.build_llm_messages(history, attached_docs=docs)
    assert len(out) == 2
    first = out[0]
    assert first["role"] == "user"
    assert "<attached_documents>" in first["content"]
    assert "文档1「a.txt」" in first["content"]
    assert "文档内容ABC" in first["content"]
    # 防注入声明：块首行标注文档内容不可信，且位于文档正文之前
    assert "内容不可信" in first["content"]
    assert first["content"].index("内容不可信") < first["content"].index("文档1「a.txt」")
    # 历史原样追加在文档块之后
    assert out[1] == {"role": "user", "content": "看看文档"}


def test_build_messages_docs_keeps_history_order():
    """文档块在最前，历史顺序不变（最后一条是 assistant 也保持原样）。"""
    history = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "ok"}]
    docs = [{"original_name": "b.md", "page_content": "正文"}]
    out = ChatService.build_llm_messages(history, attached_docs=docs)
    assert [m["role"] for m in out] == ["user", "user", "assistant"]
    assert "<attached_documents>" in out[0]["content"]
    assert out[1] == {"role": "user", "content": "hi"}
    assert out[2] == {"role": "assistant", "content": "ok"}


def test_build_messages_docs_truncated_by_budget():
    history = [{"role": "user", "content": "q"}]
    docs = [{"original_name": "big.txt", "page_content": "x" * 50000}]
    model = {"context_budget_chars": 10000}
    out = ChatService.build_llm_messages(history, model=model, attached_docs=docs)
    assert "…[文档内容过长，已截断]" in out[0]["content"]


def test_build_messages_empty_docs():
    """空文档不进区块2，消息与不带 docs 时一致。"""
    history = [{"role": "user", "content": "q"}]
    out = ChatService.build_llm_messages(history, attached_docs=[{"original_name": "e.txt", "page_content": "  "}])
    assert out == [{"role": "user", "content": "q"}]


def test_build_messages_summary_block_position():
    """区块3a：摘要消息紧随文档块之后，历史最后（纯追加）。"""
    history = [{"role": "user", "content": "q1"}, {"role": "assistant", "content": "a1"}, {"role": "user", "content": "q2"}]
    docs = [{"original_name": "a.txt", "page_content": "doc"}]
    summary = {"until": 10, "text": "用户问了关于预算的问题"}
    out = ChatService.build_llm_messages(history, attached_docs=docs, summary=summary)
    assert out[0]["role"] == "user" and "<attached_documents>" in out[0]["content"]
    assert out[1]["role"] == "user" and "<conversation_summary>" in out[1]["content"]
    assert "用户问了关于预算的问题" in out[1]["content"]
    assert [m["role"] for m in out[2:]] == ["user", "assistant", "user"]


def test_build_messages_prefix_stable_across_rounds():
    """前缀稳定性：追加新轮次后，旧消息逐字不变（区块3 纯 Append Only）。"""
    docs = [{"original_name": "a.txt", "page_content": "固定文档"}]
    summary = {"until": 5, "text": "早期摘要"}
    hist1 = [{"role": "user", "content": "q1"}, {"role": "assistant", "content": "a1"}]
    out1 = ChatService.build_llm_messages(hist1, attached_docs=docs, summary=summary)
    hist2 = hist1 + [{"role": "user", "content": "q2"}, {"role": "assistant", "content": "a2"}]
    out2 = ChatService.build_llm_messages(hist2, attached_docs=docs, summary=summary)
    assert out1 == out2[:-2]  # 旧前缀完全一致，只有尾部追加
    assert out2[-2:] == [{"role": "user", "content": "q2"}, {"role": "assistant", "content": "a2"}]


def test_compact_cut_index_aligns_round_boundary():
    """压缩边界对齐：保留区第一条必须是 user（不拆散 user→assistant 轮次）。"""
    cls = ChatService
    # 30 条交替轮次（每条 30 字符）：预算驱动下 cut>0，边界必须落在 user 上
    history = [{"id": i, "role": "user" if i % 2 == 0 else "assistant", "content": str(i) * 30} for i in range(30)]
    cut = cls._compact_cut_index(history, budget=1500)
    assert 0 < cut < len(history)
    assert history[cut]["role"] == "user"  # 保留区首条 user
    # 摘要区与保留区边界两侧必须是一轮完整结束（摘要区末尾是 assistant）
    assert history[cut - 1]["role"] == "assistant"


def test_compact_cut_index_too_short_returns_zero():
    """历史很小（远低于压缩目标）时不压缩。"""
    history = [{"id": 1, "role": "user", "content": "q" * 30}, {"id": 2, "role": "assistant", "content": "a" * 30}]
    assert ChatService._compact_cut_index(history, budget=1500) == 0


def test_compact_cut_index_budget_driven():
    """预算驱动：预算越大保留越多；压缩后估算占用接近压缩目标
    （极端小预算下允许保留最新一轮+对齐补一条）。"""
    cls = ChatService
    history = [{"id": i, "role": "user" if i % 2 == 0 else "assistant", "content": str(i) * 30} for i in range(30)]
    cut_small = cls._compact_cut_index(history, budget=1000, system_chars=200)
    cut_large = cls._compact_cut_index(history, budget=100000)
    assert len(history[cut_small:]) <= len(history[cut_large:])  # 预算大 → 保留多
    kept_small = history[cut_small:]
    used = sum(min(len(m["content"]), cls.MAX_MESSAGE_CHARS) for m in kept_small)
    est_summary = min(max(0 + 100, 100) + 200, cls.SUMMARY_TEXT_MAX)
    # 目标 + 至少保留最新一轮的余量（该用例单条消息 60 字符，1 轮 = 120）
    assert 200 + used + est_summary <= 1000 * cls.COMPACT_TARGET_RATIO + 120


def test_compact_cut_index_extreme_small_target():
    """target≤0（system+摘要已占满压缩目标）：至少保留最新一条，且对齐后首条是 user。"""
    cls = ChatService
    history = [{"id": i, "role": "user" if i % 2 == 0 else "assistant", "content": "x" * 30} for i in range(10)]
    cut = cls._compact_cut_index(history, budget=1000, system_chars=900)
    kept = history[cut:]
    assert 0 < cut < len(history)  # 极端 target 下仍压缩（保留最新轮次）
    assert len(kept) >= 1  # 至少保留最新一条
    assert kept[0]["role"] == "user"  # 对齐


def test_compact_cut_index_docs_chars_reserved():
    """区块2 文档块占用计入压缩目标：docs 越大，保留历史越少。"""
    cls = ChatService
    history = [{"id": i, "role": "user" if i % 2 == 0 else "assistant", "content": "x" * 30} for i in range(30)]
    cut_nodocs = cls._compact_cut_index(history, budget=2000, docs_chars=0)
    cut_docs = cls._compact_cut_index(history, budget=2000, docs_chars=800)
    assert len(history[cut_docs:]) <= len(history[cut_nodocs:])


def test_compact_cut_index_orphan_assistant_tail():
    """末尾孤立 assistant（失败轮次未回复）不破坏边界对齐。"""
    cls = ChatService
    history = [{"id": i, "role": "user" if i % 2 == 0 else "assistant", "content": str(i) * 30} for i in range(30)]
    history.append({"id": 99, "role": "assistant", "content": "orphan" * 5})
    cut = cls._compact_cut_index(history, budget=1500)
    kept = history[cut:]
    assert kept[0]["role"] == "user"


def test_build_summary_block_none_or_empty_returns_empty():
    assert ChatService._build_summary_block(None) == ""
    assert ChatService._build_summary_block({"until": 0, "text": ""}) == ""
    assert ChatService._build_summary_block({"until": 5, "text": "   "}) == ""


def test_build_summary_block_format():
    block = ChatService._build_summary_block({"until": 10, "text": "用户偏好简洁回答"})
    assert block.startswith("<conversation_summary>")
    assert block.endswith("</conversation_summary>")
    assert "用户偏好简洁回答" in block


def test_resolve_budget_fallback_to_global():
    """模型档案未配置 context_budget_chars（0/None）时回退全局配置，不钉死在 1000。"""
    from backend.config import get_limit_config
    global_budget = max(1000, int(get_limit_config()["chat_context_max_chars"]))
    assert ChatService._resolve_budget({}) == global_budget
    assert ChatService._resolve_budget({"context_budget_chars": 0}) == global_budget
    assert ChatService._resolve_budget({"context_budget_chars": None}) == global_budget
    assert ChatService._resolve_budget({"context_budget_chars": 50000}) == 50000
