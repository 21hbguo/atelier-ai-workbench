"""web_search 工具：多供应商联网搜索（serper / brave / tavily / searxng）。

环境变量配置：
- SEARCH_PROVIDER: serper | brave | tavily | searxng
- SEARCH_API_KEY: serper（X-API-KEY）/ brave（X-Subscription-Token）/ tavily（请求体 api_key）
- SEARXNG_URL: searxng 实例地址（如 https://searx.example.com）

未配置时返回明确中文错误，说明需要设置哪些环境变量。
统一返回 "标题 — url\n描述" 列表文本。
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

_PROVIDERS = ("serper", "brave", "tavily", "searxng")


def _unconfigured_message(provider: str) -> str:
    if provider == "searxng":
        return "未配置联网搜索：请设置环境变量 SEARCH_PROVIDER=searxng 和 SEARXNG_URL（searxng 实例地址）。"
    if provider:
        return f"未配置联网搜索：SEARCH_PROVIDER 已设为 {provider}，但缺少 SEARCH_API_KEY，请补充该环境变量。"
    return (
        "未配置联网搜索：请设置环境变量 SEARCH_PROVIDER（serper|brave|tavily|searxng）"
        "以及对应的 SEARCH_API_KEY（serper/brave/tavily）或 SEARXNG_URL（searxng）。"
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
    name="web_search.search",
    description=(
        "联网搜索互联网获取实时信息。当用户问题涉及实时新闻、最新数据、"
        "模型知识范围外或需要核实的信息时使用，返回网页标题、链接与摘要。"
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

    provider = str(os.getenv("SEARCH_PROVIDER") or "").strip().lower()
    if provider not in _PROVIDERS:
        return _unconfigured_message(provider)

    api_key = os.getenv("SEARCH_API_KEY") or ""
    searxng_url = os.getenv("SEARXNG_URL") or ""
    if provider != "searxng" and not api_key:
        return _unconfigured_message(provider)
    if provider == "searxng" and not searxng_url:
        return _unconfigured_message(provider)

    try:
        if provider == "serper":
            items = await _serper(query, api_key, max_results)
        elif provider == "brave":
            items = await _brave(query, api_key, max_results)
        elif provider == "tavily":
            items = await _tavily(query, api_key, max_results)
        else:
            items = await _searxng(query, searxng_url, max_results)
    except Exception as exc:
        logger.exception("[web_search] %s 搜索请求失败", provider)
        return f"联网搜索失败（{provider}）：{exc}"

    if not items:
        return f"未搜索到与「{query}」相关的结果。"
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
