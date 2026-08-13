"""web_search 内置免费搜索（html provider）单元测试（pytest，不依赖数据库/聊天模块）。

覆盖：
1. _parse_bing_html / _parse_ddg_html：对样例 HTML 直接解析（结构、数量、过滤：
   非 http 链接、无 h2 标题/无链接的块被跳过）；
2. _bing_html / _ddg_html：patch _http_get 返回样例 HTML，验证 URL 构造（q 编码）、
   max_bytes 限制参数与解析链路；
3. 本地 HTTP server 提供 /bing、/ddg 样例页，真实抓取后验证解析兼容；
4. 降级链：html provider 在 bing 失败时回退 ddg；两者全败走全败错误路径
   （不使用 _unconfigured_message 的"未配置"误导文案）；
5. _configured_providers 对 html 的追加 / 显式处理。

异步测试沿用 test_url_fetcher.py 的 _LocalServer + _run helper 风格，
不依赖 pytest-asyncio 插件。
"""
import asyncio
import http.server
import os
import socketserver
import threading
import urllib.parse
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from backend.services.agent.context import AgentContext
from backend.services.agent.tools.web_search import (
    _bing_html,
    _configured_providers,
    _ddg_html,
    _parse_bing_html,
    _parse_ddg_html,
    web_search_search,
)

# 样例：真实结构的最小 Bing 结果页。
# 2 个正常 b_algo 结果块（h2>a 标题 + p 描述）、1 个广告块（无 h2）、
# 1 个非 http 链接块、1 个相对路径链接块、1 个无链接块 —— 后三者应被解析过滤。
BING_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head><title>pytest 样例 - Bing</title></head>
<body>
<ol id="b_results">
  <li class="b_algo">
    <div class="b_title"><h2><a href="https://example.com/article-1" h="ID=SERP,5001.1">示例文章一</a></h2></div>
    <div class="b_caption"><p>这是第一条结果的描述文本。</p></div>
  </li>
  <li class="b_algo">
    <div class="b_title"><h2><a href="https://example.org/news/2" h="ID=SERP,5001.2">示例新闻二</a></h2></div>
    <div class="b_caption"><p>第二条结果：含 &amp; 实体与 <b>加粗</b> 标签。</p></div>
  </li>
  <li class="b_algo">
    <div class="b_ad"><span>广告</span></div>
    <div class="b_caption"><p>广告块没有 h2 标题，应被跳过。</p></div>
  </li>
  <li class="b_algo">
    <div class="b_title"><h2><a href="javascript:void(0)">非法协议链接</a></h2></div>
    <div class="b_caption"><p>非 http/https 链接应被跳过。</p></div>
  </li>
  <li class="b_algo">
    <div class="b_title"><h2><a href="/relative/path">相对路径链接</a></h2></div>
    <div class="b_caption"><p>相对链接应被跳过。</p></div>
  </li>
  <li class="b_algo">
    <div class="b_caption"><p>完全没有链接的块，应被跳过。</p></div>
  </li>
</ol>
</body>
</html>"""

# 样例：真实结构的最小 DuckDuckGo HTML 结果页（2 个 result 块 + 1 个非法链接块）。
DDG_HTML = """<!DOCTYPE html>
<html>
<head><title>DuckDuckGo - pytest 样例</title></head>
<body>
<div class="results">
  <div class="result results_links results_links_deep web-result">
    <div class="links_main links_deep result__body">
      <div class="result__header">
        <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://ddg.example.com/page-1">第一条结果 <b>高亮</b> 标题</a></h2>
      </div>
      <a class="result__snippet" href="https://ddg.example.com/page-1">第一条结果的摘要文本。</a>
    </div>
  </div>
  <div class="result results_links results_links_deep web-result">
    <div class="links_main links_deep result__body">
      <div class="result__header">
        <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://ddg.example.org/news/2">第二条结果</a></h2>
      </div>
      <a class="result__snippet" href="https://ddg.example.org/news/2">第二条摘要：含 &amp; 实体。</a>
    </div>
  </div>
  <div class="result">
    <div class="result__header">
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="javascript:void(0)">非法链接</a></h2>
    </div>
    <a class="result__snippet" href="javascript:void(0)">不应被解析。</a>
  </div>
