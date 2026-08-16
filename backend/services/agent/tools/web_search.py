"""web_search 工具：多供应商联网搜索（tavily / exa / serper / brave / searxng / html）。

环境变量配置（可同时配置多个，自动按优先级故障转移）：
- TAVILY_API_KEY: Tavily 云搜索（api.tavily.com）
- EXA_API_KEY: Exa 云搜索（api.exa.ai）
- SERPER_API_KEY: Serper 云搜索（google.serper.dev）
- BRAVE_API_KEY: Brave 云搜索（api.search.brave.com）
- SEARXNG_URL: 自建 searxng 实例地址（如 https://searx.example.com，仅内网/公网可达时可用）

兼容旧配置：
- SEARCH_PROVIDER: serper | brave | tavily | searxng | html（显式指定单一供应商时仅用该供应商）
- SEARCH_API_KEY: 指定供应商时的通用 key（新配置优先用各自独立 key）

内置免费搜索兜底（provider "html"）：即使一个 key 都没配置也能搜索——直接抓取
Bing（cn.bing.com）/ Mojeek / DuckDuckGo 的免费 HTML 结果页并解析链接，再经
搜索质量增强栈（时效标注/过滤、重排、去重、摘要清理，移植自
@deepseek-ai/dsh-web-search-html）提升结果质量。它始终排在降级链最后一环，
稳定性与结果质量不如专用搜索 API。统一返回 "标题 — url\n描述" 列表文本。
"""
from __future__ import annotations

import asyncio
import base64
import html as html_lib
import logging
import os
import re
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx

from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool

logger = logging.getLogger(__name__)

_SEARCH_TIMEOUT = 15.0
_MAX_RESULTS = 10  # 单次搜索条数上限，防滥用

# 请求 searxng/云搜索时使用浏览器 UA（防未来启用 searxng limiter 时的 UA 检测拦截，
# 也避免部分上游按 UA 识别自动化请求）
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# ---- 每用户限流（进程内滑动窗口）----
# 聊天场景下同一次 agent 运行已有 SEARCH_MAX_PER_RUN 上限（默认 2 次/轮），
# 这里再按用户做全局兜底：防止高频追问/多会话并发打爆上游引擎（bing 密集请求会触发降级窗口）。
# SEARCH_RATE_PER_MINUTE 可调，默认 3 次/分钟。
_RATE_PER_MINUTE = max(1, int(os.getenv("SEARCH_RATE_PER_MINUTE", "3")))
_RATE_WINDOW_SEC = 60
_rate_windows: dict[int, deque] = {}  # user_id -> deque[timestamp]
_rate_lock = threading.Lock()

# ---- 结果缓存（相同 query 短 TTL，命中不消耗搜索次数）----
# SEARCH_CACHE_TTL 秒内相同关键词直接复用结果，显著降低上游请求频率。
# 缓存同时保存原始结果 items，供缓存命中时上报来源引用（citations）。
_CACHE_TTL = max(0, int(os.getenv("SEARCH_CACHE_TTL", "300")))
_cache: dict[str, tuple[float, str, list[dict]]] = {}  # key -> (expire_ts, 格式化结果, 原始 items)
_cache_lock = threading.Lock()

# ---- 全局上游保护（防上游封禁的核心，进程内共享；单进程 uvicorn 部署）----
# 无论多少用户，对上游（searxng → bing）的真实请求总量被钉在安全线内：
# 1) 令牌桶：全局请求速率上限（默认 45 次/分钟，bing 安全线 60/min 留 25% 余量）
# 2) 并发信号量：同时最多 N 个真实上游请求（防突发堆积）
# 3) 熔断器：连续失败达阈值 → 短时打开，期间快速失败（不再打上游）
# 4) 限流等待：令牌不足时最多等 _GLOBAL_WAIT_SECONDS 秒（保体验），超时返回繁忙提示
_GLOBAL_RATE_PER_MINUTE = max(1, int(os.getenv("SEARCH_GLOBAL_RATE_PER_MINUTE", "45")))
_MAX_CONCURRENCY = max(1, int(os.getenv("SEARCH_MAX_CONCURRENCY", "3")))
_BREAKER_FAIL_THRESHOLD = max(1, int(os.getenv("SEARCH_BREAKER_THRESHOLD", "5")))
_BREAKER_OPEN_SECONDS = max(5, int(os.getenv("SEARCH_BREAKER_OPEN_SECONDS", "60")))
_GLOBAL_WAIT_SECONDS = 2.0

_token_rate = _GLOBAL_RATE_PER_MINUTE / 60.0  # 令牌/秒
_token_capacity = max(3.0, _GLOBAL_RATE_PER_MINUTE / 20.0)  # 突发容量
_tokens = float(_token_capacity)
_last_token_ts = time.monotonic()
_token_lock = threading.Lock()

_global_semaphore: "asyncio.Semaphore | None" = None

# 熔断器状态
_breaker_failures = 0
_breaker_open_until = 0.0
_breaker_lock = threading.Lock()

# 供应商 → 独立 key 环境变量（缺失的供应商自动跳过）
_PROVIDER_ENV = {
    "tavily": "TAVILY_API_KEY",
    "exa": "EXA_API_KEY",
    "serper": "SERPER_API_KEY",
    "brave": "BRAVE_API_KEY",
    "searxng": "SEARXNG_URL",
}
# 默认启用顺序（也可用 SEARCH_PROVIDERS 显式指定顺序）；"html" 为内置免费搜索兜底，
# 始终排在最后（见 _configured_providers）
_DEFAULT_PROVIDER_ORDER = ("tavily", "exa", "serper", "brave", "searxng", "html")


