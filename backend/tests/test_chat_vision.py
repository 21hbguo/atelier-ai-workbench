"""聊天「发图给视觉模型」功能单元测试。

覆盖：
1. 图片上传成功写入 chat_files（status=image、page_content=[image]、真实 MIME，且不调 parse_file/不 OCR）；
2. 带 image_file_ids 发送：发给 LLM 的最后一条 user 消息 content 升级为 list 且含 image 块
   （mock LLM 调用层 ChatService.chat_stream，断言传入的 prebuilt_messages）；
3. 目标模型无 vision：自动切换到 get_vision_default 的视觉模型（done 事件 model_switched=true）；
4. 无 vision 且无默认视觉模型：返回明确中文错误；
5. 图片不属于本会话：拒绝。

不连真实数据库 / 不连真实 LLM，全部 mock（风格参照 test_chat_billing.py / test_rename_session.py）。
"""
import asyncio
import json
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.routers import chat as chat_module
from backend.routers.chat import ChatSendRequest, _attach_image_blocks
from backend.services import llm_model_service

# 1x1 透明 PNG 假字节（真实文件头，够写入磁盘即可）
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32

USER = {"user_id": 7}
SESSION_ID = 10
IMAGE_FILE_ID = 11


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# 公共 mock 工具
# ---------------------------------------------------------------------------

def _execute_side_effect(sql, *params):
    """按 SQL 内容分发 fetchone/fetchall 结果的 conn.execute side_effect。"""
    cur = MagicMock(name="cursor")
    s = str(sql)
    if "FROM chat_sessions WHERE id = %s AND user_id = %s" in s:
        cur.fetchone.return_value = {"id": SESSION_ID, "title": "新对话"}
    elif "COUNT(*) AS cnt FROM chat_files" in s:
        cur.fetchone.return_value = {"cnt": 0}
    elif "COUNT(*) AS cnt FROM chat_messages" in s:
        cur.fetchone.return_value = {"cnt": 0}
    elif "FROM chat_files WHERE id = ANY(%s) AND session_id = %s AND user_id = %s AND status = 'image'" in s:
        cur.fetchall.return_value = [
            {"id": IMAGE_FILE_ID, "original_name": "photo.png",
             "storage_name": "uploads/aaa.png", "content_type": "image/png"},
        ]
    elif "status = 'parsed'" in s:
        cur.fetchall.return_value = []
    elif "INSERT INTO chat_files" in s:
        cur.fetchone.return_value = {"id": 1}
    elif "VALUES (%s, 'user', %s" in s:
        cur.fetchone.return_value = {"id": 101}  # user 消息落库
    elif "citations, widgets, files" in s:
        cur.fetchone.return_value = {"id": 102}  # assistant 消息落库
    else:
        cur.fetchone.return_value = None
    return cur


def _mock_get_db(conn=None):
    """patch chat 模块的 get_db；conn 传 None 时自动创建并挂默认 side_effect。"""
    if conn is None:
        conn = MagicMock(name="db_conn")
        conn.execute.side_effect = _execute_side_effect
    db = MagicMock(name="get_db")
    db.__enter__ = MagicMock(return_value=conn)
    db.__exit__ = MagicMock(return_value=False)
    return patch.object(chat_module, "get_db", return_value=db), conn


def _no_vision_model(model_id="no-vision"):
    return {
        "model_id": model_id, "label": model_id, "protocol": "openai",
        "base_url": "https://api.example.com/v1", "api_key": "sk-test",
        "reasoning_efforts": ["auto"], "default_reasoning_effort": "auto",
        "capabilities": [], "enabled": True,
    }


def _vision_model(model_id="gpt-5.5"):
    return {
        "model_id": model_id, "label": model_id, "protocol": "openai",
        "base_url": "https://api.example.com/v1", "api_key": "sk-test",
        "reasoning_efforts": ["auto"], "default_reasoning_effort": "auto",
        "capabilities": ["旗舰", "多模态", "vision"], "enabled": True,
    }


class _Patches:
    """把 patch 对象列表包装成可 with 的上下文管理器（等价于 with ExitStack）。"""

    def __init__(self, patches):
        self._patches = patches

    def __enter__(self):
        for p in self._patches:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in reversed(self._patches):
            p.stop()
        return False


