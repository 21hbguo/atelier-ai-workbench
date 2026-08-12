"""url_fetcher 文件分支单元测试（本地 fast path / MinerU 降级 / 图片 / Content-Type 兜底）。

与 test_url_fetcher.py 相同的模式：本地起真实 ThreadingHTTPServer 提供
PDF/图片字节，通过 patch ``_resolve_safe_ip`` 仅放行本地服务器端口来模拟
"公网可达"源站；MinerU 模块（并行开发中）通过 patch
``backend.services.url_fetcher._get_mineru_client`` 注入假实现，不依赖
mineru_client.py 是否就绪。

异步测试沿用 asyncio.run 包装，不依赖 pytest-asyncio 插件。
"""
import asyncio
import http.server
import os
import socketserver
import threading
from unittest.mock import patch

from backend.services.url_fetcher import fetch_url

PDF_TEXT = "Hello PDF world 你好世界"


def _run(coro):
    """同步跑协程（对应 test_url_fetcher.py 的 _run helper）。"""
    return asyncio.run(coro)


def _make_pdf_bytes(text=PDF_TEXT) -> bytes:
    """用 PyMuPDF 现场生成一个带文本的小 PDF（fontname=china-s 支持中文）。"""
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text, fontname="china-s")
    data = doc.tobytes()
    doc.close()
    return data


def _make_png_bytes() -> bytes:
    """用 PyMuPDF 生成一张 1x1 PNG 图片字节。"""
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=100, height=100)
    pix = page.get_pixmap()
    data = pix.tobytes("png")
    doc.close()
    return data


class _FakeMineru:
    """mineru_client 的假实现：记录调用、可配置 is_configured / 返回结果。"""

    def __init__(self, configured=True, result=None):
        self._configured = configured
        self._result = result
        self.calls = []  # [(path, filename, kwargs), ...]

    def is_configured(self):
        return self._configured

    async def parse_file(self, path, filename, **kwargs):
        self.calls.append((path, filename, kwargs))
        if self._result is not None:
            return self._result
        return {"ok": False, "error": "云端繁忙"}