def _configured_providers() -> list[str]:
    """返回可用的供应商列表：
    1) SEARCH_PROVIDER 显式指定时仅用该供应商（兼容旧配置，key 回退 SEARCH_API_KEY）；
       显式指定了供应商但没配 key 时，回退到内置免费搜索 ["html"]（保证无 key 也能搜）；
       显式指定 "html" 时直接返回 ["html"]；
    2) 否则按默认顺序自动检测已配置独立 key 的供应商（SEARCH_PROVIDERS 可自定义顺序），
       并在列表尾部【总是】追加 "html" 作为最后一环兜底（无 key 也能搜索）。
    """
    explicit = str(os.getenv("SEARCH_PROVIDER") or "").strip().lower()
    if explicit:
        if explicit == "html":
            return ["html"]
        if explicit in _PROVIDER_ENV:
            key_env = _PROVIDER_ENV[explicit]
            if os.getenv(key_env) or os.getenv("SEARCH_API_KEY"):
                return [explicit]  # 显式配置了 key → 尊重显式配置，不追加 html
        # 显式指定了供应商但没配 key → 用内置免费搜索兜底
        return ["html"]
    order_env = str(os.getenv("SEARCH_PROVIDERS") or "").strip()
    if order_env:
        order = [s.strip().lower() for s in order_env.split(",") if s.strip()]
    else:
        order = list(_DEFAULT_PROVIDER_ORDER)
    providers = [p for p in order if p in _PROVIDER_ENV and os.getenv(_PROVIDER_ENV[p])]
    # 无论是否配置了 key，尾部总是追加内置免费搜索（无 key 时的最后兜底；
    # SEARCH_PROVIDERS 显式包含 html 时已在上面的过滤中被剔除，这里统一补在最后）
    if "html" not in providers:
        providers.append("html")
    return providers


def _max_search_per_run() -> int:
    """单次 agent 运行（run_agent_stream）的搜索次数上限，默认 2，SEARCH_MAX_PER_RUN 可调。"""
    try:
        v = int(os.getenv("SEARCH_MAX_PER_RUN") or "2")
    except (TypeError, ValueError):
        v = 2
    return max(1, min(v, 10))


def _unconfigured_message() -> str:
    return (
        "未配置任何搜索服务 API key：将使用内置免费搜索（抓取 Bing/Mojeek/DuckDuckGo 结果页），"
        "其稳定性与结果质量不如专用搜索 API。建议配置 TAVILY_API_KEY（Tavily）、"
        "EXA_API_KEY（Exa）、SERPER_API_KEY（Serper）、BRAVE_API_KEY（Brave）或 "
        "SEARXNG_URL（自建 searxng 实例）以获得更稳定可靠的搜索。"
    )


async def _http_get(url: str, *, headers: dict | None = None, params: dict | None = None,
                  max_bytes: int | None = None) -> dict:
    h = dict(headers or {})
    h.setdefault("User-Agent", _BROWSER_UA)
    async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
        if max_bytes is not None:
            # HTML 结果页：流式读取并限制响应体大小（超过 max_bytes 即截断，
            # 防止上游返回超大页面占用内存/带宽），返回 {"html": 文本} 供解析
            chunks: list[bytes] = []
            size = 0
            async with client.stream("GET", url, headers=h, params=params) as resp:
                resp.raise_for_status()
                async for chunk in resp.aiter_bytes():
                    chunks.append(chunk)
                    size += len(chunk)
                    if size >= max_bytes:
                        break
            text = b"".join(chunks).decode(resp.encoding or "utf-8", errors="replace")
            return {"html": text[:max_bytes]}
        resp = await client.get(url, headers=h, params=params)
        resp.raise_for_status()
        return resp.json()


async def _http_post(url: str, *, headers: dict | None = None, json_body: dict | None = None) -> dict:
    h = dict(headers or {})
    h.setdefault("User-Agent", _BROWSER_UA)
    async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
        resp = await client.post(url, headers=h, json=json_body)
        resp.raise_for_status()
        return resp.json()


async def _serper(query: str, api_key: str, n: int) -> list[dict]:
    data = await _http_post(
        "https://google.serper.dev/search",
        headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
        json_body={"q": query, "num": n},
    )
    out = []
    for r in (data.get("organic") or [])[:n]:
        out.append({
            "title": str(r.get("title") or ""),
            "url": str(r.get("link") or ""),
            "description": str(r.get("snippet") or ""),
        })
    return out


async def _brave(query: str, api_key: str, n: int) -> list[dict]:
    data = await _http_get(
        "https://api.search.brave.com/res/v1/web/search",
        headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
        params={"q": query, "count": n},
    )
    out = []
    for r in ((data.get("web") or {}).get("results") or [])[:n]:
        out.append({
            "title": str(r.get("title") or ""),
            "url": str(r.get("url") or ""),
            "description": str(r.get("description") or ""),
        })
    return out


async def _tavily(query: str, api_key: str, n: int) -> list[dict]:
    data = await _http_post(
        "https://api.tavily.com/search",
        json_body={"api_key": api_key, "query": query, "max_results": n},
    )
    out = []
    for r in (data.get("results") or [])[:n]:
        out.append({
            "title": str(r.get("title") or ""),
            "url": str(r.get("url") or ""),
            "description": str(r.get("content") or ""),
        })
    return out


