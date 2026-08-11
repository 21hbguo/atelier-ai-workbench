import asyncio
import json
import logging
import time
import uuid
from collections import deque
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from backend.auth import get_current_user
from backend.database import get_db
from backend.config import get_limit_config
from backend.services.points_service import PointsService
from backend.services.banned_words import BannedWordsService
from backend.services.chat_service import ChatService
from backend.services.llm_model_service import get_active as get_active_model, get_all as get_all_models

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])

# 每用户每分钟发送次数限制（内存滑动窗口，进程重启重置，够防刷）
_rate_buckets: dict[int, deque] = {}
_RATE_BUCKET_MAX = 20000  # 桶数上限，超出后清理过期桶，防止内存无限增长


class ChatSendRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)
    reasoning_effort: str = Field("auto", pattern="^(auto|low|medium|high|max|xhigh)$")


class ChatRenameRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=50)


class ChatSessionCreateResponse(BaseModel):
    id: int
    title: str


def _check_rate_limit(user_id: int) -> None:
    limit = get_limit_config()["chat_rate_limit_per_minute"]
    now = time.time()
    if len(_rate_buckets) > _RATE_BUCKET_MAX:
        expired = [uid for uid, b in _rate_buckets.items() if not b or now - b[-1] > 60]
        for uid in expired:
            _rate_buckets.pop(uid, None)
    bucket = _rate_buckets.get(user_id)
    if bucket is None:
        bucket = _rate_buckets[user_id] = deque()
    while bucket and now - bucket[0] > 60:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail=f"操作太频繁，每分钟最多 {limit} 次，请稍后再试")
    bucket.append(now)