class _Handler(http.server.BaseHTTPRequestHandler):
    """本地测试文件服务器：/sample.pdf 正常 PDF、/scan.pdf 文本 PDF（本地解析
    被 mock 抛错时走 MinerU）、/image.png 图片、/download 无扩展名但
    Content-Type 为 application/pdf（兜底检测）、/pseudo.pdf 扩展名像文件但
    返回 HTML（回退网页分支）、/big.pdf 超过体积上限、其余 404。"""

    def do_GET(self):  # noqa: N802 - http.server 协议方法名
        if self.path == "/sample.pdf":
            self._respond(200, _make_pdf_bytes(), "application/pdf")
        elif self.path == "/scan.pdf":
            self._respond(200, _make_pdf_bytes("scanned page"), "application/pdf")
        elif self.path == "/image.png":
            self._respond(200, _make_png_bytes(), "image/png")
        elif self.path == "/download":
            # 无扩展名路径，但 Content-Type 明确是 PDF → 兜底检测应命中文件分支
            self._respond(200, _make_pdf_bytes(), "application/pdf")
        elif self.path == "/pseudo.pdf":
            # 扩展名像 PDF，但服务器返回 HTML → 回退网页分支，不误伤
            body = (
                '<html><head><title>伪文件页</title></head>'
                "<body><p>这其实是个网页</p></body></html>"
            ).encode("utf-8")
            self._respond(200, body, "text/html; charset=utf-8")
        elif self.path == "/big.pdf":
            # 内容超过 MAX_FILE_BYTES 上限（patch 后用小上限触发）
            self._respond(200, b"x" * (10 * 1024 * 1024), "application/pdf")
        else:
            self._respond(404, b"not found", "text/plain")

    def _respond(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # 静默访问日志
        pass


class _LocalServer:
    """在后台线程跑 ThreadingHTTPServer，监听 127.0.0.1 随机端口。"""

    def __enter__(self):
        self.httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()

    @property
    def port(self):
        return self.httpd.server_address[1]

    @property
    def base(self):
        return f"http://127.0.0.1:{self.port}"


def _allow_local(port):
    """仅放行本地测试服务器（host, port）的 SSRF 校验（同 test_url_fetcher.py）。"""

    def fake(host, port_):
        if (host, port_) == ("127.0.0.1", port):
            return ("127.0.0.1", None)
        return (None, "不允许访问内网地址")

    return fake


def _patch_ssrf(port):
    return patch("backend.services.url_fetcher._resolve_safe_ip",
                 side_effect=_allow_local(port))


# ---------------------------------------------------------------- 本地 fast path

def test_file_fast_path_pdf():
    with _LocalServer() as s, _patch_ssrf(s.port):
        result = _run(fetch_url(s.base + "/sample.pdf"))
    assert result["ok"] is True
    assert PDF_TEXT in result["text"]
    assert result["title"] == "sample.pdf"  # title 为文件名
    assert result["url"] == s.base + "/sample.pdf"


def test_file_detected_by_content_type():
    """无扩展名路径，但响应 Content-Type=application/pdf → 兜底走文件分支。"""
    with _LocalServer() as s, _patch_ssrf(s.port):
        result = _run(fetch_url(s.base + "/download"))
    assert result["ok"] is True
    assert PDF_TEXT in result["text"]
    assert result["title"] == "document.pdf"  # URL 无文件名 → 默认名


def test_file_truncates_text():
    """文件文本同样受 max_chars 截断（复用统一截断逻辑）。"""
    with _LocalServer() as s, _patch_ssrf(s.port):
        result = _run(fetch_url(s.base + "/sample.pdf", max_chars=10))
    assert result["ok"] is True
    assert "[内容过长，已截断]" in result["text"]


def test_pseudo_pdf_returns_html_falls_back_to_web():
    """URL 扩展名像 PDF 但服务器返回 HTML → 回退网页分支，不误伤。"""
    with _LocalServer() as s, _patch_ssrf(s.port):
        result = _run(fetch_url(s.base + "/pseudo.pdf"))
    assert result["ok"] is True
    assert result["title"] == "伪文件页"
    assert "这其实是个网页" in result["text"]


def test_file_exceeds_max_bytes():
    """超过文件体积上限 → 明确报错（patch MAX_FILE_BYTES 用小上限）。"""
    with _LocalServer() as s, _patch_ssrf(s.port), \
            patch("backend.services.url_fetcher.MAX_FILE_BYTES", 1024):
        result = _run(fetch_url(s.base + "/big.pdf"))
    assert result["ok"] is False
    assert "大小上限" in result["error"]


# ---------------------------------------------------------------- MinerU 降级

def test_file_mineru_fallback_when_local_fails():
    """本地解析抛异常（模拟扫描件）→ 降级 MinerU 且成功。"""
    mineru = _FakeMineru(configured=True, result={"ok": True, "text": "MinerU OCR 文本"})
    with _LocalServer() as s, _patch_ssrf(s.port), \
            patch("backend.services.url_fetcher.parse_file",
                  side_effect=ValueError("扫描件，无文本层")), \
            patch("backend.services.url_fetcher._get_mineru_client",
                  return_value=mineru):
        result = _run(fetch_url(s.base + "/scan.pdf"))
    assert result["ok"] is True
    assert "MinerU OCR 文本" in result["text"]
    assert result["title"] == "scan.pdf"
    assert len(mineru.calls) == 1
    path, filename, kwargs = mineru.calls[0]
    assert filename == "scan.pdf"
    assert kwargs.get("is_ocr") is True
    assert path.endswith(".pdf")
    assert not os.path.exists(path)  # 临时文件用后已清理


def test_file_mineru_fallback_fails():
    """本地失败 + MinerU 返回 ok=False → 提示本地与云端都失败。"""
    mineru = _FakeMineru(configured=True, result={"ok": False, "error": "云端繁忙"})
    with _LocalServer() as s, _patch_ssrf(s.port), \
            patch("backend.services.url_fetcher.parse_file",
                  side_effect=ValueError("扫描件，无文本层")), \
            patch("backend.services.url_fetcher._get_mineru_client",
                  return_value=mineru):
        result = _run(fetch_url(s.base + "/scan.pdf"))
    assert result["ok"] is False
    assert "文件解析失败" in result["error"]
    assert "云端繁忙" in result["error"]


def test_file_mineru_not_configured_local_fails():
    """本地失败 + MinerU 未配置 → 明确报错提示。"""
    with _LocalServer() as s, _patch_ssrf(s.port), \
            patch("backend.services.url_fetcher.parse_file",
                  side_effect=ValueError("扫描件，无文本层")), \
            patch("backend.services.url_fetcher._get_mineru_client",
                  return_value=None):
        result = _run(fetch_url(s.base + "/scan.pdf"))
    assert result["ok"] is False
    assert "文件解析失败" in result["error"]
    assert "MinerU" in result["error"]


# ---------------------------------------------------------------- 图片分支

def test_image_without_mineru():
    """图片无本地解析，MinerU 未配置（模块缺失/is_configured False）→ 提示需配置 MinerU。"""
    with _LocalServer() as s, _patch_ssrf(s.port), \
            patch("backend.services.url_fetcher._get_mineru_client",
                  return_value=None):
        result = _run(fetch_url(s.base + "/image.png"))
    assert result["ok"] is False
    assert "MinerU" in result["error"]

    # is_configured() 返回 False 同样视为未配置
    with _LocalServer() as s, _patch_ssrf(s.port), \
            patch("backend.services.url_fetcher._get_mineru_client",
                  return_value=_FakeMineru(configured=False)):
        result = _run(fetch_url(s.base + "/image.png"))
    assert result["ok"] is False
    assert "MinerU" in result["error"]


def test_image_with_mineru():
    """图片 + MinerU 已配置且解析成功 → ok=True、text 为 markdown 文本。"""
    mineru = _FakeMineru(configured=True, result={"ok": True, "text": "图片 OCR 结果"})
    with _LocalServer() as s, _patch_ssrf(s.port), \
            patch("backend.services.url_fetcher._get_mineru_client",
                  return_value=mineru):
        result = _run(fetch_url(s.base + "/image.png"))
    assert result["ok"] is True
    assert "图片 OCR 结果" in result["text"]
    assert result["title"] == "image.png"
    assert len(mineru.calls) == 1
    assert mineru.calls[0][1] == "image.png"
    assert mineru.calls[0][2].get("is_ocr") is True
