"""分块与 embedding 服务层（anything-llm 集成阶段 2，见 markdown/anything_llm_integration_design.md §4）。

- chunk_text：中文优化分块 —— 优先按「。！？；\\n」等句边界切句，聚合句子至接近 chunk_size，块间保留 overlap 字符
- embed_texts / embed_texts_async：第三方 embedding API 适配层（方案 B，零新依赖，httpx 已有）
  - OpenAI 兼容协议：POST {EMBEDDING_BASE_URL}/embeddings，Authorization: Bearer
  - body: {"model": ..., "input": [...]}，解析 data[].embedding；单次最多 32 条，超出分批
- cosine_similarity：余弦相似度（纯 Python）
- search_chunks：检索 chat_file_chunks 表（embedding JSONB），向量余弦 top-k；
  embedding 缺失/不可用时降级为关键词包含匹配

环境变量：
- EMBEDDING_PROVIDER   供应商名（默认空 = 未配置，仅用于提示）
- EMBEDDING_API_KEY    API Key（必填，未配置时抛 RuntimeError）
- EMBEDDING_BASE_URL   API Base URL，如 https://api.siliconflow.cn/v1（必填）
- EMBEDDING_MODEL      模型名（默认 bge-m3）
"""
import json
import os
import re

import httpx

from backend.database import get_db

# 单次请求最多条数（OpenAI 兼容协议常见上限）
_EMBEDDING_MAX_BATCH = 32
# 超时：读取 60s、连接 10s（embedding 大 batch 较慢）
_EMBEDDING_TIMEOUT = httpx.Timeout(60.0, connect=10.0)

# 中文句边界（保留分隔符切句）
_SENTENCE_BOUNDARY_RE = re.compile(r"([。！？；\n]+)")


# ---------------------------------------------------------------------------
# 分块
# ---------------------------------------------------------------------------

def _split_sentences(text: str) -> list[str]:
    """按「。！？；\\n」切句，分隔符保留在句尾；纯空白句丢弃。"""
    parts = _SENTENCE_BOUNDARY_RE.split(text)
    sents: list[str] = []
    for i in range(0, len(parts) - 1, 2):
        seg = parts[i] + parts[i + 1]
        if seg.strip():
            sents.append(seg)
    if len(parts) % 2 == 1 and parts[-1].strip():
        sents.append(parts[-1])
    return sents


def _hard_split(s: str, size: int, overlap: int) -> list[str]:
    """兜底硬切：单句超过 chunk_size 时按固定步长切，相邻片保留 overlap 字符。"""
    step = max(1, size - overlap)
    return [s[i:i + size] for i in range(0, len(s), step)]


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 80) -> list[str]:
    """中文优化分块。

    优先按句边界（。！？；\\n）切句并聚合至接近 chunk_size；
    块间保留 overlap 字符（下一块开头复用上一块尾部 overlap 字符）；
    少于 chunk_size 返回单块；空文本返回 []。
    """
    text = str(text or "")
    if not text.strip():
        return []
    if chunk_size <= 0:
        raise ValueError("chunk_size 必须大于 0")
    if len(text) <= chunk_size:
        return [text]
    overlap = max(0, min(int(overlap or 0), chunk_size - 1))

    chunks: list[str] = []
    current = ""
    for sent in _split_sentences(text):
        if len(sent) > chunk_size:
            # 超长句：flush 当前块后硬切，最后一片作为新块起点继续聚合
            if current:
                chunks.append(current)
            pieces = _hard_split(sent, chunk_size, overlap)
            chunks.extend(pieces[:-1])
            current = pieces[-1]
            continue
        if current and len(current) + len(sent) > chunk_size:
            chunks.append(current)
            current = current[-overlap:] if overlap else ""
        current += sent
    if current:
        chunks.append(current)
    return chunks


# ---------------------------------------------------------------------------
# 余弦相似度
# ---------------------------------------------------------------------------

def cosine_similarity(a: list[float], b: list[float]) -> float:
    """余弦相似度；任一为空、维度不一致或范数为 0 时返回 0.0。"""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b):
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / ((norm_a * norm_b) ** 0.5)


# ---------------------------------------------------------------------------
# embedding API 适配
# ---------------------------------------------------------------------------

def _get_embedding_config() -> dict:
    """读取环境变量（每次调用读取，支持配置热更新）。"""
    return {
        "provider": (os.getenv("EMBEDDING_PROVIDER") or "").strip(),
        "api_key": (os.getenv("EMBEDDING_API_KEY") or "").strip(),
        "base_url": (os.getenv("EMBEDDING_BASE_URL") or "").strip(),
        "model": (os.getenv("EMBEDDING_MODEL") or "bge-m3").strip() or "bge-m3",
    }


def _ensure_embedding_configured(cfg: dict) -> None:
    if not cfg["api_key"] or not cfg["base_url"]:
        raise RuntimeError(
            "embedding 未配置：设置 EMBEDDING_PROVIDER/EMBEDDING_API_KEY/EMBEDDING_BASE_URL"
        )