def _owns_session(conn, session_id: int, user_id: int):
    row = conn.execute(
        "SELECT id, title FROM chat_sessions WHERE id = %s AND user_id = %s",
        (session_id, user_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="会话不存在")
    return row


def _default_title(content: str) -> str:
    t = " ".join(str(content or "").split())
    return (t[:20] + "…") if len(t) > 20 else (t or "新对话")


def _chat_cost_per_request() -> float:
    """单次聊天扣费：优先取激活模型的按次定价（points_per_request），未定价则回退全局配置。"""
    price = get_active_model().get("points_per_request")
    if price is not None and price > 0:
        return float(price)
    return float(get_limit_config()["points_cost_per_chat"])


@router.get("/cost")
async def chat_cost(user=Depends(get_current_user)):
    return {"cost_per_chat": _chat_cost_per_request()}


@router.get("/model")
async def chat_model_info(user=Depends(get_current_user)):
    """当前激活模型的档案（上下文/输出/思考档位等），前端据此渲染思考强度按钮。"""
    return get_active_model()


@router.get("/models")
async def chat_models_info(user=Depends(get_current_user)):
    """全部模型档案（登录用户可见，管理端另有 CRUD）。"""
    return {"items": get_all_models()}


@router.get("/sessions")
async def list_sessions(user=Depends(get_current_user)):
    user_id = user["user_id"]
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT s.id, s.title, s.created_at, s.updated_at,
                   (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
                   (SELECT content FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_message
            FROM chat_sessions s
            WHERE s.user_id = %s
            ORDER BY s.updated_at DESC
            """,
            (user_id,),
        ).fetchall()
    return {
        "items": [
            {
                "id": r["id"],
                "title": r["title"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
                "message_count": r["message_count"] or 0,
                "last_message": r["last_message"] or "",
            }
            for r in rows
        ]
    }


@router.post("/sessions")
async def create_session(user=Depends(get_current_user)):
    user_id = user["user_id"]
    max_sessions = get_limit_config()["chat_max_sessions"]
    with get_db() as conn:
        cnt = conn.execute("SELECT COUNT(*) AS cnt FROM chat_sessions WHERE user_id = %s", (user_id,)).fetchone()["cnt"]
        if cnt >= max_sessions:
            raise HTTPException(status_code=400, detail=f"会话数量已达上限（{max_sessions} 个），请先删除旧会话")
        row = conn.execute(
            "INSERT INTO chat_sessions (user_id, title) VALUES (%s, '新对话') RETURNING id, title",
            (user_id,),
        ).fetchone()
    return {"id": row["id"], "title": row["title"]}


@router.patch("/sessions/{session_id}")
async def rename_session(session_id: int, body: ChatRenameRequest, user=Depends(get_current_user)):
    user_id = user["user_id"]
    with get_db() as conn:
        _owns_session(conn, session_id, user_id)
        conn.execute("UPDATE chat_sessions SET title = %s, updated_at = NOW() WHERE id = %s", (body.title, session_id))
    return {"ok": True, "title": body.title}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: int, user=Depends(get_current_user)):
    user_id = user["user_id"]
    with get_db() as conn:
        _owns_session(conn, session_id, user_id)
        conn.execute("DELETE FROM chat_sessions WHERE id = %s", (session_id,))
    return {"ok": True}


@router.get("/sessions/{session_id}/messages")
async def list_messages(session_id: int, user=Depends(get_current_user)):
    user_id = user["user_id"]
    with get_db() as conn:
        _owns_session(conn, session_id, user_id)
        rows = conn.execute(
            "SELECT id, role, content, created_at FROM chat_messages WHERE session_id = %s ORDER BY id ASC",
            (session_id,),
        ).fetchall()
    return {
        "items": [
            {
                "id": r["id"],
                "role": r["role"],
                "content": r["content"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in rows
        ]
    }


@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: int, body: ChatSendRequest, user=Depends(get_current_user)):
    user_id = user["user_id"]
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="消息内容不能为空")

    if BannedWordsService.check(content):
        raise HTTPException(status_code=400, detail="内容包含违规词汇，请修改后重试")

    _check_rate_limit(user_id)

    cost_per = _chat_cost_per_request()
    req_id = str(uuid.uuid4())

    # 思考档位按模型档案校验：不在档案档位列表内则回退该模型默认档位
    active_model = get_active_model()
    efforts = active_model.get("reasoning_efforts") or ["auto"]
    if body.reasoning_effort not in efforts:
        body.reasoning_effort = active_model.get("default_reasoning_effort") or "auto"

    # 校验会话归属 + 消息上限（先校验后扣费，避免 402 留下孤儿消息）
    with get_db() as conn:
        session = _owns_session(conn, session_id, user_id)
        max_messages = get_limit_config()["chat_max_messages"]
        msg_cnt = conn.execute("SELECT COUNT(*) AS cnt FROM chat_messages WHERE session_id = %s", (session_id,)).fetchone()["cnt"]
        if msg_cnt >= max_messages:
            raise HTTPException(status_code=400, detail=f"该会话消息已达上限（{max_messages} 条），请新建会话继续")

    # 先扣积分
    try:
        balance_after = PointsService.consume(
            user_id, cost_per, f"AI助手对话 x1", tx_type="chat_consume", request_key=f"chat:{req_id}"
        )
    except ValueError as e:
        raise HTTPException(status_code=402, detail=str(e))

    # 再落库用户消息
    with get_db() as conn:
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content) VALUES (%s, 'user', %s)",
            (session_id, content),
        )
        # 首轮自动生成标题
        if (session["title"] or "").strip() in ("", "新对话") and msg_cnt == 0:
            conn.execute(
                "UPDATE chat_sessions SET title = %s, updated_at = NOW() WHERE id = %s",
                (_default_title(content), session_id),
            )
        else:
            conn.execute("UPDATE chat_sessions SET updated_at = NOW() WHERE id = %s", (session_id,))
        history_rows = conn.execute(
            "SELECT role, content FROM chat_messages WHERE session_id = %s ORDER BY id ASC",
            (session_id,),
        ).fetchall()

    history = [{"role": r["role"], "content": r["content"]} for r in history_rows]

    def _refund_once() -> None:
        # refund 幂等（request_key 唯一），重复调用安全
        try:
            PointsService.refund(user_id, cost_per, "AI助手回复失败退还", request_key=f"chat_refund:{req_id}")
        except Exception:
            logger.exception("[chat/send] refund failed")

    async def event_generator():
        finished = False
        refunded = False
        try:
            async for event in ChatService.chat_stream(history, body.reasoning_effort):
                if event["type"] == "chunk":
                    yield f"event: chunk\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                elif event["type"] == "done":
                    with get_db() as conn:
                        conn.execute(
                            "INSERT INTO chat_messages (session_id, role, content) VALUES (%s, 'assistant', %s)",
                            (session_id, event["text"]),
                        )
                    finished = True
                    yield f"event: done\ndata: {json.dumps({'text': event['text'], 'points_balance': balance_after}, ensure_ascii=False)}\n\n"
                elif event["type"] == "error":
                    refunded = True
                    _refund_once()
                    yield f"event: error\ndata: {json.dumps({'detail': event['detail']}, ensure_ascii=False)}\n\n"
        except (GeneratorExit, asyncio.CancelledError):
            # 客户端断开（停止生成/关页）：不 yield，只退款清理
            logger.warning("[chat/send] stream interrupted by client disconnect")
            if not finished and not refunded:
                _refund_once()
            raise
        except Exception:
            logger.exception("[chat/send] unexpected stream error")
            if not finished and not refunded:
                _refund_once()
            yield f"event: error\ndata: {json.dumps({'detail': '回复失败，请重试'}, ensure_ascii=False)}\n\n"
        finally:
            # 兜底：流结束但既未完成也未退款（理论不应发生）
            if not finished and not refunded:
                _refund_once()

    return StreamingResponse(event_generator(), media_type="text/event-stream")
