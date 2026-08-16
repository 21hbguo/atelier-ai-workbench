"""url_fetcher 模块单元测试（pytest，不依赖数据库/聊天模块）。

成功/重定向路径：本地起真实 ThreadingHTTPServer 提供 HTML 页面。由于 SSRF
防护会拒绝 127.0.0.1（内网），测试通过 patch ``_resolve_safe_ip`` 仅放行
本地服务器端口来模拟"公网可达"的源站（同时验证 pin 连接打到放行的 IP）；
SSRF 校验逻辑本身另有独立用例覆盖
（拒绝内网地址 / 重定向到内网 / _is_private_ip / _check_host_safety）。

异步测试沿用 test_stream_tools.py 的写法：asyncio.run 包装，不依赖
pytest-asyncio 插件。
"""
import asyncio
import http.server
import socket
import socketserver
import threading
from unittest.mock import MagicMock, patch

import httpx
import pytest

from backend.services.url_fetcher import (
    _check_host_safety,
    _doh_resolve_a,
    _is_private_ip,
    _resolve_safe_ip,
    extract_links_from_html,
    extract_urls,
    fetch_url,
)

PAGE_HTML = (
    '<!DOCTYPE html><html><head><meta charset="utf-8">'
    "<title>测试页面标题</title></head>"
    "<body><h1>文章大标题</h1><p>这是正文第一段内容。</p>"
    "<p>这是正文第二段内容。</p></body></html>"
)


def _run(coro):
    """同步跑协程（对应 test_stream_tools.py 的 _run helper）。"""
    return asyncio.run(coro)


class _Handler(http.server.BaseHTTPRequestHandler):
    """本地测试页面：/ok 正常页、/redirect 302 到 /ok、/redirect-loop 自循环、
    /redirect-internal 302 到内网、/empty 空正文、/long 长文、/links 链接页、
    其余 404。"""

    def do_GET(self):  # noqa: N802 - http.server 协议方法名
        if self.path == "/ok":
            body = PAGE_HTML.encode("utf-8")
            self._respond(200, body, "text/html; charset=utf-8")
        elif self.path == "/links":
            port = self.server.server_address[1]
            body = (
                '<!DOCTYPE html><html><head><meta charset="utf-8">'
                "<title>链接页面标题</title></head><body>"
                "<p>链接页面正文内容。</p>"
                '<a href="/ok">相对链接</a>'
                f'<a href="http://127.0.0.1:{port}/ok">绝对站内链接</a>'
                '<a href="https://external.example.com/page1">站外链接1</a>'
                '<a href="/ok">重复的相对链接</a>'
                '<a href="https://external.example.com/page1">重复的站外链接</a>'
                '<a href="/images/photo.jpg">图片资源</a>'
                '<a href="https://cdn.example.com/style.css">样式资源</a>'
                '<a href="javascript:void(0)">javascript 链接</a>'
                '<a href="">空链接</a>'
                '<a href="mailto:test@example.com">邮件链接</a>'
                "</body></html>"
            ).encode("utf-8")
            self._respond(200, body, "text/html; charset=utf-8")
        elif self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/ok")
            self.end_headers()
        elif self.path == "/redirect-loop":
            self.send_response(302)
            self.send_header("Location", "/redirect-loop")
            self.end_headers()
        elif self.path == "/redirect-internal":
            self.send_response(302)
            self.send_header("Location", "http://127.0.0.1:1/")
            self.end_headers()
        elif self.path == "/empty":
            self._respond(200, b"<html><head></head><body></body></html>", "text/html; charset=utf-8")
        elif self.path == "/long":
            body = ('<html><head><title>长文标题</title></head><body><p>'
                    + "段落内容。" * 500 + "</p></body></html>").encode("utf-8")
            self._respond(200, body, "text/html; charset=utf-8")
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


@pytest.fixture(scope="module")
def server():
    with _LocalServer() as s:
        yield s