def _parse_embeddings_response(payload, expected: int) -> list[list[float]]:
    """解析 OpenAI 兼容响应：data[].embedding（或 data 直接为向量数组）。"""
    data = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(data, list) or not data:
        raise RuntimeError(f"embedding 响应缺少 data：{str(payload)[:300]}")
    first = data[0]
    if isinstance(first, dict):
        if "embedding" not in first:
            raise RuntimeError(f"embedding 响应格式异常：{str(payload)[:300]}")
        data = sorted(data, key=lambda item: item.get("index", 0))
        vectors = [item["embedding"] for item in data]
    elif isinstance(first, list):
        vectors = data
    else:
        raise RuntimeError(f"embedding 响应格式异常：{str(payload)[:300]}")
    vectors = [list(v) for v in vectors]
    if len(vectors) != expected:
        raise RuntimeError(
            f"embedding 返回数量不匹配：期望 {expected}，实际 {len(vectors)}"
        )
    return vectors


def _embed_batch_sync(client: httpx.Client, url: str, headers: dict, model: str, batch: list[str]) -> list[list[float]]:
    try:
        resp = client.post(url, headers=headers, json={"model": model, "input": batch})
    except httpx.HTTPError as e:
        raise RuntimeError(f"embedding 请求失败：{e}") from e
    if resp.status_code != 200:
        raise RuntimeError(f"embedding 请求失败：HTTP {resp.status_code} {resp.text[:500]}")
    try:
        return _parse_embeddings_response(resp.json(), len(batch))
    except Exception as e:
        raise RuntimeError(f"embedding 响应解析失败：{e}") from e


async def _embed_batch_async(client: httpx.AsyncClient, url: str, headers: dict, model: str, batch: list[str]) -> list[list[float]]:
    try:
        resp = await client.post(url, headers=headers, json={"model": model, "input": batch})
    except httpx.HTTPError as e:
        raise RuntimeError(f"embedding 请求失败：{e}") from e
    if resp.status_code != 200:
        raise RuntimeError(f"embedding 请求失败：HTTP {resp.status_code} {resp.text[:500]}")
    try:
        return _parse_embeddings_response(resp.json(), len(batch))
    except Exception as e:
        raise RuntimeError(f"embedding 响应解析失败：{e}") from e


def embed_texts(texts: list[str]) -> list[list[float]]:
    """同步：批量文本 → 向量列表（与输入顺序一致）。未配置时抛 RuntimeError（中文说明）。"""
    rows = [str(t or "") for t in texts]
    if not rows:
        return []
    cfg = _get_embedding_config()
    _ensure_embedding_configured(cfg)
    url = f"{cfg['base_url'].rstrip('/')}/embeddings"
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    results: list[list[float]] = []
    with httpx.Client(timeout=_EMBEDDING_TIMEOUT) as client:
        for i in range(0, len(rows), _EMBEDDING_MAX_BATCH):
            results.extend(
                _embed_batch_sync(client, url, headers, cfg["model"], rows[i:i + _EMBEDDING_MAX_BATCH])
            )
    return results


async def embed_texts_async(texts: list[str]) -> list[list[float]]:
    """异步版 embed_texts（复用同一配置与协议）。"""
    rows = [str(t or "") for t in texts]
    if not rows:
        return []
    cfg = _get_embedding_config()
    _ensure_embedding_configured(cfg)
    url = f"{cfg['base_url'].rstrip('/')}/embeddings"
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    results: list[list[float]] = []
    async with httpx.AsyncClient(timeout=_EMBEDDING_TIMEOUT) as client:
        for i in range(0, len(rows), _EMBEDDING_MAX_BATCH):
            results.extend(
                await _embed_batch_async(client, url, headers, cfg["model"], rows[i:i + _EMBEDDING_MAX_BATCH])
            )
    return results


# ---------------------------------------------------------------------------
# 检索（chat_file_chunks 表）
# ---------------------------------------------------------------------------

def _tokenize_keywords(text: str) -> list[str]:
    """降级检索用分词：按空白/标点切分，转小写。"""
    parts = re.split(
        r"[\s,，。.!！?？;；:：、()（）\[\]{}【】\"'“”‘’<>《》/\\|·]+",
        str(text).lower(),
    )
    return [p for p in parts if p]


