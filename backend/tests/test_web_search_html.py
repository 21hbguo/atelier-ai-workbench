"""web_search 内置免费搜索（html provider）单元测试（pytest，不依赖数据库/聊天模块）。

覆盖：
1. _parse_bing_html / _parse_ddg_html / _parse_mojeek_html：对样例 HTML 直接解析
   （结构、数量、过滤：非 http 链接、无标题/无链接的块被跳过）；
2. _bing_html / _ddg_html / _mojeek_html：patch _http_get 返回样例 HTML，验证 URL 构造
   （q 编码、cn.bing.com + count 参数、mojeek referer/accept-language 头）、
   max_bytes 限制参数与解析链路；
3. 本地 HTTP server 提供 /bing、/ddg、/mojeek 样例页，真实抓取后验证解析兼容；
4. 降级链：html provider 在 bing 失败时回退 mojeek，mojeek 空时回退 ddg；
   三引擎全败走全败错误路径（不使用 _unconfigured_message 的"未配置"误导文案）；
5. 搜索质量增强栈（移植自 @deepseek-ai/dsh-web-search-html）：tokenize /
   score_query_match / _extract_days_ago / _clean_snippet / _enhance_query 日期落地 /
   _post_process_html 全链路（重排、去重、snippet 清理、过期过滤、topK 截断）；
6. _configured_providers 对 html 的追加 / 显式处理。

异步测试沿用 test_url_fetcher.py 的 _LocalServer + _run helper 风格，
不依赖 pytest-asyncio 插件。
"""
import asyncio
import http.server
import os
import socketserver
import threading
import urllib.parse
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from backend.services.agent.context import AgentContext
from backend.services.agent.tools.web_search import (
    _bing_html,
    _clean_snippet,
    _configured_providers,
    _ddg_html,
    _enhance_query,
    _extract_days_ago,
    _http_get,
    _mojeek_html,
    _parse_bing_html,
    _parse_ddg_html,
    _parse_mojeek_html,
    _post_process_html,
    _score_query_match,
    _tokenize,
    web_search_search,
)

# 样例：真实结构的最小 Bing 结果页。
# 2 个正常 b_algo 结果块（h2>a 标题 + p 描述；第 1 块 li 带真实页面的裸属性 data-id）、
# 1 个广告块（无 h2）、1 个非 http 链接块、1 个相对路径链接块、1 个无链接块
# —— 后三者应被解析过滤。
BING_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head><title>pytest 样例 - Bing</title></head>
<body>
<ol id="b_results">
  <li class="b_algo" data-id iid=SERP.5334>
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

# 样例：真实结构的最小 Mojeek 结果页。
# ul.results-standard 内 2 个正常块（a.title 形态 / h2 a 形态）+ 1 个非法链接块，
# ul.results 内 1 个块 —— 非法链接块应被过滤，其余 3 条应被解析。
MOJEEK_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head><title>Mojeek - pytest 样例</title></head>
<body>
<ul class="results-standard">
  <li>
    <a class="title" href="https://mojeek.example.com/a">Mojeek 结果一</a>
    <p class="s">这是 Mojeek 第一条结果的摘要文本。</p>
  </li>
  <li>
    <h2><a href="https://mojeek.example.org/b">Mojeek 结果二</a></h2>
    <p class="s">第二条摘要：含 &amp; 实体。</p>
  </li>
  <li>
    <a class="title" href="javascript:void(0)">非法链接</a>
    <p class="s">应被过滤。</p>
  </li>
</ul>
<ul class="results">
  <li>
    <a class="title" href="https://mojeek.example.net/c">结果三</a>
    <p class="s">位于 ul.results 列表中的结果。</p>
  </li>
