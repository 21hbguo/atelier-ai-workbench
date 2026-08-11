"""rag_memory 工具：检索当前会话已上传文档（chat_files / chat_file_chunks）。

检索策略（两级降级）：
1. 向量检索优先：embedding_service 可用（已配置 embedding）且 chat_file_chunks 有数据时，
   对 query 求 embedding 与各 chunk 做余弦相似度取 top-3；
2. embedding 不可用（未配置 / 模块缺失 / 表未建 / 查询异常）时降级为关键词全文包含匹配，
   对 page_content 按关键词命中打分取 top-3，并给出命中位置附近的片段。

rag_memory.store 暂未启用（返回提示文本）。
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Optional

from backend.services.agent.context import AgentContext
from backend.services.agent.registry import agent_tool
from backend.database import get_db

logger = logging.getLogger(__name__)

TOP_K = 3
SNIPPET_LIMIT = 500          # 关键词匹配片段长度
VECTOR_SNIPPET_LIMIT = 500   # 向量命中片段长度
_KEYWORD_SPLIT_RE = re.compile(r"[\s,，。.!！?？;；、/\\|]+")


# ---------- 公共：会话文件查询 ----------

def _query_session_files(session_id: Optional[int], user_id: Optional[int]) -> list[dict]:
    """查会话已解析文档（chat_files），按 id 升序。表未建/查询异常向上抛。"""
    sql = (
        "SELECT id, storage_name, original_name, content_type, page_content, char_count, "
        "status, created_at FROM chat_files WHERE session_id = %s"
    )
    params: list[Any] = [session_id]
    if user_id:
        sql += " AND user_id = %s"
        params.append(user_id)
    sql += " AND status = 'parsed' ORDER BY id"
    with get_db() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [dict(r) for r in rows]


def _decode_embedding(value: Any) -> Optional[list[float]]:
    """JSONB 列可能以 str 或 list 返回，统一解码成 list[float]。"""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return None
    if isinstance(value, list) and value and all(isinstance(x, (int, float)) for x in value):
        return [float(x) for x in value]
    return None


def _format_hits(hits: list[dict], *, vector: bool) -> str:
    """把检索结果拼成给模型的文本。"""
    lines = []
    for i, h in enumerate(hits, 1):
        doc = h.get("file") or {}
        name = doc.get("original_name") or doc.get("storage_name") or "未知文档"
        snippet = str(h.get("snippet") or "").strip()
        if vector:
            score = h.get("score")
            score_txt = f"（相似度 {score:.2f}）" if isinstance(score, (int, float)) else ""
            lines.append(f"{i}. 【文档「{name}」】{score_txt}\n{snippet}".rstrip())
        else:
            lines.append(f"{i}. 【文档「{name}」】\n{snippet}".rstrip())
    return "检索到以下相关内容：\n\n" + "\n\n".join(lines)


def _make_snippet(text: str, keywords: list[str], limit: int = SNIPPET_LIMIT) -> str:
    """在 page_content 中找首个关键词位置，截取附近片段。"""
    lower = text.lower()
    pos = -1
    for kw in keywords:
        if not kw:
            continue
        idx = lower.find(kw.lower())
        if idx != -1:
            pos = idx
            break
    if pos == -1:
        snippet = text[:limit]
        return snippet + ("…" if len(text) > limit else "")
    half = max(0, limit - 120)
    start = max(0, pos - half)
    end = min(len(text), pos + (limit - (pos - start)))
    snippet = text[start:end]
    if start > 0:
        snippet = "…" + snippet
    if end < len(text):
        snippet += "…"
    return snippet


# ---------- 检索实现 ----------

async def _vector_search(query: str, session_id: int, files: list[dict], top_k: int) -> list[dict]:
    """向量检索 chat_file_chunks（余弦相似度 top-k）。embedding 不可用时抛异常由调用方降级。"""
    from backend.services import embedding_service  # 延迟导入：模块由另一子代理创建

    # embed_texts 为同步 httpx 调用（最长 60s），放线程池避免阻塞事件循环
    query_vec = (await asyncio.to_thread(embedding_service.embed_texts, [query]))[0]
    if not files:
        return []
    file_ids = [f["id"] for f in files]
    with get_db() as conn:
        rows = conn.execute(
            "SELECT c.file_id, c.chunk_index, c.content, c.embedding "
            "FROM chat_file_chunks c "
            "WHERE c.file_id = ANY(%s) AND c.embedding IS NOT NULL ORDER BY c.id",
            (file_ids,),
        ).fetchall()
    name_by_id = {f["id"]: f for f in files}
    scored: list[tuple[float, dict]] = []
    for r in rows:
        emb = _decode_embedding(r["embedding"])
        if emb is None:
            continue
        try:
            sim = embedding_service.cosine_similarity(query_vec, emb)
        except Exception:
            logger.debug("[rag_memory] 单条余弦计算失败，跳过")
            continue
        scored.append((float(sim), {
            "file": name_by_id.get(r["file_id"], {}),
            "snippet": str(r["content"] or "").strip()[:VECTOR_SNIPPET_LIMIT],
        }))
    scored.sort(key=lambda x: -x[0])
    hits = [item for _, item in scored[:top_k]]
    return hits


def _keyword_search(query: str, files: list[dict], top_k: int) -> list[dict]:
    """关键词全文包含匹配：按命中关键词数打分取 top-k，附命中片段。"""
    keywords = [w for w in _KEYWORD_SPLIT_RE.split(query) if w]
    if not keywords:
        keywords = [query]
    hits: list[dict] = []
    for f in files:
        text = str(f.get("page_content") or "")
        if not text:
            continue
        lower = text.lower()
        matched = [kw for kw in keywords if kw.lower() in lower]
        if not matched:
            continue
        hits.append({
            "file": f,
            "snippet": _make_snippet(text, matched, SNIPPET_LIMIT),
            "score": len(matched),
        })
    hits.sort(key=lambda x: -x["score"])
    return hits[:top_k]


# ---------- 工具 ----------

@agent_tool(
    name="rag_memory_search",
    description=(
        "检索当前会话已上传文档中的相关内容。"
        "当用户问题涉及会话中上传的文件/文档内容时使用，返回匹配片段与来源文档名。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "检索关键词或用户问题"},
        },
        "required": ["query"],
    },
)
async def rag_memory_search(args: dict, ctx: AgentContext) -> str:
    query = str(args.get("query") or "").strip()
    if not query:
        return "请提供检索关键词（query 参数）。"
    if not ctx.session_id:
        return "当前上下文缺少会话信息（session_id），无法检索文档。"

    # 查会话文档（表未建/未解析时给出友好提示）
    try:
        files = _query_session_files(ctx.session_id, ctx.user_id)
    except Exception:
        logger.exception("[rag_memory] 查询 chat_files 失败")
        return "查询会话文档失败（文档表可能尚未初始化），请稍后再试。"

    if not files:
        return "当前会话没有已上传的文档，无法检索。"

    # 1) 向量检索优先（embedding 不可用自动降级）
    try:
        hits = await _vector_search(query, ctx.session_id, files, top_k=TOP_K)
        if hits:
            return _format_hits(hits, vector=True)
        logger.info("[rag_memory] 向量检索无命中，降级关键词匹配")
    except Exception as exc:
        logger.info("[rag_memory] 向量检索不可用，降级关键词匹配: %s", exc)

    # 2) 关键词/全文包含匹配
    hits = _keyword_search(query, files, top_k=TOP_K)
    if not hits:
        return f"未在会话文档中找到与「{query}」相关的内容。"
    return _format_hits(hits, vector=False)


@agent_tool(
    name="rag_memory_store",
    description="把一段文本保存到会话的文档记忆中（当前暂未启用）。",
    parameters={
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "要保存的文本"},
        },
        "required": ["content"],
    },
)
async def rag_memory_store(args: dict, ctx: AgentContext) -> str:
    return "rag_memory.store 暂未启用，当前不支持把文本写入会话文档记忆。"