</div>
</body>
</html>"""


def _run(coro):
    """同步跑协程（对应 test_url_fetcher.py 的 _run helper）。"""
    return asyncio.run(coro)


class _Handler(http.server.BaseHTTPRequestHandler):
    """本地样例页：/bing 返回最小 Bing 结果页、/ddg 返回最小 DDG 结果页、其余 404。"""

    def do_GET(self):  # noqa: N802 - http.server 协议方法名
        if self.path.startswith("/bing"):
            self._respond(200, BING_HTML.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path.startswith("/ddg"):
            self._respond(200, DDG_HTML.encode("utf-8"), "text/html; charset=utf-8")
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


# ---------------------------------------------------------------- _parse_bing_html

def test_parse_bing_html():
    results = _parse_bing_html(BING_HTML, 10)
    assert len(results) == 2  # 广告块 / 非 http / 相对路径 / 无链接块均被过滤
    assert results[0] == {
        "title": "示例文章一",
        "url": "https://example.com/article-1",
        "description": "这是第一条结果的描述文本。",
    }
    # 实体解码（&amp; → &）与内嵌标签去除（<b>）
    assert results[1]["title"] == "示例新闻二"
    assert results[1]["url"] == "https://example.org/news/2"
    assert results[1]["description"] == "第二条结果：含 & 实体与 加粗 标签。"


def test_parse_bing_html_limit_n():
    assert len(_parse_bing_html(BING_HTML, 1)) == 1
    assert _parse_bing_html(BING_HTML, 1)[0]["url"] == "https://example.com/article-1"


def test_parse_bing_html_bad_input():
    assert _parse_bing_html("", 10) == []
    assert _parse_bing_html("<html>无结果结构</html>", 10) == []
    assert _parse_bing_html(None, 10) == []


# ---------------------------------------------------------------- _parse_ddg_html

def test_parse_ddg_html():
    results = _parse_ddg_html(DDG_HTML, 10)
    assert len(results) == 2  # 非法链接块被过滤
    assert results[0] == {
        "title": "第一条结果 高亮 标题",  # <b> 高亮标签去除
        "url": "https://ddg.example.com/page-1",
        "description": "第一条结果的摘要文本。",
    }
    assert results[1]["url"] == "https://ddg.example.org/news/2"
    assert results[1]["description"] == "第二条摘要：含 & 实体。"  # 实体解码


def test_parse_ddg_html_limit_n():
    assert len(_parse_ddg_html(DDG_HTML, 1)) == 1
    assert _parse_ddg_html(DDG_HTML, 1)[0]["url"] == "https://ddg.example.com/page-1"


def test_parse_ddg_html_bad_input():
    assert _parse_ddg_html("", 10) == []
    assert _parse_ddg_html("<html>无结果结构</html>", 10) == []
    assert _parse_ddg_html(None, 10) == []


# ---------------------------------------------------------------- _bing_html / _ddg_html 抓取链路

def test_bing_html_requests_and_parses():
    fake_get = AsyncMock(return_value={"html": BING_HTML})
    with patch("backend.services.agent.tools.web_search._http_get", new=fake_get) as m:
        results = _run(_bing_html("pytest 免费搜索", 10))
    # URL 构造：query 经 urllib.parse.quote 编码
    url = m.await_args.args[0]
    assert url.startswith("https://www.bing.com/search?q=")
    assert "pytest 免费搜索" in urllib.parse.unquote(url)
    # 响应体大小上限参数生效（2MB）
    assert m.await_args.kwargs.get("max_bytes") == 2 * 1024 * 1024
    assert len(results) == 2
    assert results[0]["url"] == "https://example.com/article-1"


def test_ddg_html_requests_and_parses():
    fake_get = AsyncMock(return_value={"html": DDG_HTML})
    with patch("backend.services.agent.tools.web_search._http_get", new=fake_get) as m:
        results = _run(_ddg_html("pytest 免费搜索", 10))
    url = m.await_args.args[0]
    assert url.startswith("https://html.duckduckgo.com/html/?q=")
    assert "pytest 免费搜索" in urllib.parse.unquote(url)
    assert m.await_args.kwargs.get("max_bytes") == 2 * 1024 * 1024
    assert len(results) == 2
    assert results[1]["url"] == "https://ddg.example.org/news/2"


def test_parse_real_html_from_local_server(server):
    """端到端：真实 HTTP 抓取本地样例页（Bing/DDG 结构）后解析。"""
    resp = httpx.get(server.base + "/bing")
    assert resp.status_code == 200
    results = _parse_bing_html(resp.text, 10)
    assert len(results) == 2
    assert results[0]["title"] == "示例文章一"

    resp = httpx.get(server.base + "/ddg")
    assert resp.status_code == 200
    results = _parse_ddg_html(resp.text, 10)
    assert len(results) == 2
    assert results[1]["description"] == "第二条摘要：含 & 实体。"


# ---------------------------------------------------------------- 降级链（web_search_search 主循环）

def test_html_provider_fallback_chain():
    """bing 抓取异常 → 自动回退 ddg → 成功返回并上报引用。"""
    ctx = AgentContext()
    items = [
        {"title": "DDG 兜底结果", "url": "https://ddg-fallback.example.com/x",
         "description": "兜底描述"},
    ]
    with patch("backend.services.agent.tools.web_search._configured_providers",
               return_value=["html"]), \
         patch("backend.services.agent.tools.web_search._acquire_global_slot",
               new=AsyncMock(return_value=True)), \
         patch("backend.services.agent.tools.web_search._bing_html",
               new=AsyncMock(side_effect=RuntimeError("bing 抓取失败"))), \
         patch("backend.services.agent.tools.web_search._ddg_html",
               new=AsyncMock(return_value=items)):
        result = _run(web_search_search({"query": "pytest html 兜底链测试", "max_results": 5}, ctx))
    assert "https://ddg-fallback.example.com/x" in result
    assert "DDG 兜底结果" in result
    assert ctx.citations == [{"url": "https://ddg-fallback.example.com/x",
                              "title": "DDG 兜底结果",
                              "snippet": "兜底描述"}]


def test_html_provider_both_fail():
    """bing 与 ddg 都失败 → 走"全部供应商失败"错误路径，不使用"未配置"误导文案。"""
    ctx = AgentContext()
    with patch("backend.services.agent.tools.web_search._configured_providers",
               return_value=["html"]), \
         patch("backend.services.agent.tools.web_search._acquire_global_slot",
               new=AsyncMock(return_value=True)), \
         patch("backend.services.agent.tools.web_search._bing_html",
               new=AsyncMock(return_value=[])), \
         patch("backend.services.agent.tools.web_search._ddg_html",
               new=AsyncMock(side_effect=RuntimeError("ddg 抓取失败"))):
        result = _run(web_search_search({"query": "pytest html 双引擎全败", "max_results": 5}, ctx))
    assert "联网搜索失败" in result
    assert "ddg 抓取失败" in result
    # 验证 _unconfigured_message 未被使用（全败时是错误信息而非"未配置"提示）
    assert "未配置" not in result
    assert "内置免费搜索" not in result


# ---------------------------------------------------------------- _configured_providers 的 html 处理

def test_configured_providers_no_keys_appends_html():
    with patch.dict(os.environ, {}, clear=True):
        assert _configured_providers() == ["html"]


def test_configured_providers_with_keys_keeps_html_last():
    with patch.dict(os.environ, {"TAVILY_API_KEY": "t", "EXA_API_KEY": "e"}, clear=True):
        assert _configured_providers() == ["tavily", "exa", "html"]


def test_configured_providers_explicit_html():
    with patch.dict(os.environ, {"SEARCH_PROVIDER": "html"}, clear=True):
        assert _configured_providers() == ["html"]


def test_configured_providers_explicit_without_key_falls_back_to_html():
    with patch.dict(os.environ, {"SEARCH_PROVIDER": "tavily"}, clear=True):
        assert _configured_providers() == ["html"]


def test_configured_providers_explicit_with_key_respected_no_html():
    with patch.dict(os.environ, {"SEARCH_PROVIDER": "tavily", "TAVILY_API_KEY": "k"}, clear=True):
        assert _configured_providers() == ["tavily"]