def _allow_local(port):
    """仅放行本地测试服务器（host, port）的 SSRF 校验，其余一律判为内网。

    用于模拟"源站公网可达"：成功/重定向路径放行；重定向到其他内网地址
    （如 127.0.0.1:1）时校验失败，从而验证重定向目标同样受 SSRF 保护。
    返回 (IP, None) 表示放行并 pin 到该 IP；（None, 错误）表示拒绝。
    """

    def fake(host, port_):
        if (host, port_) == ("127.0.0.1", port):
            return ("127.0.0.1", None)
        return (None, "不允许访问内网地址")

    return fake


# ---------------------------------------------------------------- extract_urls

def test_extract_urls_basic():
    assert extract_urls("访问 https://example.com/a 查看") == ["https://example.com/a"]


def test_extract_urls_multiple_and_dedup():
    text = "看 https://a.com/1 和 http://b.cn/x?q=1，再看 https://a.com/1 一遍"
    assert extract_urls(text) == ["https://a.com/1", "http://b.cn/x?q=1"]


def test_extract_urls_none():
    assert extract_urls("这里没有链接") == []
    assert extract_urls("") == []
    assert extract_urls(None) == []


def test_extract_urls_chinese_mixed():
    text = "链接：https://news.example.com/报道。之后还有 https://blog.example.com/文章！"
    assert extract_urls(text) == ["https://news.example.com/报道", "https://blog.example.com/文章"]


def test_extract_urls_markdown_syntax():
    text = "[点击这里](https://example.com/docs) 和 <https://plain.example.com/>"
    assert extract_urls(text) == ["https://example.com/docs", "https://plain.example.com/"]


@pytest.mark.parametrize("address", ["100.64.0.1", "192.0.0.1", "224.0.0.1"])
def test_private_ip_rejects_non_global_ranges(address):
    assert _is_private_ip(address) is True


# ---------------------------------------------------------------- fetch_url 成功路径

def test_fetch_url_success(server):
    with patch("backend.services.url_fetcher._resolve_safe_ip",
               side_effect=_allow_local(server.port)):
        result = _run(fetch_url(server.base + "/ok"))
    assert result["ok"] is True
    assert result["title"] == "测试页面标题"
    assert "这是正文第一段内容" in result["text"]
    assert result["url"] == server.base + "/ok"


def test_fetch_url_follows_redirect(server):
    with patch("backend.services.url_fetcher._resolve_safe_ip",
               side_effect=_allow_local(server.port)):
        result = _run(fetch_url(server.base + "/redirect"))
    assert result["ok"] is True
    assert result["title"] == "测试页面标题"
    assert "这是正文第一段内容" in result["text"]
    assert result["url"] == server.base + "/ok"  # 最终 URL 为重定向后的地址


def test_fetch_url_truncates_long_text(server):
    with patch("backend.services.url_fetcher._resolve_safe_ip",
               side_effect=_allow_local(server.port)):
        result = _run(fetch_url(server.base + "/long", max_chars=100))
    assert result["ok"] is True
    assert "[内容过长，已截断]" in result["text"]
    assert result["text"].startswith("段落内容。")
    # 截断后 = 前 100 字符 + 截断标记（标记不计入 max_chars）
    assert len(result["text"]) == 100 + len("\n…[内容过长，已截断]")


# ---------------------------------------------------------------- fetch_url 失败路径

def test_fetch_url_rejects_internal_ip():
    # 不 patch：真实走 DNS 解析 + SSRF 校验，127.0.0.1 直接拒绝
    result = _run(fetch_url("http://127.0.0.1:1/"))
    assert result["ok"] is False
    assert result["error"]
    assert "内网" in result["error"]


def test_fetch_url_rejects_non_http_scheme():
    for bad in ("ftp://example.com/file.txt", "javascript:alert(1)",
                "file:///etc/passwd", "mailto:a@b.com"):
        result = _run(fetch_url(bad))
        assert result["ok"] is False
        assert result["error"]