def _base_patches(conn=None, active_model=None, vision_default=None):
    """send_message 全链路 mock 的公共 patch 栈；返回 (patches, conn, captured)。

    默认 active_model 为视觉模型（不触发切换）；传 active_model=_no_vision_model()
    配合 vision_default 控制切换/报错场景。LLMClient.protocol 强制返回 anthropic
    → use_agent=False，走普通通道 ChatService.chat_stream（最小 mock 面）。
    """
    captured = {"chat_stream_calls": []}
    db_patch, conn = _mock_get_db(conn)

    async def _fake_prepare(session_id, model=None, attached_docs=None, system_prompt="", override=None):
        return [
            {"role": "user", "content": "上一轮问题"},
            {"role": "assistant", "content": "上一轮回答"},
            {"role": "user", "content": "看图说话"},
        ]

    async def _fake_chat_stream(history, reasoning_effort, model=None, attached_docs=None, prebuilt_messages=None):
        captured["chat_stream_calls"].append({"model": model, "messages": prebuilt_messages})
        yield {"type": "done", "text": "这是一张图", "thinking": ""}

    patches = [
        db_patch,
        patch.object(chat_module, "get_active_model", return_value=active_model or _vision_model()),
        patch.object(chat_module, "get_vision_default", return_value=vision_default),
        patch.object(chat_module, "get_llm_config", return_value={"model": "gpt-5.5"}),
        patch.object(chat_module.LLMClient, "protocol", return_value="anthropic"),  # 强制走普通通道
        patch.object(chat_module.BannedWordsService, "check", return_value=False),
        patch.object(chat_module, "get_entitlements_in_conn", return_value={
            "active": True, "allowed_models": None,
            "features": {"web_search": False, "file_upload": True},
            "max_concurrent_requests": 2,
        }),
        patch.object(chat_module.BillingService, "charge_points", return_value=Decimal("1")),
        patch.object(chat_module.PointsService, "consume_ai_chat", return_value={
            "balance": 100.0, "mode": "subscription", "remaining": 5,
        }),
        patch.object(chat_module.PointsService, "chat_daily_total", return_value=5),
        patch.object(chat_module.PointsService, "get_allocation_breakdown",
                     return_value={"subscription_points_used": 0, "wallet_points_used": 0}),
        patch.object(chat_module.BillingService, "get_model_price_snapshot",
                     return_value={"points_per_1k": {"input": None, "output": None, "cache_read": None, "cache_creation": None}, "pricing_version_id": None}),
        patch.object(chat_module, "build_system_prompt", return_value="system"),
        patch.object(chat_module.ChatService, "prepare_session_messages", new=_fake_prepare),
        patch.object(chat_module.ChatService, "chat_stream", new=_fake_chat_stream),
    ]
    return _Patches(patches), conn, captured


def _consume_sse(resp):
    """消费 StreamingResponse 的 SSE 事件，返回 [(event, data_dict), ...]。"""
    events = []

    async def _drain():
        async for chunk in resp.body_iterator:
            text = chunk.decode("utf-8") if isinstance(chunk, bytes) else str(chunk)
            for line in text.splitlines():
                if line.startswith("event:"):
                    events.append([line[len("event:"):].strip(), None])
                elif line.startswith("data:"):
                    events[-1][1] = json.loads(line[len("data:"):].strip())

    _run(_drain())
    return events


# ---------------------------------------------------------------------------
# 1. 图片上传：写入 chat_files（status=image，不解析、不 OCR）
# ---------------------------------------------------------------------------