async def _exa(query: str, api_key: str, n: int) -> list[dict]:
    data = await _http_post(
        "https://api.exa.ai/search",
        headers={"x-api-key": api_key, "Content-Type": "application/json"},
        json_body={"query": query, "numResults": n},
    )
    out = []
    for r in (data.get("results") or [])[:n]:
        out.append({
            "title": str(r.get("title") or ""),
            "url": str(r.get("url") or ""),
            "description": str(r.get("text") or r.get("highlight") or ""),
        })
    return out


async def _searxng(query: str, base_url: str, n: int) -> list[dict]:
    base = str(base_url or "").rstrip("/")
    data = await _http_get(f"{base}/search", params={"q": query, "format": "json"})
    out = []
    for r in (data.get("results") or [])[:n]:
        out.append({
            "title": str(r.get("title") or ""),
            "url": str(r.get("url") or ""),
            "description": str(r.get("content") or ""),
        })
    return out


# ---------- 内置免费搜索兜底（provider "html"）：抓取 Bing / Mojeek / DuckDuckGo 免费 HTML 结果页 ----------
# 无任何 API key 时的最后一环。页面结构随时可能变，解析失败时返回 []（外层视为该引擎失败），
# 三引擎都失败则走主循环的"全部供应商失败"逻辑。抓取到的原始结果会经下方「搜索质量增强栈」
# 后处理（时效标注/过滤、重排、去重、摘要清理）。限流/缓存/熔断由外层统一生效，这里不重复实现。

_HTML_MAX_BYTES = 2 * 1024 * 1024  # 抓取 HTML 结果页的响应体大小上限（约 2MB，超出截断）


def _strip_html_tags(s: str) -> str:
    """去掉 HTML 标签并解码实体，返回纯文本。"""
    s = re.sub(r"<[^>]+>", "", s or "")
    return html_lib.unescape(s).strip()