def test_fetch_url_rejects_redirect_to_internal(server):
    # 源站放行，但重定向目标 127.0.0.1:1 被校验拦截 → ok=False
    with patch("backend.services.url_fetcher._resolve_safe_ip",
               side_effect=_allow_local(server.port)):
        result = _run(fetch_url(server.base + "/redirect-internal"))
    assert result["ok"] is False
    assert result["error"]


def test_fetch_url_too_many_redirects(server):
    with patch("backend.services.url_fetcher._resolve_safe_ip",
               side_effect=_allow_local(server.port)):
        result = _run(fetch_url(server.base + "/redirect-loop"))
    assert result["ok"] is False
    assert "重定向" in result["error"]


def test_fetch_url_empty_page(server):
    with patch("backend.services.url_fetcher._resolve_safe_ip",
               side_effect=_allow_local(server.port)):
        result = _run(fetch_url(server.base + "/empty"))
    assert result["ok"] is False
    assert "无法从该链接提取正文" in result["error"]


def test_fetch_url_unreachable():
    # RFC 2606 保留域名，必然解析失败，不依赖外网
    result = _run(fetch_url("http://nonexistent-host-xyz.invalid/"))
    assert result["ok"] is False
    assert result["error"]


def test_fetch_url_http_error(server):
    with patch("backend.services.url_fetcher._resolve_safe_ip",
               side_effect=_allow_local(server.port)):
        result = _run(fetch_url(server.base + "/missing-page"))
    assert result["ok"] is False
    assert "HTTP 404" in result["error"]


# ---------------------------------------------------------------- 链接提取

def test_extract_links_from_html_relative_and_filter():
    html = (
        '<html><body>'
        '<a href="/a">站内1</a>'
        '<a href="https://ext.example.com/x">站外1</a>'
        '<a href="/a">重复站内</a>'
        '<a href="https://ext.example.com/x">重复站外</a>'
        '<a href="//other.example.com/y">协议相对站外</a>'
        '<a href="/img/photo.jpg">图片资源</a>'
        '<a href="https://cdn.example.com/app.js?ver=1">脚本资源</a>'
        '<a href="javascript:void(0)">js伪协议</a>'
        '<a href="mailto:a@b.com">邮件</a>'
        '<a href="">空链接</a>'
        "</body></html>"
    ).encode("utf-8")
    links = extract_links_from_html(html, "http://base.example.com/page")
    # 站外优先且各自保持出现顺序；相对/协议相对链接转绝对；
    # 资源扩展名（含带查询串的）、伪协议、邮件、空链接被过滤；去重保序
    assert links == [
        "https://ext.example.com/x",
        "http://other.example.com/y",
        "http://base.example.com/a",
    ]


def test_extract_links_from_html_max_links_and_bad_input():
    # max_links 截断（站内链接按出现顺序取前 N 条）
    html = b"<html><body>" + b"".join(
        f'<a href="/p{i}">p{i}</a>'.encode() for i in range(50)
    ) + b"</body></html>"
    links = extract_links_from_html(html, "http://base.example.com/", max_links=5)
    assert len(links) == 5
    assert links[0] == "http://base.example.com/p0"
    assert links[-1] == "http://base.example.com/p4"
    # 非 HTML / 空输入不抛异常，返回 []
    assert extract_links_from_html(b"not html at all", "http://base.example.com/") == []
    assert extract_links_from_html(b"", "http://base.example.com/") == []
    assert extract_links_from_html(b"<html></html>", "") == []
    assert extract_links_from_html(None, "http://base.example.com/") == []


