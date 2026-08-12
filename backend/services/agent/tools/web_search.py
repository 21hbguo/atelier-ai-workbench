"""web_search 工具：多供应商联网搜索（tavily / exa / serper / brave / searxng）。

环境变量配置（可同时配置多个，自动按优先级故障转移）：
- TAVILY_API_KEY: Tavily 云搜索（api.tavily.com）
- EXA_API_KEY: Exa 云搜索（api.exa.ai）
- SERPER_API_KEY: Serper 云搜索（google.serper.dev）
- BRAVE_API_KEY: Brave 云搜索（api.search.brave.com）
- SEARXNG_URL: 自建 searxng 实例地址（如 https://searx.example.com，仅内网/公网可达时可用）

兼容旧配置：
- SEARCH_PROVIDER: serper | brave | tavily | searxng（显式指定单一供应商时仅用该供应商）
- SEARCH_API_KEY: 指定供应商时的通用 key（新配置优先用各自独立 key）

未配置任何 key 时返回明确中文错误。统一返回 "标题 — url\n描述" 列表文本。
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from collections import deque
from typing import Any

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
_CACHE_TTL = max(0, int(os.getenv("SEARCH_CACHE_TTL", "300")))
_cache: dict[str, tuple[float, str]] = {}  # key -> (expire_ts, 格式化结果)
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
# 默认启用顺序（也可用 SEARCH_PROVIDERS 显式指定顺序）
_DEFAULT_PROVIDER_ORDER = ("tavily", "exa", "serper", "brave", "searxng")


def _configured_providers() -> list[str]:
    """返回可用的供应商列表：
    1) SEARCH_PROVIDER 显式指定时仅用该供应商（兼容旧配置，key 回退 SEARCH_API_KEY）；
    2) 否则按默认顺序自动检测已配置独立 key 的供应商（SEARCH_PROVIDERS 可自定义顺序）。
    """
    explicit = str(os.getenv("SEARCH_PROVIDER") or "").strip().lower()
    if explicit:
        if explicit in _PROVIDER_ENV:
            key_env = _PROVIDER_ENV[explicit]
            if os.getenv(key_env) or os.getenv("SEARCH_API_KEY"):
                return [explicit]
        return []
    order_env = str(os.getenv("SEARCH_PROVIDERS") or "").strip()
    if order_env:
        order = [s.strip().lower() for s in order_env.split(",") if s.strip()]
    else:
        order = list(_DEFAULT_PROVIDER_ORDER)
    return [p for p in order if p in _PROVIDER_ENV and os.getenv(_PROVIDER_ENV[p])]


def _max_search_per_run() -> int:
    """单次 agent 运行（run_agent_stream）的搜索次数上限，默认 2，SEARCH_MAX_PER_RUN 可调。"""
    try:
        v = int(os.getenv("SEARCH_MAX_PER_RUN") or "2")
    except (TypeError, ValueError):
        v = 2
    return max(1, min(v, 10))


def _unconfigured_message() -> str:
    return (
        "未配置联网搜索：请设置至少一个供应商的 key/地址，例如 "
        "TAVILY_API_KEY（Tavily）、EXA_API_KEY（Exa）、SERPER_API_KEY（Serper）、"
        "BRAVE_API_KEY（Brave），或 SEARXNG_URL（自建 searxng 实例）。"
    )


async def _http_get(url: str, *, headers: dict | None = None, params: dict | None = None) -> dict:
    h = dict(headers or {})
    h.setdefault("User-Agent", _BROWSER_UA)
    async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
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
        expire, text = item
        if now >= expire:
            _cache.pop(key, None)
            return None
        return text


def _cache_set(key: str, text: str) -> None:
    """写缓存；顺手清理过期条目防止无限增长。"""
    if _CACHE_TTL <= 0 or not text:
        return
    with _cache_lock:
        now = time.monotonic()
        # 惰性清理：超过 128 条时清一遍过期项
        if len(_cache) > 128:
            for k in [k for k, (exp, _) in _cache.items() if exp <= now]:
                _cache.pop(k, None)
        _cache[key] = (now + _CACHE_TTL, text)


@agent_tool(
    name="web_search",
    description=(
        "联网搜索互联网获取实时信息。搜索关键词构造规则：\n"
        "1. 用简洁具体的关键词（名词+时间/领域/事件限定），如「今日要闻 2026年8月12日」"
        "「A股 今日行情」「OpenAI 最新发布」；\n"
        "2. 避免宽泛词（如「今日新闻」「最新消息」），宽泛话题必须加时间/领域/对象限定，"
        "否则会搜到栏目页而非实时内容；\n"
        "3. 若首次结果不相关或质量差，换一组更具体的关键词再搜一次（每轮最多 2 次）；\n"
        "4. 一次搜索尽量覆盖所有子问题（合并关键词），不要为同一问题反复搜索。\n"
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
                if provider == "searxng":
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
                _cache_set(cache_key, text)
                _breaker_record_success()
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