def search_chunks(file_ids: list[int], query: str, top_k: int = 3, embed_fn=None) -> list[dict]:
    """检索 chat_file_chunks 表（id, file_id, chunk_index, content, embedding JSONB, created_at）。

    - embedding 存在且 query 向量可用时：Python 计算余弦相似度取 top-k
    - embedding 缺失/不可用（未配置、调用失败、行无 embedding）时：降级为关键词包含匹配
      （query 按空白/标点切词，chunk 包含任一关键词计分，score = 命中词数 / 总词数）
    - 返回 [{"file_id", "chunk_index", "content", "score"}]，按 score 降序
    """
    ids = [int(fid) for fid in (file_ids or [])]
    q = str(query or "").strip()
    if not ids or not q:
        return []
    top_k = max(1, int(top_k or 3))

    with get_db() as conn:
        rows = conn.execute(
            "SELECT file_id, chunk_index, content, embedding FROM chat_file_chunks "
            "WHERE file_id = ANY(%s) ORDER BY file_id, chunk_index",
            (ids,),
        ).fetchall()
    if not rows:
        return []

    # 收集有合法 embedding 的行
    embedded: list[tuple[dict, list[float]]] = []
    for r in rows:
        emb = r.get("embedding")
        if isinstance(emb, str):
            try:
                emb = json.loads(emb)
            except Exception:
                emb = None
        if isinstance(emb, list) and emb and all(isinstance(x, (int, float)) for x in emb):
            embedded.append((r, [float(x) for x in emb]))

    # 向量检索（失败/不可用则降级）
    if embedded:
        fn = embed_fn or embed_texts
        try:
            query_vec = fn([q])[0]
        except Exception:
            query_vec = None
        if query_vec is not None and isinstance(query_vec, list) and query_vec:
            scored = [
                {
                    "file_id": int(r["file_id"]),
                    "chunk_index": int(r["chunk_index"]),
                    "content": str(r.get("content") or ""),
                    "score": cosine_similarity(query_vec, vec),
                }
                for r, vec in embedded
            ]
            scored.sort(key=lambda x: (-x["score"], x["chunk_index"]))
            return scored[:top_k]

    # 降级：关键词包含匹配
    tokens = _tokenize_keywords(q)
    if not tokens:
        return []
    scored = []
    for r in rows:
        content = str(r.get("content") or "").lower()
        hits = [t for t in tokens if t in content]
        if not hits:
            continue
        scored.append(
            {
                "file_id": int(r["file_id"]),
                "chunk_index": int(r["chunk_index"]),
                "content": str(r.get("content") or ""),
                "score": len(hits) / len(tokens),
            }
        )
    scored.sort(key=lambda x: (-x["score"], x["chunk_index"]))
    return scored[:top_k]


# ---------------------------------------------------------------------------
# 模块自测
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    sample = (
        "Atelier 是一个多模态 AI 工作台，聚合主流大模型，致力于把想法变成作品。"
        "用户上传提示词后，系统会调用多个图像生成模型完成创作，并自动托管到图床。"
        "平台支持积分体系、邀请返利和每日签到，用户可以持续获得生成额度。\n"
        "分块功能是 RAG 检索的基础：长文档先切句，再聚合为接近目标长度的块。"
        "块与块之间保留 overlap 字符，避免检索时丢失跨块上下文。"
        "第三段继续补充说明：embedding 服务支持 OpenAI 兼容协议，未配置时会给出中文报错提示。"
        "最后一句用于验证单块场景，因为总长度远小于 800 字符时会直接返回单块。"
    )
    chunks = chunk_text(sample, chunk_size=800, overlap=80)
    print(f"[chunk_text] 单块场景：输入 {len(sample)} 字符，产出 {len(chunks)} 块（期望 1）")
    for idx, c in enumerate(chunks):
        print(f"  chunk[{idx}] 长度={len(c)}：{c[:36]}...")
    print(f"[chunk_text] 短文本单块：{len(chunk_text('短文本', 800, 80)) == 1}，空文本：{chunk_text('') == []}")

    # 多块场景：重复拼接约 1280 字符，验证句边界聚合与 overlap
    long_text = "".join([sample] * 5)
    chunks = chunk_text(long_text, chunk_size=800, overlap=80)
    print(f"[chunk_text] 多块场景：输入 {len(long_text)} 字符，产出 {len(chunks)} 块")
    for idx, c in enumerate(chunks):
        print(f"  chunk[{idx}] 长度={len(c)}：{c[:36]}...")
    if len(chunks) > 1:
        overlap_hits = 0
        for i in range(len(chunks) - 1):
            tail = chunks[i][-80:]
            if chunks[i + 1].startswith(tail):
                overlap_hits += 1
        print(f"[chunk_text] 相邻块 overlap 命中 {overlap_hits}/{len(chunks)-1} 处（各 80 字符）")

    a = [1.0, 0.0, 0.0]
    b = [0.0, 1.0, 0.0]
    c = [0.6, 0.8, 0.0]
    print(f"[cosine_similarity] 相同向量 = {cosine_similarity(a, a):.4f}（期望 1.0）")
    print(f"[cosine_similarity] 正交向量 = {cosine_similarity(a, b):.4f}（期望 0.0）")
    print(f"[cosine_similarity] 夹角向量 = {cosine_similarity(a, c):.4f}（期望 0.6）")
    print(f"[cosine_similarity] 维度不一致 = {cosine_similarity([1.0], [1.0, 2.0])}（期望 0.0）")
    print(f"[cosine_similarity] 零向量 = {cosine_similarity([0.0, 0.0], [1.0, 0.0])}（期望 0.0）")