def test_fetch_url_returns_links(server):
    with patch("backend.services.url_fetcher._resolve_safe_ip",
               side_effect=_allow_local(server.port)):
        result = _run(fetch_url(server.base + "/links"))
    assert result["ok"] is True
    links = result["links"]
    assert links, "成功响应应包含非空 links"
    assert all(link.startswith(("http://", "https://")) for link in links)
    # 站外链接优先
    assert links[0] == "https://external.example.com/page1"
    # 图片/样式资源与伪协议/邮件链接被过滤
    assert not any(
        "photo.jpg" in link or "style.css" in link
        or "javascript" in link or "mailto" in link
        for link in links
    )
    # 去重：站内绝对链接与相对链接指向同一 URL，/ok 只出现一次
    assert sum(link.endswith("/ok") for link in links) == 1
    # 最多 10 条
    assert len(links) <= 10


def test_fetch_url_links_empty_on_failure(server):
    # HTTP 错误路径
    with patch("backend.services.url_fetcher._resolve_safe_ip",
               side_effect=_allow_local(server.port)):
        result = _run(fetch_url(server.base + "/missing-page"))
    assert result["ok"] is False
    assert result["links"] == []
    # 非 http/https scheme 拒绝路径
    result = _run(fetch_url("ftp://example.com/file.txt"))
    assert result["ok"] is False
    assert result["links"] == []
    # 空正文路径
    with patch("backend.services.url_fetcher._resolve_safe_ip",
               side_effect=_allow_local(server.port)):
        result = _run(fetch_url(server.base + "/empty"))
    assert result["ok"] is False
    assert result["links"] == []


# ---------------------------------------------------------------- SSRF 校验逻辑单测

def test_is_private_ip():
    private = [
        "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255",
        "192.168.1.1", "169.254.10.10", "0.0.0.0",
        "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1",
        "::ffff:127.0.0.1",  # IPv4-mapped IPv6 按内嵌 IPv4 判定
        "64:ff9b::7f00:1",   # NAT64/DNS64 内嵌 127.0.0.1
        "64:ff9b::a00:1",    # NAT64 内嵌 10.0.0.1
        "2002:7f00:1::1",    # 6to4 内嵌 127.0.0.1
        "2001:0:4136:e378:8000:63bf:3fff:fdd2",  # Teredo
    ]
    public = [
        "8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "11.0.0.1",
        "2001:4860:4860::8888", "64:ff9b::8.8.8.8", "not-an-ip",
    ]
    for ip in private:
        assert _is_private_ip(ip), f"{ip} 应判为内网/保留地址"
    for ip in public:
        assert not _is_private_ip(ip), f"{ip} 不应判为内网/保留地址"


def test_pin_host_uses_resolved_ip():
    # pin 后 URL 的 host 必须是已校验的 IP（防 DNS rebinding TOCTOU）
    from backend.services.url_fetcher import _pin_host

    assert _pin_host("https://example.com/a?b=1", "93.184.216.34") == "https://93.184.216.34/a?b=1"
    assert _pin_host("http://example.com:8080/x", "1.2.3.4") == "http://1.2.3.4:8080/x"
    assert _pin_host("https://example.com/", "2001:db8::1") == "https://[2001:db8::1]/"


def test_check_host_safety_rejects_localhost():
    assert "内网" in _check_host_safety("127.0.0.1", 80)
    assert "内网" in _check_host_safety("localhost", 80)
    assert "内网" in _check_host_safety("::1", 80)


def test_check_host_safety_checks_all_resolved_ips():
    # 多个解析结果中只要有一个是内网 IP 就必须拒绝（DoH 兜底不可用时同样拒绝）
    infos = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80)),
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 80)),
    ]
    with patch("backend.services.url_fetcher._resolve_host", return_value=infos), \
         patch("backend.services.url_fetcher._doh_resolve_a", return_value=[]):
        assert "内网" in _check_host_safety("evil.example.com", 80)


def test_check_host_safety_public_ok_and_dns_failure():
    with patch("backend.services.url_fetcher._resolve_host",
               return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))]):
        assert _check_host_safety("example.com", 80) is None
    with patch("backend.services.url_fetcher._resolve_host",
               side_effect=socket.gaierror("nodename nor servname provided")):
        err = _check_host_safety("no-such-host.invalid", 80)
        assert err is not None
        assert "无法解析" in err


