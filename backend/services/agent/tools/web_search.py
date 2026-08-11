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

import logging
import os
from typing import Any

import httpx

from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool

logger = logging.getLogger(__name__)

_SEARCH_TIMEOUT = 15.0
_MAX_RESULTS = 10  # 单次搜索条数上限，防滥用

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
    async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
        resp = await client.get(url, headers=headers, params=params)
        resp.raise_for_status()
        return resp.json()


async def _http_post(url: str, *, headers: dict | None = None, json_body: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
        resp = await client.post(url, headers=headers, json=json_body)
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


@agent_tool(
    name="web_search",
    description=(
        "联网搜索互联网获取实时信息（有成本：每次搜索消耗搜索 API 额度，"
        "同一次对话最多搜索 2 次）。当用户问题涉及实时新闻、最新数据、"
        "模型知识范围外或需要核实的信息时使用；一次搜索尽量覆盖所有子问题"
        "（合并关键词），不要为同一问题反复搜索；返回网页标题、链接与摘要。"
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
            return _format_results(query, items)
        errors.append(f"{provider}: 无结果")

    if errors:
        return f"联网搜索失败（{len(errors)} 个供应商均不可用）：\n" + "\n".join(errors)
    return f"未搜索到与「{query}」相关的结果。"


def _format_results(query: str, items: list[dict]) -> str:
    lines = []
    for it in items:
        title = it["title"] or "(无标题)"
        url = it["url"]
        desc = (it["description"] or "").strip()
        if url:
            head = f"{title} — {url}"
        else:
            head = title
        lines.append(f"{head}\n{desc}".rstrip() if desc else head)
    return "\n\n".join(lines)
