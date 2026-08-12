import asyncio
import io
import json
import logging
import os
import secrets
import time
import uuid
import zipfile
from collections import deque
from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from backend.auth import get_current_user
from backend.database import get_db
from backend.config import get_limit_config, get_llm_config, UPLOAD_DIR, MAX_FILE_SIZE
from backend.services.points_service import PointsService
from backend.services.banned_words import BannedWordsService
from backend.services.chat_service import ChatService, build_system_prompt
from backend.services.document_parser import parse_file
from backend.services.llm_client import LLMClient, LLMError
from backend.services.agent import AgentContext
from backend.services.agent.loop import run_agent_stream
from backend.services.llm_model_service import get_active as get_active_model, get_all as get_all_models, get_by_model_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])

# 每用户每分钟发送次数限制（内存滑动窗口，进程重启重置，够防刷）
_rate_buckets: dict[int, deque] = {}
_RATE_BUCKET_MAX = 20000  # 桶数上限，超出后清理过期桶，防止内存无限增长


class ChatSendRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    content: str = Field(..., min_length=1, max_length=2000)
    reasoning_effort: str = Field("auto", pattern="^(auto|low|medium|high|max|xhigh)$")
    model_id: str = Field("", max_length=128)
    web_search: bool = Field(False, description="开启联网搜索（无文档会话也走 agent 工具链路，仅注册 web_search 工具）")


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


# agent 模式默认启用的工具（rag_memory.store 为占位实现，不注册给模型）
_AGENT_TOOLS = [
    "rag_memory_search",
    "document_summary_list",
    "document_summary_summarize",
    "web_search",
    "file_ops_write_text",
]


def _model_override(model: dict | None) -> dict:
    """模型档案 per-model 覆盖（与 ChatService.chat_stream 内部逻辑一致）。"""
    override = {}
    if model:
        if model.get("base_url"):
            override["base_url"] = model["base_url"]
        if model.get("api_key"):
            key = str(model["api_key"]).strip()
            if key.startswith("env:"):
                key = os.environ.get(key[4:], "")
            override["api_key"] = key
        if model.get("protocol"):
            override["protocol"] = model["protocol"]
        if model.get("model_id"):
            override["model"] = model["model_id"]
    return override


# 聊天文档上传：允许的扩展名与对应 MIME（content_type 落库用）
# 代码/配置文件与 document_parser._CODE_EXTS 保持一致
_CHAT_DOC_EXTS = {
    "txt", "md", "csv", "json", "html", "pdf", "docx", "xlsx", "pptx",
    # 代码
    "py", "js", "mjs", "cjs", "jsx", "ts", "tsx", "java", "go", "rs",
    "c", "h", "cpp", "hpp", "cc", "cs", "php", "rb", "swift", "kt",
    "sh", "bash", "zsh", "fish", "ps1", "sql", "lua", "r", "pl",
    "scala", "dart", "vue", "svelte",
    # 配置/标记
    "yaml", "yml", "toml", "ini", "conf", "cfg", "xml", "properties", "env",
}
_CHAT_DOC_MIME = {
    "txt": "text/plain",
    "md": "text/markdown",
    "csv": "text/csv",
    "json": "application/json",
    "html": "text/html",
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
# 代码/配置文件兜底 MIME
for _ext in _CHAT_DOC_EXTS:
    _CHAT_DOC_MIME.setdefault(_ext, "text/plain")
# zip 炸弹防护：office 文档解压后总大小上限（压缩包 20MB 可膨胀 GB 级）
_MAX_UNZIPPED_SIZE = 200 * 1024 * 1024
# 每会话上传文件数上限（防磁盘/DB 无限增长）
_MAX_FILES_PER_SESSION = 20


def _write_file(path, content: bytes):
    with open(path, "wb") as f:
        f.write(content)


def _zip_info(content: bytes) -> tuple:
    """读取 zip 包内文件清单与解压后总大小；不是合法 zip 时返回 ([], 0)。"""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = zf.namelist()
            total = sum(i.file_size for i in zf.infolist())
            return names, total
    except Exception:
        return [], 0


def _validate_chat_doc(file: UploadFile, content: bytes) -> str:
    """校验聊天文档：扩展名白名单 + 大小上限 + 魔数/编码与扩展名一致 + zip 膨胀上限。返回规范化扩展名。"""
    if not content:
        raise HTTPException(status_code=400, detail="文件内容为空")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"文件大小超过{MAX_FILE_SIZE // 1024 // 1024}MB限制")
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    if ext not in _CHAT_DOC_EXTS:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {ext or 'unknown'}")
    if ext == "pdf":
        if not content.startswith(b"%PDF-"):
            raise HTTPException(status_code=400, detail="文件扩展名与内容不匹配（PDF 文件头缺失）")
    elif ext in ("docx", "xlsx", "pptx"):
        names, total = _zip_info(content)
        if not (content[:2] == b"PK" and "[Content_Types].xml" in names):
            raise HTTPException(status_code=400, detail="文件扩展名与内容不匹配（Office 文档内容无效）")
        if total > _MAX_UNZIPPED_SIZE:
            raise HTTPException(status_code=400, detail="压缩包解压后体积过大，已拒绝")
    else:
        try:
            content.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="文本文件必须为 UTF-8 编码")
    return ext