# ---------------------------------------------------------------- DoH DNS 兜底

def _fake_doh_response(status=0, answers=None):
    """构造 _doh_resolve_a 的 httpx.get 假响应（含 raise_for_status / json）。"""
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(return_value={"Status": status, "Answer": answers or []})
    return resp


def test_doh_resolve_a_parses_a_records():
    answers = [
        {"name": "example.com", "type": 1, "TTL": 60, "data": "93.184.216.34"},
        {"name": "example.com", "type": 1, "TTL": 60, "data": "1.2.3.4"},
        {"name": "example.com", "type": 5, "TTL": 60, "data": "alias.example.com"},  # CNAME 过滤
        {"name": "example.com", "type": 1, "data": 12345},  # 非 str data 过滤
    ]
    with patch("backend.services.url_fetcher.httpx.get",
               return_value=_fake_doh_response(answers=answers)) as m:
        ips = _doh_resolve_a("example.com")
    # 请求参数：dns-json 端点 + name/type=A + accept 头
    assert m.call_args.args[0] == "https://1.1.1.1/dns-query"
    assert m.call_args.kwargs["params"] == {"name": "example.com", "type": "A"}
    assert m.call_args.kwargs["headers"]["accept"] == "application/dns-json"
    assert ips == ["93.184.216.34", "1.2.3.4"]


def test_doh_resolve_a_failures_return_empty():
    with patch("backend.services.url_fetcher.httpx.get", side_effect=httpx.ConnectError("网络不通")):
        assert _doh_resolve_a("example.com") == []
    with patch("backend.services.url_fetcher.httpx.get",
               return_value=_fake_doh_response(status=3)):  # DNS 状态非 0（NXDOMAIN）
        assert _doh_resolve_a("no-such.invalid") == []
    with patch("backend.services.url_fetcher.httpx.get",
               return_value=_fake_doh_response()):  # 无 Answer
        assert _doh_resolve_a("example.com") == []


def test_resolve_safe_ip_public_no_doh_call():
    """系统 DNS 全公网 → 直接放行，不触发 DoH。"""
    infos = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))]
    with patch("backend.services.url_fetcher._resolve_host", return_value=infos), \
         patch("backend.services.url_fetcher._doh_resolve_a") as m:
        ip, err = _resolve_safe_ip("example.com", 80)
    assert err is None and ip == "93.184.216.34"
    m.assert_not_called()


def test_resolve_safe_ip_doh_fallback_accepts_public():
    """系统 DNS 被污染（TUN fake-IP 返回内网）→ DoH 复核出公网地址 → 放行 DoH 结果。"""
    infos = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 80))]
    with patch("backend.services.url_fetcher._resolve_host", return_value=infos), \
         patch("backend.services.url_fetcher._doh_resolve_a", return_value=["93.184.216.34"]):
        ip, err = _resolve_safe_ip("example.com", 80)
    assert err is None and ip == "93.184.216.34"


def test_resolve_safe_ip_doh_fallback_rejects_internal():
    """DoH 复核结果仍含内网地址 → 拒绝（以 DoH 答案为准，不放过）。"""
    infos = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 80))]
    with patch("backend.services.url_fetcher._resolve_host", return_value=infos), \
         patch("backend.services.url_fetcher._doh_resolve_a", return_value=["169.254.169.254"]):
        ip, err = _resolve_safe_ip("example.com", 80)
    assert ip is None and "内网" in err


def test_resolve_safe_ip_doh_fallback_empty_rejects():
    """系统 DNS 内网 + DoH 不可用/空结果 → 按内网拒绝（不降级放行）。"""
    infos = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.1", 80))]
    with patch("backend.services.url_fetcher._resolve_host", return_value=infos), \
         patch("backend.services.url_fetcher._doh_resolve_a", return_value=[]):
        ip, err = _resolve_safe_ip("example.com", 80)
    assert ip is None and "内网" in err