def test_upload_image_writes_chat_files(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    monkeypatch.setattr(chat_module, "MAX_FILE_SIZE", 20 * 1024 * 1024)
    monkeypatch.setattr(chat_module, "ensure_user_uploads", lambda user_id: (uploads.mkdir(parents=True, exist_ok=True), uploads)[1])
    monkeypatch.setattr(chat_module, "ensure_workspace_capacity", lambda *a, **k: None)

    conn = MagicMock(name="db_conn")
    conn.execute.side_effect = _execute_side_effect
    file_mock = MagicMock(name="upload_file")
    file_mock.filename = "photo.png"
    file_mock.content_type = "image/png"
    file_mock.read = AsyncMock(side_effect=[PNG_BYTES, b""])

    with _mock_get_db(conn)[0], \
            patch.object(chat_module, "get_entitlements_in_conn", return_value={
                "features": {"file_upload": True, "max_chat_files": 20},
            }), \
            patch.object(chat_module, "parse_file") as mock_parse:
        result = _run(chat_module.upload_chat_file(session_id=SESSION_ID, file=file_mock, user=USER))

    # 返回 file_id 与 kind=image
    assert result["file_id"] == 1
    assert result["kind"] == "image"
    assert result["original_name"] == "photo.png"
    # 未调用 parse_file（不 OCR、不解析）
    mock_parse.assert_not_called()
    # 文件真实落盘到 uploads 目录
    saved = list(uploads.iterdir())
    assert len(saved) == 1 and saved[0].read_bytes() == PNG_BYTES
    # INSERT chat_files 参数：content_type=image/png、page_content=[image]、status=image
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO chat_files" in str(c.args[0])]
    assert len(insert_calls) == 1
    params = insert_calls[0].args[1]
    assert params[0] == SESSION_ID and params[1] == USER["user_id"]
    assert params[3] == "photo.png"
    assert params[4] == "image/png"
    assert params[5] == "[image]"
    assert params[6] == 0
    assert params[7] == "image"


def test_upload_image_skips_utf8_check(tmp_path, monkeypatch):
    """图片内容为二进制（非 UTF-8）也能上传：不进入 _validate_chat_doc 的文本校验。"""
    uploads = tmp_path / "uploads"
    monkeypatch.setattr(chat_module, "MAX_FILE_SIZE", 20 * 1024 * 1024)
    monkeypatch.setattr(chat_module, "ensure_user_uploads", lambda user_id: (uploads.mkdir(parents=True, exist_ok=True), uploads)[1])
    monkeypatch.setattr(chat_module, "ensure_workspace_capacity", lambda *a, **k: None)
    conn = MagicMock(name="db_conn")
    conn.execute.side_effect = _execute_side_effect
    file_mock = MagicMock(name="upload_file")
    file_mock.filename = "pic.jpg"
    file_mock.content_type = None  # 无 content_type → 按扩展名推断 image/jpeg
    raw = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\xff" * 16  # 非 UTF-8 二进制
    file_mock.read = AsyncMock(side_effect=[raw, b""])

    with _mock_get_db(conn)[0], \
            patch.object(chat_module, "get_entitlements_in_conn", return_value={
                "features": {"file_upload": True, "max_chat_files": 20},
            }), \
            patch.object(chat_module, "parse_file") as mock_parse:
        result = _run(chat_module.upload_chat_file(session_id=SESSION_ID, file=file_mock, user=USER))

    assert result["kind"] == "image"
    mock_parse.assert_not_called()
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO chat_files" in str(c.args[0])]
    params = insert_calls[0].args[1]
    assert params[4] == "image/jpeg"  # 无 content_type 时按扩展名推断真实 MIME
    assert params[7] == "image"


# ---------------------------------------------------------------------------
# 2. 带图发送：最后一条 user 消息含图片块（mock LLM 调用层）
# ---------------------------------------------------------------------------

def test_send_with_image_attaches_image_block(tmp_path, monkeypatch):
    monkeypatch.setattr(chat_module.config, "USER_WORKSPACES_DIR", tmp_path)
    patches, conn, captured = _base_patches()  # active 为视觉模型 → 不切换
    with patches:
        resp = _run(chat_module.send_message(
            SESSION_ID, ChatSendRequest(content="看图说话", image_file_ids=[IMAGE_FILE_ID]), USER,
        ))
        events = _consume_sse(resp)  # event_generator 惰性执行，必须在 patch 生效期内消费

    # 断言传给 LLM 的最后一条 user 消息 content 是 list：先 text 块后 image 块
    assert len(captured["chat_stream_calls"]) == 1
    messages = captured["chat_stream_calls"][0]["messages"]
    last_user = [m for m in messages if m["role"] == "user"][-1]
    assert isinstance(last_user["content"], list)
    assert last_user["content"][0] == {"type": "text", "text": "看图说话"}
    assert last_user["content"][1]["type"] == "image"
    assert last_user["content"][1]["path"].endswith("uploads/aaa.png")
    # 历史消息不动（仍是字符串）
    for m in messages[:-1]:
        assert isinstance(m["content"], str)

    # SSE：user_message_id 事件带 image_files；模型支持视觉 → model_switched=false
    umi = [d for e, d in events if e == "user_message_id"][0]
    assert umi["image_files"] == [{"id": IMAGE_FILE_ID, "original_name": "photo.png", "content_type": "image/png"}]
    assert umi["model_switched"] is False
    done = [d for e, d in events if e == "done"][0]
    assert done["text"] == "这是一张图"
    assert done["model_switched"] is False


def test_attach_image_blocks_no_images_returns_same_list():
    """不带图时消息构造完全不变（返回原列表对象，content 不被改写）。"""
    messages = [{"role": "user", "content": "你好"}]
    result = _attach_image_blocks(messages, [])
    assert result is messages
    assert messages[0]["content"] == "你好"


def test_attach_image_blocks_str_content_upgraded():
    messages = [
        {"role": "user", "content": "上一轮"},
        {"role": "assistant", "content": "回答"},
        {"role": "user", "content": "看图"},
    ]
    blocks = [{"type": "image", "path": "/tmp/a.png"}]
    result = _attach_image_blocks(messages, blocks)
    # 附加到最后一条 user 消息；其余消息不动
    assert result[0] == {"role": "user", "content": "上一轮"}
    assert result[2]["content"] == [
        {"type": "text", "text": "看图"},
        {"type": "image", "path": "/tmp/a.png"},
    ]


def test_attach_image_blocks_list_content_appended():
    messages = [{"role": "user", "content": [{"type": "text", "text": "已有"}]}]
    result = _attach_image_blocks(messages, [{"type": "image", "path": "/tmp/b.png"}])
    assert result[0]["content"] == [
        {"type": "text", "text": "已有"},
        {"type": "image", "path": "/tmp/b.png"},
    ]


# ---------------------------------------------------------------------------
# 3. 模型无 vision：自动切换到默认视觉模型
# ---------------------------------------------------------------------------

def test_send_switches_to_vision_model_when_target_lacks_vision(tmp_path):
    with patch.object(chat_module.config, "USER_WORKSPACES_DIR", tmp_path):
        patches, conn, captured = _base_patches(
            active_model=_no_vision_model(), vision_default=_vision_model("gpt-5.5"),
        )
        with patches:
            resp = _run(chat_module.send_message(
                SESSION_ID, ChatSendRequest(content="看图说话", image_file_ids=[IMAGE_FILE_ID]), USER,
            ))
            events = _consume_sse(resp)  # event_generator 惰性执行，必须在 patch 生效期内消费

    # 传给 LLM 的 model 已切换为视觉模型
    assert captured["chat_stream_calls"][0]["model"]["model_id"] == "gpt-5.5"
    # 图片块仍在最后一条 user 消息上
    messages = captured["chat_stream_calls"][0]["messages"]
    last_user = [m for m in messages if m["role"] == "user"][-1]
    assert any(b.get("type") == "image" for b in last_user["content"])
    # SSE done / user_message_id 事件带 model_switched=true
    done = [d for e, d in events if e == "done"][0]
    assert done["model_switched"] is True
    umi = [d for e, d in events if e == "user_message_id"][0]
    assert umi["model_switched"] is True


# ---------------------------------------------------------------------------
# 4. 无 vision 且无默认视觉模型：明确报错（扣费前拒绝）
# ---------------------------------------------------------------------------

def test_send_no_vision_and_no_default_raises_clear_error():
    patches, conn, _ = _base_patches(active_model=_no_vision_model(), vision_default=None)
    with patches:
        with pytest.raises(HTTPException) as ei:
            _run(chat_module.send_message(
                SESSION_ID, ChatSendRequest(content="看图说话", image_file_ids=[IMAGE_FILE_ID]), USER,
            ))
    assert ei.value.status_code == 400
    assert "当前模型不支持图片识别" in ei.value.detail
    # 报错发生在扣费/落库之前：INSERT chat_messages 未执行
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO chat_messages" in str(c.args[0])]
    assert insert_calls == []


# ---------------------------------------------------------------------------
# 5. 图片不属于本会话：拒绝
# ---------------------------------------------------------------------------

def test_send_image_not_in_session_raises():
    def _empty_images(sql, *params):
        cur = MagicMock()
        if "FROM chat_files WHERE id = ANY(%s) AND session_id = %s AND user_id = %s AND status = 'image'" in str(sql):
            cur.fetchall.return_value = []
        return cur

    conn = MagicMock()
    conn.execute.side_effect = _empty_images
    patches, _, _ = _base_patches(conn=conn)
    with patches:
        with pytest.raises(HTTPException) as ei:
            _run(chat_module.send_message(
                SESSION_ID, ChatSendRequest(content="看图", image_file_ids=[999]), USER,
            ))
    assert ei.value.status_code == 404
    assert "图片不存在或不属于当前会话" in ei.value.detail


# ---------------------------------------------------------------------------
# llm_model_service：has_vision / get_vision_default
# ---------------------------------------------------------------------------

def test_has_vision_case_insensitive():
    assert llm_model_service.has_vision({"capabilities": ["旗舰", "Vision"]}) is True
    assert llm_model_service.has_vision({"capabilities": ["多模态"]}) is False
    assert llm_model_service.has_vision({"capabilities": []}) is False
    assert llm_model_service.has_vision(None) is False


def test_get_vision_default_returns_first_enabled_vision_model():
    rows = [
        {"model_id": "a", "capabilities": [], "enabled": True},
        {"model_id": "b", "capabilities": ["vision"], "enabled": False},  # disabled 跳过
        {"model_id": "c", "capabilities": ["vision"], "enabled": True},
    ]
    with patch.object(llm_model_service, "_read_all", return_value=rows):
        result = llm_model_service.get_vision_default()
    assert result["model_id"] == "c"  # 按 CSV 顺序取第一个 enabled 且含 vision 的


def test_get_vision_default_none_when_no_vision_model():
    rows = [
        {"model_id": "a", "capabilities": [], "enabled": True},
        {"model_id": "b", "capabilities": ["vision"], "enabled": False},
    ]
    with patch.object(llm_model_service, "_read_all", return_value=rows):
        assert llm_model_service.get_vision_default() is None