@router.post("/upload")
async def upload_chat_file(
    session_id: int = Form(...),
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """上传聊天文档：校验后存 data/uploads/，解析全文写入 chat_files，供后续对话注入上下文。"""
    user_id = user["user_id"]
    with get_db() as conn:
        _owns_session(conn, session_id, user_id)
        # 会话文件数配额（防磁盘/DB 无限增长）
        cnt = conn.execute(
            "SELECT COUNT(*) AS cnt FROM chat_files WHERE session_id = %s", (session_id,)
        ).fetchone()["cnt"]
        if cnt >= _MAX_FILES_PER_SESSION:
            raise HTTPException(status_code=400, detail=f"每个会话最多上传 {_MAX_FILES_PER_SESSION} 个文件，请清理或新建会话")

    # 分块读取：内存占用上限 = MAX_FILE_SIZE + 1MB，超大文件在读完前即被拒绝
    content = b""
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        content += chunk
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"文件大小超过{MAX_FILE_SIZE // 1024 // 1024}MB限制")
    ext = _validate_chat_doc(file, content)
    storage_name = f"{secrets.token_hex(16)}.{ext}"
    save_path = UPLOAD_DIR / storage_name
    await asyncio.to_thread(_write_file, save_path, content)

    # 解析失败：删除已写文件并返回 4xx
    try:
        page_content = await asyncio.to_thread(parse_file, str(save_path), ext)
    except ValueError as e:
        save_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("[chat/upload] parse failed: %s", storage_name)
        save_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="文件解析失败，请检查文件内容")

    original_name = os.path.basename(file.filename or "")[:255] or "upload"
    content_type = (file.content_type or "").split(";")[0].strip().lower() or _CHAT_DOC_MIME[ext]
    char_count = len(page_content)
    with get_db() as conn:
        row = conn.execute(
            """INSERT INTO chat_files
               (session_id, user_id, storage_name, original_name, content_type, page_content, char_count, status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, 'parsed')
               RETURNING id""",
            (session_id, user_id, storage_name, original_name, content_type, page_content, char_count),
        ).fetchone()
    logger.info("[chat/upload] session=%s file_id=%s name=%s chars=%s", session_id, row["id"], original_name, char_count)
    return {
        "file_id": row["id"],
        "original_name": original_name,
        "char_count": char_count,
        "storage_name": storage_name,
    }


def _default_title(content: str) -> str:
    t = " ".join(str(content or "").split())
    return (t[:20] + "…") if len(t) > 20 else (t or "新对话")


def _chat_cost_per_request(model=None) -> float:
    """单次聊天扣费：优先模型档案的按次定价（points_per_request），未定价则回退全局配置。"""
    m = model or get_active_model()
    price = m.get("points_per_request")
    if price is not None and price > 0:
        return float(price)
    return float(get_limit_config()["points_cost_per_chat"])


@router.get("/cost")
async def chat_cost(model_id: str = Query("", max_length=128), user=Depends(get_current_user)):
    model = None
    if model_id:
        model = get_by_model_id(model_id)
        if not model:
            raise HTTPException(status_code=400, detail="模型不存在")
    return {"cost_per_chat": _chat_cost_per_request(model)}


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


class ChatBatchDeleteRequest(BaseModel):
    ids: list[int] = Field(..., min_length=1)


@router.post("/sessions/batch-delete")
async def batch_delete_sessions(body: ChatBatchDeleteRequest, user=Depends(get_current_user)):
    """批量删除会话（仅限本人，消息随会话级联删除）。"""
    user_id = user["user_id"]
    ids = list(dict.fromkeys(body.ids))  # 去重保序
    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM chat_sessions WHERE id = ANY(%s) AND user_id = %s",
            (ids, user_id),
        )
        deleted = cur.rowcount
    return {"deleted": deleted}