_BING_BLOCK_RE = re.compile(r'<li[^>]*\bclass="[^"]*\bb_algo\b[^"]*"[^>]*>(.*?)</li>', re.S)
_BING_TITLE_RE = re.compile(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>\s*</h2>', re.S)
_BING_DESC_RE = re.compile(r'<p[^>]*>(.*?)</p>', re.S)


def _bing_real_url(href: str) -> str:
    """Bing 部分结果使用 ck/a 跳转链接（u 参数为 base64 编码的真实地址），尝试解回真实 URL。"""
    if not href.startswith("https://www.bing.com/ck/a"):
        return href
    m = re.search(r"[?&]u=([^&]+)", href)
    if not m:
        return href
    try:
        decoded = base64.urlsafe_b64decode(m.group(1) + "==")
        real = decoded.decode("utf-8", errors="replace")
    except Exception:
        return href
    if real.startswith(("http://", "https://")):
        return real
    return href


def _parse_bing_html(html_text: str, n: int) -> list[dict]:
    """解析 Bing 搜索结果页（cn.bing.com/search?q=）：识别 <li class="b_algo"> 结果块。

    提取 title（<h2><a>…</a></h2>）、url（href，仅 http/https）、description（<p>…</p>），
    返回最多 n 条 [{"title", "url", "description"}]；广告块/无 h2 标题、非 http 链接、
    无链接的块被跳过；解析失败返回 []。
    """
    out: list[dict] = []
    for block in _BING_BLOCK_RE.findall(str(html_text or "")):
        m = _BING_TITLE_RE.search(block)
        if not m:
            continue  # 广告块或无 h2 标题的块
        href = _bing_real_url(m.group(1))
        if not href.startswith(("http://", "https://")):
            continue
        dm = _BING_DESC_RE.search(block)
        out.append({
            "title": _strip_html_tags(m.group(2)),
            "url": href,
            "description": _strip_html_tags(dm.group(1)) if dm else "",
        })
        if len(out) >= n:
            break
    return out


_DDG_TITLE_RE = re.compile(
    r'<a[^>]*rel="nofollow"[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S
)
_DDG_SNIPPET_RE = re.compile(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', re.S)


def _parse_ddg_html(html_text: str, n: int) -> list[dict]:
    """解析 DuckDuckGo HTML 结果页（html.duckduckgo.com/html/?q=）。

    每个结果由 <a rel="nofollow" class="result__a" href>（标题链接）标识，
    摘要取紧随其后的 <a class="result__snippet">；非 http 链接跳过；
    返回最多 n 条 [{"title", "url", "description"}]，解析失败返回 []。
    """
    title_matches = list(_DDG_TITLE_RE.finditer(str(html_text or "")))
    snippet_matches = list(_DDG_SNIPPET_RE.finditer(str(html_text or "")))
    out: list[dict] = []
    si = 0
    for tm in title_matches:
        href = tm.group(1)
        if not href.startswith(("http://", "https://")):
            continue
        while si < len(snippet_matches) and snippet_matches[si].start() < tm.end():
            si += 1  # 跳过出现在该标题之前的 snippet（属于更早的结果）
        desc = ""
        if si < len(snippet_matches):
            desc = _strip_html_tags(snippet_matches[si].group(1))
            si += 1
        out.append({"title": _strip_html_tags(tm.group(2)), "url": href, "description": desc})
        if len(out) >= n:
            break
    return out


async def _bing_html(query: str, n: int) -> list[dict]:
    """抓取 Bing 搜索结果页并解析（cn.bing.com：CN 可达且返回 raw URL，_bing_real_url 的 ck/a 解码仍保留作兜底）。

    count 参数按 N=min(max(n*2,10),30) 扩大候选池，给后处理重排留空间；解析上限取 count。
    _http_get 已带浏览器 UA 与超时；max_bytes 限制响应体。
    """
    count = min(max(n * 2, 10), 30)
    url = f"https://cn.bing.com/search?q={quote(query)}&count={count}"
    data = await _http_get(
        url,
        headers={"accept-language": "zh-CN,zh;q=0.9,en;q=0.8"},
        max_bytes=_HTML_MAX_BYTES,
    )
    html_text = data.get("html") if isinstance(data, dict) else str(data)
    return _parse_bing_html(html_text, count)


async def _ddg_html(query: str, n: int) -> list[dict]:
    """抓取 DuckDuckGo HTML 结果页并解析（_http_get 已带浏览器 UA 与超时；max_bytes 限制响应体）。"""
    url = "https://html.duckduckgo.com/html/?q=" + quote(query)
    data = await _http_get(url, max_bytes=_HTML_MAX_BYTES)
    html_text = data.get("html") if isinstance(data, dict) else str(data)
    return _parse_ddg_html(html_text, n)


_MOJEEK_UL_RE = re.compile(r'<ul[^>]*class="([^"]*)"[^>]*>(.*?)</ul>', re.S)
_MOJEEK_LI_RE = re.compile(r'<li[^>]*>(.*?)</li>', re.S)
_MOJEEK_TITLE_RE = re.compile(
    r'<a\b(?=[^>]*\bclass="[^"]*\btitle\b[^"]*")[^>]*\bhref="([^"]+)"[^>]*>(.*?)</a>', re.S
)
_MOJEEK_H2_TITLE_RE = re.compile(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>\s*</h2>', re.S)
_MOJEEK_SNIPPET_RE = re.compile(
    r'<p\b(?=[^>]*\bclass="[^"]*\bs\b[^"]*")[^>]*>(.*?)</p>', re.S
)


def _parse_mojeek_html(html_text: str, n: int) -> list[dict]:
    """解析 Mojeek 搜索结果页（www.mojeek.com/search?q=，参照 DSH parseMojeekResults）。

    识别 ul.results-standard / ul.results 结果列表，每个 <li> 块取 a.title（或 h2 a）的
    title/url、p.s 的 snippet；非 http 链接跳过、按 url 去重；返回最多 n 条
    [{"title", "url", "description"}]，解析失败返回 []。
    """
    out: list[dict] = []
    seen: set[str] = set()
    for ul_cls, ul_body in _MOJEEK_UL_RE.findall(str(html_text or "")):
        if not re.search(r"\bresults(?:-standard)?\b", ul_cls):
            continue
        for li in _MOJEEK_LI_RE.findall(ul_body):
            m = _MOJEEK_TITLE_RE.search(li) or _MOJEEK_H2_TITLE_RE.search(li)
            if not m:
                continue
            href = m.group(1)
            if not href.startswith(("http://", "https://")) or href in seen:
                continue
            seen.add(href)
            sm = _MOJEEK_SNIPPET_RE.search(li)
            out.append({
                "title": _strip_html_tags(m.group(2)),
                "url": href,
                "description": _strip_html_tags(sm.group(1)) if sm else "",
            })
            if len(out) >= n:
                return out
    return out


async def _mojeek_html(query: str, n: int) -> list[dict]:
    """抓取 Mojeek 搜索结果页并解析（免 key 独立索引；referer + accept-language 头）。

    _http_get 已带浏览器 UA 与超时；max_bytes 限制响应体。
    """
    url = "https://www.mojeek.com/search?q=" + quote(query)
    data = await _http_get(
        url,
        headers={"accept-language": "zh-CN,zh;q=0.9,en;q=0.8", "referer": "https://www.mojeek.com/"},
        max_bytes=_HTML_MAX_BYTES,
    )
    html_text = data.get("html") if isinstance(data, dict) else str(data)
    return _parse_mojeek_html(html_text, n)


# ---------- 搜索质量增强栈（移植自 @deepseek-ai/dsh-web-search-html，MIT License Copyright (c) 2026 DeepSeek）----------
# 对应 DSH 源码：search-provider.ts（postProcess/cleanSnippet/parseMojeekResults/cn.bing.com 端点）、
# query-enhance.ts（enhanceQuery 新闻意图日期落地）、rerank.ts（tokenize/scoreQueryMatch）、
# recency.ts（extractDaysAgo）。作用于 html provider 抓到的原始结果，顺序固定：
# 时效标注 → 可选过期过滤 → 重排（相关性+时效分，稳定排序）→ 标题去重 → 摘要清理 → 截断 topK。

_DAY_SECONDS = 86400.0

_RELATIVE_DAYS_RE = re.compile(r"(\d+)\s*(?:个)?(分钟|小时|天|日|周|月|年)\s*之?前")
_ABSOLUTE_DATE_RE = re.compile(r"(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?")
_MONTH_DAY_RE = re.compile(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日")
_UNIT_TO_DAYS = {"分钟": 1 / 1440, "小时": 1 / 24, "天": 1, "日": 1, "周": 7, "月": 30, "年": 365}
_CJK_RE = re.compile(r"[\u4e00-\u9fff]+")


def _extract_days_ago(text: str, now: float | None = None) -> float | None:
    """从标题/摘要的日期线索估算「多少天前」，无线索返回 None（recency.ts extractDaysAgo 移植）。

    相对时间（N 分钟/小时/天/日/周/月/年前 或 …之前，单位→天：分钟 1/1440、小时 1/24、
    天/日 1、周 7、月 30、年 365）；绝对日期（20xx 年/./- 月/./- 日）；月日（按今年，
    未来超过 60 天回滚一年）；关键词 今天=0/昨天=1/前天=2。now 可注入便于测试。
    """
    text = text or ""
    now = time.time() if now is None else now
    m = _RELATIVE_DAYS_RE.search(text)
    if m:
        days = _UNIT_TO_DAYS.get(m.group(2))
        if days is not None:
            return int(m.group(1)) * days
    m = _ABSOLUTE_DATE_RE.search(text)
    if m:
        d = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        return (now - d.timestamp()) / _DAY_SECONDS
    m = _MONTH_DAY_RE.search(text)
    if m:
        year = datetime.fromtimestamp(now).year
        d = datetime(year, int(m.group(1)), int(m.group(2)))
        # 未来超过 60 天的月日多半是去年的文章仍在浮出，回滚一年
        if d.timestamp() > now + 60 * _DAY_SECONDS:
            d = datetime(year - 1, int(m.group(1)), int(m.group(2)))
        return max(0.0, (now - d.timestamp()) / _DAY_SECONDS)
    if "今天" in text:
        return 0.0
    if "昨天" in text:
        return 1.0
    if "前天" in text:
        return 2.0
    return None


def _tokenize(text: str) -> list[str]:
    """分词（rerank.ts tokenize 移植）：CJK（\\u4e00-\\u9fff）段拆单字符+相邻双字 bigram，
    其余按 [^a-z0-9]+ 分词并转小写。"""
    lower = (text or "").lower()
    tokens: list[str] = []
    for seg in _CJK_RE.findall(lower):
        tokens.extend(seg)
        tokens.extend(seg[i:i + 2] for i in range(len(seg) - 1))
    rest = _CJK_RE.sub(" ", lower)
    tokens.extend(w for w in re.split(r"[^a-z0-9]+", rest) if w)
    return tokens


def _score_query_match(title: str, url: str, snippet: str, query: str) -> float:
    """相关性打分（rerank.ts scoreQueryMatch 移植），越高越相关：

    query 全串 phrase 命中 title+6 / snippet+3 / url+2；title token 命中率*8 +
    snippet token 命中率*4。query 无可匹配 token 时返回 0。
    """
    query_tokens = _tokenize(query)
    if not query_tokens:
        return 0.0
    query_set = set(query_tokens)
    phrase = query.lower().strip()
    title_lower = (title or "").lower()
    snippet_lower = (snippet or "").lower()
    url_lower = (url or "").lower()
    score = 0.0
    if phrase:
        if phrase in title_lower:
            score += 6
        if phrase in snippet_lower:
            score += 3
        if phrase in url_lower:
            score += 2
    title_tokens = _tokenize(title)
    snippet_tokens = _tokenize(snippet)
    title_hits = sum(1 for t in title_tokens if t in query_set)
    snippet_hits = sum(1 for t in snippet_tokens if t in query_set)
    score += (title_hits / max(len(title_tokens), 1)) * 8
    score += (snippet_hits / max(len(snippet_tokens), 1)) * 4
    return score


def _clean_snippet(snippet: str) -> str:
    """清理摘要（cleanSnippet 移植）：去掉开头「N 天前/小时前… ·|:：,，-」前缀并压缩空白。"""
    s = re.sub(r"^\s*\d+\s*(?:分钟|小时|天|日|周|个?月|年)\s*之?前\s*[·|:：,，-]?\s*", "", snippet or "")
    return re.sub(r"\s+", " ", s).strip()


def _post_process_html(items: list[dict], query: str, top_k: int) -> list[dict]:
    """html provider 结果质量后处理（search-provider.ts postProcess 移植，顺序固定）：

    ① 时效标注（extractDaysAgo）→ ② 过期过滤（SEARCH_FILTER_STALE_DAYS>0 时丢弃有解析
    年龄且超限的结果，无解析年龄的保留）→ ③ 重排（相关性分 + 时效分 max(0, 2-daysAgo/7)，
    稳定降序，同分保持引擎原始顺序）→ ④ 标题规范化去重（lower + 去非字母数字，
    isalnum 等价 DSH 的 \\p{L}\\p{N}，中文标题保留）→ ⑤ 摘要清理（去相对时间前缀、压缩
    空白；清理后短于 SEARCH_MIN_SNIPPET_CHARS 的 description 置空，键保留）→ ⑥ 截断 topK。
    返回 [{title, url, description}]（app 内部字段名是 description）。
    """
    # ① 时效标注
    list_: list[dict] = []
    for item in items:
        days = _extract_days_ago(f"{item.get('title') or ''} {item.get('description') or ''}")
        list_.append({**item, "_days_ago": days})
    # ② 可选过期过滤（仅影响有解析年龄的结果）
    try:
        stale_days = int(os.getenv("SEARCH_FILTER_STALE_DAYS", "0") or 0)
    except ValueError:
        stale_days = 0
    if stale_days > 0:
        list_ = [it for it in list_ if it["_days_ago"] is None or it["_days_ago"] <= stale_days]
    # ③ 重排（Python sorted 稳定 → 同分保持引擎原始顺序）
    scored = []
    for it in list_:
        relevance = _score_query_match(it.get("title") or "", it.get("url") or "",
                                       it.get("description") or "", query)
        days = it["_days_ago"]
        recency = 0.0 if days is None else max(0.0, 2 - days / 7)
        scored.append((relevance + recency, it))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    list_ = [it for _, it in scored]
    # ④ 标题规范化去重（key 为空时保留不过滤，同 DSH）
    seen: set[str] = set()
    deduped: list[dict] = []
    for it in list_:
        key = "".join(c for c in (it.get("title") or "").lower() if c.isalnum())
        if not key or key not in seen:
            seen.add(key)
            deduped.append(it)
    list_ = deduped
    # ⑤ 摘要清理（过短置空；_format_results 依赖 description 键存在，不能删键）
    try:
        min_chars = int(os.getenv("SEARCH_MIN_SNIPPET_CHARS", "10") or 10)
    except ValueError:
        min_chars = 10
    cleaned: list[dict] = []
    for it in list_:
        desc = it.get("description") or ""
        if desc:
            c = _clean_snippet(desc)
            it = {**it, "description": c if len(c) >= min_chars else ""}
        cleaned.append(it)
    list_ = cleaned
    # ⑥ 截断 topK，并去掉内部标记字段
    return [{k: v for k, v in it.items() if k != "_days_ago"} for it in list_[:top_k]]


def _rate_limited(user_id: int) -> bool:
    """每用户滑动窗口限流：窗口内搜索次数达到上限返回 True（被限流）。"""
    if user_id is None:
        return False
    now = time.monotonic()
    with _rate_lock:
        q = _rate_windows.get(user_id)
        if q is None:
            q = _rate_windows[user_id] = deque()
        while q and now - q[0] >= _RATE_WINDOW_SEC:
            q.popleft()
        if len(q) >= _RATE_PER_MINUTE:
            return True
        q.append(now)
        return False


# ---------- 全局上游保护 ----------

def _global_wait_seconds() -> float:
    """令牌桶取令牌：返回需要等待的秒数（0 = 立即放行）。"""
    now = time.monotonic()
    with _token_lock:
        global _tokens, _last_token_ts
        _tokens = min(_token_capacity, _tokens + (now - _last_token_ts) * _token_rate)
        _last_token_ts = now
        if _tokens >= 1.0:
            _tokens -= 1.0
            return 0.0
        return (1.0 - _tokens) / _token_rate


def _breaker_is_open() -> bool:
    """熔断器是否处于打开状态（打开期间直接快速失败，不打上游）。"""
    with _breaker_lock:
        return time.monotonic() < _breaker_open_until


def _breaker_record_success() -> None:
    with _breaker_lock:
        global _breaker_failures
        _breaker_failures = 0


def _breaker_record_failure() -> None:
    with _breaker_lock:
        global _breaker_failures, _breaker_open_until
        _breaker_failures += 1
        if _breaker_failures >= _BREAKER_FAIL_THRESHOLD:
            _breaker_open_until = time.monotonic() + _BREAKER_OPEN_SECONDS
            logger.warning(
                "[web_search] 上游连续失败 %d 次，熔断器打开 %ds",
                _breaker_failures, _BREAKER_OPEN_SECONDS,
            )


async def _acquire_global_slot() -> bool:
    """全局放行控制：等令牌 + 等并发位。超时返回 False（本次搜索放弃，不打上游）。

    顺序：熔断检查 → 令牌桶等待（累计最多 _GLOBAL_WAIT_SECONDS）→ 并发信号量。
    """
    global _global_semaphore
    if _breaker_is_open():
        return False
    waited = 0.0
    while True:
        w = _global_wait_seconds()
        if w <= 0:
            break
        if waited + w > _GLOBAL_WAIT_SECONDS:
            return False
        await asyncio.sleep(w)
        waited += w
    sem = _global_semaphore
    if sem is None:
        sem = _global_semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)
    try:
        await asyncio.wait_for(sem.acquire(), timeout=_GLOBAL_WAIT_SECONDS)
    except asyncio.TimeoutError:
        return False
    return True


def _cache_get(key: str) -> str | None:
    """取缓存：命中且未过期返回格式化结果，否则 None。过期条目惰性清理。"""
    if _CACHE_TTL <= 0:
        return None
    now = time.monotonic()
    with _cache_lock:
        item = _cache.get(key)
        if item is None:
            return None
        expire, text, _items = item
        if now >= expire:
            _cache.pop(key, None)
            return None
        return text


def _cache_get_items(key: str) -> list[dict] | None:
    """取缓存中的原始结果 items（供缓存命中时上报来源引用），未命中/过期返回 None。"""
    if _CACHE_TTL <= 0:
        return None
    now = time.monotonic()
    with _cache_lock:
        item = _cache.get(key)
        if item is None:
            return None
        expire, _text, items = item
        if now >= expire:
            _cache.pop(key, None)
            return None
        return items


def _cache_set(key: str, text: str, items: list[dict]) -> None:
    """写缓存；顺手清理过期条目防止无限增长。"""
    if _CACHE_TTL <= 0 or not text:
        return
    with _cache_lock:
        now = time.monotonic()
        # 惰性清理：超过 128 条时清一遍过期项
        if len(_cache) > 128:
            for k in [k for k, (exp, _, _) in _cache.items() if exp <= now]:
                _cache.pop(k, None)
        _cache[key] = (now + _CACHE_TTL, text, items)


def _enhance_query(query: str) -> str:
    """关键词自动增强（硬兜底，不依赖 LLM 自觉构造具体词）。

    规则：
    1. 纯宽泛新闻词（「今天新闻」「今日热点」「最新消息」等）→ 替换为「日期+今日要闻+头条」；
    2. 新闻意图词（新闻/资讯/快讯/日报/早报/晚报/盘点/综述）→ 相对时间词落地为具体日期：
       今天|今日|昨日→今天日期、昨天→昨天日期、明天|明日→明天日期；替换后仍无日期
       （20\\d{2}年 或 20\\d{2}[-/.]\\d{1,2}）→ 追加今天日期（移植自
       @deepseek-ai/dsh-web-search-html query-enhance.ts，日期格式 YYYY年M月D日）；
    3. 含时间敏感词（今天/今日/最新/近期等）但无具体日期 → 自动附加当天日期；
    4. 其他查询保持原样。
    """
    q = query.strip()
    if not q:
        return q
    now = datetime.now()
    today = f"{now.year}年{now.month}月{now.day}日"
    # 纯宽泛新闻词（去掉语气词后只剩 今日/新闻/热点/要闻 等）
    bare = re.sub(r"[?？!！。，,\s]", "", q)
    if re.fullmatch(r"(今天|今日|现在|最新|实时|近期|最近)?(新闻|消息|热点|要闻|资讯|时事|头条)?(是什么|有哪些|有什么|汇总|速览|排行榜)?", bare):
        return f"{today} 今日要闻 头条"
    # 新闻意图 → 相对时间词落地为具体日期（query-enhance.ts 移植）
    if re.search(r"新闻|资讯|快讯|日报|早报|晚报|盘点|综述", q):
        yesterday_dt = now - timedelta(days=1)
        tomorrow_dt = now + timedelta(days=1)
        yesterday = f"{yesterday_dt.year}年{yesterday_dt.month}月{yesterday_dt.day}日"
        tomorrow = f"{tomorrow_dt.year}年{tomorrow_dt.month}月{tomorrow_dt.day}日"
        enhanced = re.sub(r"今天|今日|昨日", today, q)
        enhanced = re.sub(r"昨天", yesterday, enhanced)
        enhanced = re.sub(r"明天|明日", tomorrow, enhanced)
        if not re.search(r"20\d{2}\s*年|20\d{2}[-/.]\d{1,2}", enhanced):
            enhanced = f"{enhanced} {today}"
        return enhanced
    # 时间敏感但无具体日期 → 附加当天日期
    if not re.search(r"\d{4}年|\d{1,2}月\d{1,2}日", q) and re.search(r"今天|今日|现在|最新|实时|近期|最近", q):
        return f"{q} {today}"
    return q


@agent_tool(
    name="web_search",
    description=(
        "联网搜索互联网获取实时信息。搜索关键词构造规则：\n"
        "1. 用简洁具体的关键词（名词+时间/领域/事件限定），如「今日要闻 2026年8月12日」"
        "「A股 今日行情」「OpenAI 最新发布」；\n"
        "2. 避免宽泛词（如「今日新闻」「最新消息」），宽泛话题必须加时间/领域/对象限定，"
        "否则会搜到栏目页而非实时内容；\n"
        "3. 若首次结果不相关或质量差（如多为「xxx首页/栏目/中心/大全」这类聚合栏目页，"
        "而非具体新闻条目），必须换一组【不同的】更具体关键词再搜一次（每轮最多 2 次），"
        "不要用相同关键词重复搜索；\n"
        "4. 一次搜索尽量覆盖所有子问题（合并关键词），不要为同一问题反复搜索。\n"
        "示例：用户问「今天有什么新闻」应搜索「2026年8月12日 今日要闻 头条」"
        "而不是「今天新闻」；问「最近 AI 大事」应搜索「AI 人工智能 最新进展 2026年8月」；"
        "问「股票行情」应搜索「A股 今日行情 涨跌」。\n"
        "返回网页标题、链接与摘要，回答时基于搜索结果并注明来源。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "搜索关键词"},
            "max_results": {"type": "integer", "description": "返回结果条数，默认 5，最大 10"},
        },
        "required": ["query"],
    },
)

async def web_search_search(args: dict, ctx: AgentContext) -> str:
    query = str(args.get("query") or "").strip()
    if not query:
        return "请提供搜索关键词（query 参数）。"
    # 关键词自动增强：宽泛词附加日期/限定（硬兜底，不依赖 LLM 自觉）
    query = _enhance_query(query)
    try:
        max_results = max(1, min(int(args.get("max_results") or 5), _MAX_RESULTS))
    except (TypeError, ValueError):
        max_results = 5

    # 搜索次数限制：同一次 agent 运行（run_agent_stream 共享同一 ctx）最多搜索
    # SEARCH_MAX_PER_RUN 次（默认 2），防无限制搜索浪费 API 额度
    limit = _max_search_per_run()
    used = int(ctx.extra.get("web_search_count", 0) or 0)
    if used >= limit:
        return (
            f"已到达本次对话的联网搜索次数上限（{limit} 次）。"
            "请基于当前已有信息直接回答；如仍确需搜索，请明确告知用户需要额外搜索。"
        )
    ctx.extra["web_search_count"] = used + 1

    # 结果缓存：相同关键词 TTL 内复用（命中不消耗搜索次数与上游请求）
    cache_key = f"{query}|{max_results}"
    cached = _cache_get(cache_key)
    if cached is not None:
        # 缓存命中同样上报来源引用（引用不因缓存而缺失）；items 缺失时回退文本提取
        _report_citations(ctx, _cache_get_items(cache_key) or _extract_citations_from_text(cached))
        return cached

    # 每用户全局限流（滑动窗口）：超限时明确告知，不报错、不消耗更多资源
    user_id = getattr(ctx, "user_id", None)
    if _rate_limited(user_id):
        return (
            f"联网搜索过于频繁（当前限制 {_RATE_PER_MINUTE} 次/分钟），"
            "请稍后再试；可以先基于当前已有信息回答。"
        )

    # 全局上游保护：熔断打开 / 令牌不足 / 并发占满 → 本次放弃（不打上游）
    if not await _acquire_global_slot():
        return (
            "联网搜索服务当前繁忙（上游保护限流），请稍后再试；"
            "可以先基于当前已有信息回答。"
        )
    try:
        providers = _configured_providers()
        if not providers:
            return _unconfigured_message()

        # 按配置顺序逐个尝试，失败自动转移下一个供应商
        errors: list[str] = []
        for provider in providers:
            try:
                if provider == "html":
                    # 内置免费搜索兜底（最后一环）：先 Bing，空/异常则 Mojeek，再空/异常则 DuckDuckGo，
                    # 三引擎皆空/失败才记入 errors 走全败逻辑
                    pool = min(max(max_results * 2, 10), 30)  # 扩大候选池给重排留空间
                    try:
                        items = await _bing_html(query, max_results)
                    except Exception as exc:
                        logger.warning("[web_search] html(bing) 抓取失败，切换 Mojeek: %s", exc)
                        items = []
                    if not items:
                        try:
                            items = await _mojeek_html(query, pool)
                        except Exception as exc:
                            logger.warning("[web_search] html(mojeek) 抓取失败，切换 DuckDuckGo: %s", exc)
                            items = []
                    if not items:
                        items = await _ddg_html(query, pool)
                    if items:
                        # 搜索质量增强栈：时效标注/过滤 → 重排 → 去重 → 摘要清理 → 截断（移植自 DSH）
                        items = _post_process_html(items, query, top_k=max_results)
                elif provider == "searxng":
                    items = await _searxng(query, os.getenv("SEARXNG_URL") or "", max_results)
                else:
                    api_key = os.getenv(_PROVIDER_ENV[provider]) or os.getenv("SEARCH_API_KEY") or ""
                    if not api_key:
                        errors.append(f"{provider}: 缺少 API key")
                        continue
                    if provider == "tavily":
                        items = await _tavily(query, api_key, max_results)
                    elif provider == "exa":
                        items = await _exa(query, api_key, max_results)
                    elif provider == "serper":
                        items = await _serper(query, api_key, max_results)
                    else:
                        items = await _brave(query, api_key, max_results)
            except Exception as exc:
                logger.warning("[web_search] %s 搜索失败，尝试下一个供应商: %s", provider, exc)
                errors.append(f"{provider}: {exc}")
                continue
            if items:
                text = _format_results(query, items)
                _cache_set(cache_key, text, items)
                _breaker_record_success()
                # 上报来源引用（前 8 条，按结果顺序；失败路径不加）
                _report_citations(ctx, items)
                return text
            errors.append(f"{provider}: 无结果")

        # 全部供应商失败 → 熔断计数（连续失败达阈值会短时打开熔断器，保护上游）
        _breaker_record_failure()
        if errors:
            return f"联网搜索失败（{len(errors)} 个供应商均不可用）：\n" + "\n".join(errors)
        return f"未搜索到与「{query}」相关的结果。"
    finally:
        sem = _global_semaphore
        if sem is not None and sem.locked():
            sem.release()


def _format_results(query: str, items: list[dict]) -> str:
    # 结果精简：标题/描述限长，控制注入上下文的 token 占用（多轮 agent 会累积）
    lines = []
    for it in items:
        title = (it["title"] or "(无标题)").strip()[:120]
        url = it["url"]
        desc = (it["description"] or "").strip()[:400]
        if url:
            head = f"{title} — {url}"
        else:
            head = title
        lines.append(f"{head}\n{desc}".rstrip() if desc else head)
    return "\n\n".join(lines)


_URL_RE = re.compile(r"https?://\S+")


def _extract_citations_from_text(text: str) -> list[dict]:
    """从缓存的格式化结果文本里回退提取引用（旧格式缓存 / items 缺失时的兜底）。

    每块结果格式为 "标题 — url\n描述"（块间空行分隔）；标题可能含 " — "，
    因此用 rpartition 从右侧切出 url；摘要取描述行前 150 字符（description 字段，
    与 _report_citations 的输入契约一致）。
    """
    out: list[dict] = []
    for block in str(text or "").split("\n\n"):
        first_line = block.split("\n", 1)[0]
        if " — " in first_line:
            title, _, url = first_line.rpartition(" — ")
        else:
            m = _URL_RE.search(first_line)
            if not m:
                continue
            url, title = m.group(0), ""
        if url:
            rest = block.split("\n", 1)[1] if "\n" in block else ""
            out.append({
                "url": url,
                "title": title.strip(),
                "description": rest.strip()[:150],
            })
        if len(out) >= 8:
            break
    return out


def _report_citations(ctx: AgentContext, items: list[dict]) -> None:
    """把搜索结果前 8 条的 url/title/摘要（description 前 150 字符）上报到 ctx.citations（引用机制，去重由 add_citation 保证）。"""
    for it in items[:8]:
        url = str(it.get("url") or "").strip()
        if url:
            snippet = str(it.get("description") or "").strip()[:150]
            ctx.add_citation(url, str(it.get("title") or ""), snippet or None)