</ul>
</body>
</html>"""


def _run(coro):
    """同步跑协程（对应 test_url_fetcher.py 的 _run helper）。"""
    return asyncio.run(coro)


class _Handler(http.server.BaseHTTPRequestHandler):
    """本地样例页：/bing、/ddg、/mojeek 返回对应最小结果页，/redirect 301 到 /bing，其余 404。"""

    def do_GET(self):  # noqa: N802 - http.server 协议方法名
        if self.path.startswith("/bing"):
            self._respond(200, BING_HTML.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path.startswith("/ddg"):
            self._respond(200, DDG_HTML.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path.startswith("/mojeek"):
            self._respond(200, MOJEEK_HTML.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path.startswith("/redirect"):
            self.send_response(301)
            self.send_header("Location", "/bing")
            self.send_header("Content-Length", "0")
            self.end_headers()
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


# ---------------------------------------------------------------- _parse_mojeek_html

def test_parse_mojeek_html():
    results = _parse_mojeek_html(MOJEEK_HTML, 10)
    assert len(results) == 3  # 非法链接块被过滤；ul.results-standard 2 条 + ul.results 1 条
    assert results[0] == {
        "title": "Mojeek 结果一",
        "url": "https://mojeek.example.com/a",
        "description": "这是 Mojeek 第一条结果的摘要文本。",
    }
    # h2 a 形态（无 title class）+ 实体解码
    assert results[1]["title"] == "Mojeek 结果二"
    assert results[1]["url"] == "https://mojeek.example.org/b"
    assert results[1]["description"] == "第二条摘要：含 & 实体。"
    # ul.results 列表形态
    assert results[2]["url"] == "https://mojeek.example.net/c"
    assert results[2]["description"] == "位于 ul.results 列表中的结果。"


def test_parse_mojeek_html_limit_n():
    assert len(_parse_mojeek_html(MOJEEK_HTML, 1)) == 1
    assert _parse_mojeek_html(MOJEEK_HTML, 1)[0]["url"] == "https://mojeek.example.com/a"


def test_parse_mojeek_html_bad_input():
    assert _parse_mojeek_html("", 10) == []
    assert _parse_mojeek_html("<html>无结果结构</html>", 10) == []
    assert _parse_mojeek_html(None, 10) == []


# ---------------------------------------------------------------- _bing_html / _ddg_html / _mojeek_html 抓取链路

def test_bing_html_requests_and_parses():
    fake_get = AsyncMock(return_value={"html": BING_HTML})
    with patch("backend.services.agent.tools.web_search._http_get", new=fake_get) as m:
        results = _run(_bing_html("pytest 免费搜索", 10))
    # URL 构造：cn.bing.com + query 经 urllib.parse.quote 编码 + count 扩大候选池
    url = m.await_args.args[0]
    assert url.startswith("https://cn.bing.com/search?q=")
    assert "pytest 免费搜索" in urllib.parse.unquote(url)
    assert url.endswith("&count=20")  # N=min(max(10*2,10),30)=20
    # accept-language 头
    headers = m.await_args.kwargs.get("headers") or {}
    assert headers.get("accept-language") == "zh-CN,zh;q=0.9,en;q=0.8"
    # 响应体大小上限参数生效（2MB）
    assert m.await_args.kwargs.get("max_bytes") == 2 * 1024 * 1024
    # 跟随重定向（cn.bing.com 在非 CN 网络 301 到 www.bing.com，生产环境实测）
    assert m.await_args.kwargs.get("follow_redirects") is True
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
    assert m.await_args.kwargs.get("follow_redirects") is True
    assert len(results) == 2
    assert results[1]["url"] == "https://ddg.example.org/news/2"


def test_mojeek_html_requests_and_parses():
    fake_get = AsyncMock(return_value={"html": MOJEEK_HTML})
    with patch("backend.services.agent.tools.web_search._http_get", new=fake_get) as m:
        results = _run(_mojeek_html("pytest 免费搜索", 10))
    url = m.await_args.args[0]
    assert url.startswith("https://www.mojeek.com/search?q=")
    assert "pytest 免费搜索" in urllib.parse.unquote(url)
    # referer + accept-language 头
    headers = m.await_args.kwargs.get("headers") or {}
    assert headers.get("referer") == "https://www.mojeek.com/"
    assert headers.get("accept-language") == "zh-CN,zh;q=0.9,en;q=0.8"
    assert m.await_args.kwargs.get("max_bytes") == 2 * 1024 * 1024
    assert m.await_args.kwargs.get("follow_redirects") is True
    assert len(results) == 3
    assert results[0]["url"] == "https://mojeek.example.com/a"


def test_parse_real_html_from_local_server(server):
    """端到端：真实 HTTP 抓取本地样例页（Bing/DDG/Mojeek 结构）后解析。"""
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


def test_http_get_follows_redirects(server):
    """真实端到端：301 重定向在 follow_redirects=True 时被跟随并拿到目标页。

    对应生产环境实测：非 CN 网络下 cn.bing.com 301 到 www.bing.com，
    html 引擎必须跟随重定向才能拿到结果页。
    """
    data = _run(_http_get(server.base + "/redirect", max_bytes=1024 * 1024, follow_redirects=True))
    assert "示例文章一" in data.get("html", "")
    # 不跟随时 301 直接抛 HTTPStatusError（_bing_html 等显式传 True 才跟随）
    with pytest.raises(httpx.HTTPStatusError):
        _run(_http_get(server.base + "/redirect", max_bytes=1024 * 1024))

    resp = httpx.get(server.base + "/mojeek")
    assert resp.status_code == 200
    results = _parse_mojeek_html(resp.text, 10)
    assert len(results) == 3
    assert results[0]["title"] == "Mojeek 结果一"
    assert results[2]["url"] == "https://mojeek.example.net/c"


# ---------------------------------------------------------------- 搜索质量增强栈：tokenize

def test_tokenize():
    # CJK：单字符 + 相邻双字 bigram
    assert _tokenize("人工智能") == ["人", "工", "智", "能", "人工", "工智", "智能"]
    # 非 CJK：按 [^a-z0-9]+ 分词并转小写
    assert _tokenize("Hello, World!") == ["hello", "world"]
    assert _tokenize("OpenAI GPT-4") == ["openai", "gpt", "4"]
    # 混合：CJK 段（字符+bigram）在前、英文词在后（与 DSH tokenize 顺序一致）
    assert _tokenize("AI人工智能") == ["人", "工", "智", "能", "人工", "工智", "智能", "ai"]
    # 空输入
    assert _tokenize("") == []
    assert _tokenize(None) == []


# ---------------------------------------------------------------- 搜索质量增强栈：score_query_match

def test_score_query_match():
    # phrase 命中 title +6；token 命中率 title*8 + snippet*4
    assert _score_query_match("alpha beta", "", "", "alpha beta") == 14.0
    # phrase 命中 snippet +3
    assert _score_query_match("gamma delta", "", "alpha beta", "alpha beta") == 7.0
    # phrase 命中 url +2
    assert _score_query_match("x y", "https://example.com/alpha-beta", "", "example") == 2.0
    # title 权重大于 snippet 权重（相同 token 命中，title 侧分数更高）
    title_side = _score_query_match("alpha beta", "", "gamma delta", "alpha beta")
    snippet_side = _score_query_match("gamma delta", "", "alpha beta", "alpha beta")
    assert title_side > snippet_side
    # 无可匹配 token（空 query）→ 0
    assert _score_query_match("any", "http://x", "snippet", "") == 0.0


# ---------------------------------------------------------------- 搜索质量增强栈：_extract_days_ago

def test_extract_days_ago():
    now = datetime(2026, 8, 16).timestamp()  # 固定 2026-08-16 00:00 便于精确断言
    # 相对时间（单位→天；分数天数用 approx 容差）
    assert _extract_days_ago("3天前", now) == 3.0
    assert _extract_days_ago("5 分钟之前", now) == pytest.approx(5 / 1440)
    assert _extract_days_ago("2小时前", now) == pytest.approx(2 / 24)
    assert _extract_days_ago("1周前", now) == 7.0
    assert _extract_days_ago("2个月前", now) == 60.0
    assert _extract_days_ago("1年前", now) == 365.0
    # 绝对日期：年/./- 三种分隔
    assert _extract_days_ago("2026年8月10日发布", now) == 6.0
    assert _extract_days_ago("2026-08-10", now) == 6.0
    assert _extract_days_ago("2026.8.10", now) == 6.0
    assert _extract_days_ago("2026/8/10", now) == 6.0
    # 月日：按今年；未来超过 60 天回滚一年
    assert _extract_days_ago("8月10日", now) == 6.0
    assert _extract_days_ago("12月1日", now) == 258.0  # 2026-12-01 超 60 天 → 回滚 2025-12-01
    # 相对词
    assert _extract_days_ago("今天发布了", now) == 0.0
    assert _extract_days_ago("昨天更新", now) == 1.0
    assert _extract_days_ago("前天上线", now) == 2.0
    # 无线索 → None
    assert _extract_days_ago("没有任何日期线索", now) is None
    assert _extract_days_ago("", now) is None


# ---------------------------------------------------------------- 搜索质量增强栈：_clean_snippet

def test_clean_snippet():
    assert _clean_snippet("3天前 · 人工智能最新进展") == "人工智能最新进展"
    assert _clean_snippet("2小时前: 内容标题") == "内容标题"
    assert _clean_snippet("5 小时之前，内容") == "内容"
    assert _clean_snippet("1周前-内容") == "内容"
    assert _clean_snippet("  多   个  空白  ") == "多 个 空白"  # 压缩空白
    assert _clean_snippet("无前缀内容") == "无前缀内容"  # 无前缀原样
    assert _clean_snippet("") == ""


# ---------------------------------------------------------------- 搜索质量增强栈：_enhance_query 日期落地

def test_enhance_query_news_dates():
    now = datetime.now()
    today = f"{now.year}年{now.month}月{now.day}日"
    yesterday = now - timedelta(days=1)
    ys = f"{yesterday.year}年{yesterday.month}月{yesterday.day}日"
    tomorrow = now + timedelta(days=1)
    ts = f"{tomorrow.year}年{tomorrow.month}月{tomorrow.day}日"
    # 裸宽泛新闻词分支保留：「今天新闻」→ 今日要闻 + 今天日期
    assert _enhance_query("今天新闻") == f"{today} 今日要闻 头条"
    # 新闻意图 + 昨天/明天 → 落地为具体日期
    out = _enhance_query("昨天 OpenAI 明天 发布会 新闻")
    assert ys in out and ts in out
    assert "昨天" not in out and "明天" not in out
    # 新闻词但无日期 → 追加今天日期
    assert _enhance_query("人工智能 新闻").endswith(today)
    # 非新闻词原样
    assert _enhance_query("Python 教程") == "Python 教程"
    assert _enhance_query("") == ""


# ---------------------------------------------------------------- 搜索质量增强栈：_post_process_html 全链路

def test_post_process_html_full_chain():
    """低相关在前 → 重排后高相关在前；标题去重；snippet 清理；短 snippet 置空；topK 截断。"""
    items = [
        {"title": "无关结果标题", "url": "https://a.example.com/1",
         "description": "3天前 · 这是与查询完全无关的描述文本内容。"},
        {"title": "人工智能 新闻 标题", "url": "https://b.example.com/2",
         "description": "2小时前 · 人工智能 最新进展 新闻报道内容。"},
        {"title": "无关结果标题", "url": "https://c.example.com/3",
         "description": "重复标题应被去重丢弃。"},
        {"title": "短摘要", "url": "https://d.example.com/4",
         "description": "短"},
        {"title": "第五个结果", "url": "https://e.example.com/5",
         "description": "第五个结果的描述文本内容。"},
    ]
    out = _post_process_html(items, "人工智能 新闻", top_k=3)
    assert len(out) == 3  # topK 截断
    assert out[0]["url"] == "https://b.example.com/2"  # 高相关在前（原排在第二位）
    assert out[0]["description"].startswith("人工智能")  # "2小时前 · " 前缀被清理
    # 标题去重：重复标题只保留一条
    assert [it["title"] for it in out].count("无关结果标题") == 1
    # 短摘要（清理后 <10 字符）→ description 置空（键保留）
    short = next(it for it in out if it["title"] == "短摘要")
    assert short["description"] == ""
    # 结果字段契约：title/url/description
    assert set(out[0].keys()) == {"title", "url", "description"}


def test_post_process_html_stale_filter():
    """SEARCH_FILTER_STALE_DAYS>0 时丢弃有解析年龄且超限的结果，无解析年龄的保留。"""
    items = [
        {"title": "三天前的旧闻", "url": "https://s.example.com/1",
         "description": "3天前 旧闻内容描述文本。"},
        {"title": "今天的新闻", "url": "https://s.example.com/2",
         "description": "今天 新内容描述文本。"},
        {"title": "无日期线索", "url": "https://s.example.com/3",
         "description": "没有日期线索的普通描述文本。"},
    ]
    with patch.dict(os.environ, {"SEARCH_FILTER_STALE_DAYS": "2"}):
        out = _post_process_html(items, "新闻", top_k=10)
    urls = [it["url"] for it in out]
    assert "https://s.example.com/1" not in urls  # 3 天前 > 2 天 → 丢弃
    assert "https://s.example.com/2" in urls     # 今天（0 天）→ 保留
    assert "https://s.example.com/3" in urls     # 无解析年龄 → 保留


# ---------------------------------------------------------------- 降级链（web_search_search 主循环）

def test_html_provider_fallback_chain():
    """bing 抓取异常 → 自动回退 mojeek → 成功返回并上报引用（ddg 不再被调用）。"""
    ctx = AgentContext()
    items = [
        {"title": "Mojeek 兜底结果", "url": "https://mojeek-fallback.example.com/x",
         "description": "这是 Mojeek 兜底结果的描述文本内容。"},
    ]
    with patch("backend.services.agent.tools.web_search._configured_providers",
               return_value=["html"]), \
         patch("backend.services.agent.tools.web_search._acquire_global_slot",
               new=AsyncMock(return_value=True)), \
         patch("backend.services.agent.tools.web_search._bing_html",
               new=AsyncMock(side_effect=RuntimeError("bing 抓取失败"))), \
         patch("backend.services.agent.tools.web_search._mojeek_html",
               new=AsyncMock(return_value=items)), \
         patch("backend.services.agent.tools.web_search._ddg_html",
               new=AsyncMock()) as m_ddg:
        result = _run(web_search_search({"query": "pytest html 兜底链测试", "max_results": 5}, ctx))
    m_ddg.assert_not_awaited()
    assert "https://mojeek-fallback.example.com/x" in result
    assert "Mojeek 兜底结果" in result
    assert ctx.citations == [{"url": "https://mojeek-fallback.example.com/x",
                              "title": "Mojeek 兜底结果",
                              "snippet": "这是 Mojeek 兜底结果的描述文本内容。"}]


def test_html_provider_fallback_chain_mojeek_to_ddg():
    """bing 与 mojeek 均为空 → 回退 ddg（第三兜底）→ 成功。"""
    ctx = AgentContext()
    items = [
        {"title": "DDG 第三兜底", "url": "https://ddg-third.example.com/y",
         "description": "这是 DuckDuckGo 第三兜底的描述文本内容。"},
    ]
    with patch("backend.services.agent.tools.web_search._configured_providers",
               return_value=["html"]), \
         patch("backend.services.agent.tools.web_search._acquire_global_slot",
               new=AsyncMock(return_value=True)), \
         patch("backend.services.agent.tools.web_search._bing_html",
               new=AsyncMock(return_value=[])), \
         patch("backend.services.agent.tools.web_search._mojeek_html",
               new=AsyncMock(return_value=[])), \
         patch("backend.services.agent.tools.web_search._ddg_html",
               new=AsyncMock(return_value=items)):
        result = _run(web_search_search({"query": "pytest html 三级兜底测试", "max_results": 5}, ctx))
    assert "https://ddg-third.example.com/y" in result
    assert "DDG 第三兜底" in result


def test_html_provider_both_fail():
    """bing 空、mojeek 与 ddg 都失败 → 走"全部供应商失败"错误路径，不使用"未配置"误导文案。"""
    ctx = AgentContext()
    with patch("backend.services.agent.tools.web_search._configured_providers",
               return_value=["html"]), \
         patch("backend.services.agent.tools.web_search._acquire_global_slot",
               new=AsyncMock(return_value=True)), \
         patch("backend.services.agent.tools.web_search._bing_html",
               new=AsyncMock(return_value=[])), \
         patch("backend.services.agent.tools.web_search._mojeek_html",
               new=AsyncMock(side_effect=RuntimeError("mojeek 抓取失败"))), \
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