@router.get("/sessions/{session_id}/messages")
async def list_messages(session_id: int, user=Depends(get_current_user)):
    user_id = user["user_id"]
    with get_db() as conn:
        _owns_session(conn, session_id, user_id)
        rows = conn.execute(
            "SELECT id, role, content, thinking, file_ids, created_at FROM chat_messages WHERE session_id = %s ORDER BY id ASC",
            (session_id,),
        ).fetchall()
    # 收集所有消息引用的文件 id，一次性查 chat_files 避免 N+1
    wanted: set[int] = set()
    for r in rows:
        try:
            fids = json.loads(r["file_ids"]) if r["file_ids"] else []
        except (TypeError, ValueError):
            fids = []
        for fid in fids:
            try:
                wanted.add(int(fid))
            except (TypeError, ValueError):
                continue
    files_by_id: dict[int, dict] = {}
    if wanted:
        try:
            with get_db() as conn:
                frows = conn.execute(
                    "SELECT id, original_name FROM chat_files WHERE id = ANY(%s)",
                    (list(wanted),),
                ).fetchall()
            files_by_id = {f["id"]: {"id": f["id"], "original_name": f["original_name"]} for f in frows}
        except Exception:
            logger.exception("[chat/messages] 查询关联文件失败，回退空列表")
            files_by_id = {}
    items = []
    for r in rows:
        files = []
        if r["file_ids"]:
            try:
                fids = json.loads(r["file_ids"])
            except (TypeError, ValueError):
                fids = []
            for fid in fids:
                try:
                    f = files_by_id.get(int(fid))
                except (TypeError, ValueError):
                    f = None
                if f:
                    files.append(f)
        items.append({
            "id": r["id"],
            "role": r["role"],
            "content": r["content"],
            "thinking": r["thinking"] or "",
            "files": files,  # 关联文件 [{id, original_name}]；file_ids 为空/查询失败时 []
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        })
    return {"items": items}


@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: int, body: ChatSendRequest, user=Depends(get_current_user)):
    user_id = user["user_id"]
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="消息内容不能为空")

    if BannedWordsService.check(content):
        raise HTTPException(status_code=400, detail="内容包含违规词汇，请修改后重试")

    _check_rate_limit(user_id)

    # 模型解析：model_id 留空 = 激活模型；指定则校验档案存在且已启用
    active_model = get_active_model()
    target_model = active_model
    if body.model_id:
        target_model = get_by_model_id(body.model_id)
        if not target_model:
            raise HTTPException(status_code=400, detail="模型不存在")
        if not target_model.get("enabled", True):
            raise HTTPException(status_code=400, detail="模型未启用")
        # 未配置接口（base_url/api_key 均空）且不是激活模型 → 拒绝，避免打到错误的全局接口
        if not target_model.get("base_url") and not target_model.get("api_key") \
                and body.model_id != (active_model.get("model_id") or ""):
            raise HTTPException(status_code=400, detail="该模型未配置接口，请在模型档案中填写 API 地址和 Key")

    cost_per = _chat_cost_per_request(target_model)
    req_id = str(uuid.uuid4())

    # per-model 覆盖（agent 自动分支与 chat_stream 内逻辑共用）
    override = _model_override(target_model)

    # 思考档位按模型档案校验：不在档案档位列表内则回退该模型默认档位
    efforts = target_model.get("reasoning_efforts") or ["auto"]
    if body.reasoning_effort not in efforts:
        body.reasoning_effort = target_model.get("default_reasoning_effort") or "auto"

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

    # 再落库用户消息（file_ids 快照会话当前已解析文件 id，前端据此显示关联文件图标）
    with get_db() as conn:
        # 会话行锁：与 ChatService 的上下文压缩（阶段1/3 同样 FOR UPDATE）串行化，
        # 保证「本事务插入的消息」要么在压缩读取范围内、要么 id 大于压缩边界，
        # 避免压缩期间插入的消息同时被摘要与 id > summary_until 过滤而永久丢失。
        conn.execute("SELECT id FROM chat_sessions WHERE id = %s FOR UPDATE", (session_id,))
        file_rows = conn.execute(
            "SELECT id, original_name, page_content FROM chat_files WHERE session_id = %s AND status = 'parsed' ORDER BY id ASC",
            (session_id,),
        ).fetchall()
        file_ids = [r["id"] for r in file_rows]
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, file_ids) VALUES (%s, 'user', %s, %s::jsonb)",
            (session_id, content, json.dumps(file_ids)),
        )
        # 首轮自动生成标题
        if (session["title"] or "").strip() in ("", "新对话") and msg_cnt == 0:
            conn.execute(
                "UPDATE chat_sessions SET title = %s, updated_at = NOW() WHERE id = %s",
                (_default_title(content), session_id),
            )
        else:
            conn.execute("UPDATE chat_sessions SET updated_at = NOW() WHERE id = %s", (session_id,))

    # 历史消息不在此处加载：由 ChatService.prepare_session_messages 带压缩状态（id > summary_until）
    # 统一组装，保证三区块结构（区块2 文档块固定前缀 + 区块3 纯追加历史）逐轮稳定。
    attached_docs = [{"original_name": r["original_name"], "page_content": r["page_content"]} for r in file_rows]

    # 自动模式：会话有已解析文件 → 走 agent 工具链路（工具可检索/总结文档）；
    # 或用户显式开启联网搜索（web_search=true，无文档时仅注册 web_search 工具）。
    # 仅 OpenAI 兼容协议支持工具回填（anthropic 一期降级普通聊天，文档注入仍生效）
    use_agent = bool(attached_docs) or body.web_search
    if use_agent:
        cfg = dict(get_llm_config())
        for k, v in override.items():
            if v:
                cfg[k] = v
        if LLMClient.protocol(cfg) != "openai":
            use_agent = False
    # 工具列表裁剪：有文档 → 全量工具（文档检索/总结/搜索）；仅联网搜索 → 只注册 web_search
    tools_names = _AGENT_TOOLS if attached_docs else (["web_search"] if body.web_search else None)

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
            if use_agent:
                # 会话有上传文档：agent 工具循环（流式多轮；自动模式无需前端指定）
                try:
                    ctx = AgentContext(session_id=session_id, user_id=user_id)
                    # 纯联网搜索模式（无文档）时，system 追加搜索使用规则，引导模型构造高质量关键词
                    agent_system = build_system_prompt(target_model)
                    if body.web_search and not attached_docs:
                        agent_system += (
                            "\n\n【联网搜索模式】用户已开启联网搜索，回答实时/新闻/数据类问题前应使用 "
                            "web_search 工具获取信息。关键词必须具体（含时间/领域/对象限定），"
                            "避免「今日新闻」「最新消息」这类宽泛词；首次结果不满意时换更具体的关键词"
                            "再搜一次；基于搜索结果回答并注明来源，搜不到就如实说明，不要编造。"
                        )
                    messages = await ChatService.prepare_session_messages(
                        session_id, target_model, attached_docs,
                        system_prompt=agent_system, override=override,
                    )
                    async for event in run_agent_stream(
                        system=agent_system,
                        messages=messages,
                        tools_names=tools_names,
                        max_tool_calls=5,  # 收紧轮数：agent 多轮 LLM 调用会放大 API 成本
                        override=override,
                        ctx=ctx,
                    ):
                        etype = event["type"]
                        if etype == "chunk":
                            # 实时透传文本增量，前端 StreamBubble 逐字展示
                            yield f"event: chunk\ndata: {json.dumps({'text': event['text']}, ensure_ascii=False)}\n\n"
                        elif etype == "thinking":
                            # 实时透传思考增量（多轮合并展示由前端累积）
                            yield f"event: thinking\ndata: {json.dumps({'text': event['text']}, ensure_ascii=False)}\n\n"
                        elif etype == "tool_status":
                            data = {"type": "tool_status", "name": event["name"], "status": event["status"]}
                            if event.get("result_len") is not None:
                                data["result_len"] = event["result_len"]
                            yield f"event: tool_status\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
                        elif etype == "done":
                            text = str(event.get("text") or "")
                            thinking = str(event.get("thinking") or "").strip()
                            with get_db() as conn:
                                conn.execute(
                                    "INSERT INTO chat_messages (session_id, role, content, thinking) VALUES (%s, 'assistant', %s, %s)",
                                    (session_id, text, thinking or None),
                                )
                            finished = True
                            yield f"event: done\ndata: {json.dumps({'text': text, 'thinking': thinking, 'points_balance': balance_after}, ensure_ascii=False)}\n\n"
                except LLMError as e:
                    refunded = True
                    _refund_once()
                    yield f"event: error\ndata: {json.dumps({'detail': str(e)}, ensure_ascii=False)}\n\n"
                return
            messages = await ChatService.prepare_session_messages(
                session_id, target_model, attached_docs,
                system_prompt=build_system_prompt(target_model), override=override,
            )
            async for event in ChatService.chat_stream([], body.reasoning_effort, model=target_model, attached_docs=attached_docs, prebuilt_messages=messages):
                if event["type"] == "chunk":
                    yield f"event: chunk\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                elif event["type"] == "thinking":
                    yield f"event: thinking\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                elif event["type"] == "done":
                    with get_db() as conn:
                        conn.execute(
                            "INSERT INTO chat_messages (session_id, role, content, thinking) VALUES (%s, 'assistant', %s, %s)",
                            (session_id, event["text"], event.get("thinking", "") or None),
                        )
                    finished = True
                    yield f"event: done\ndata: {json.dumps({'text': event['text'], 'thinking': event.get('thinking', ''), 'points_balance': balance_after}, ensure_ascii=False)}\n\n"
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
