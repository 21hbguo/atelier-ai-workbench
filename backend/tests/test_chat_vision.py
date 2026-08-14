"""聊天「发图给视觉模型」功能单元测试。

覆盖：
1. 图片上传成功写入 chat_files（status=image、page_content=[image]、真实 MIME，且不调 parse_file/不 OCR）；
2. 带 image_file_ids 发送：发给 LLM 的最后一条 user 消息 content 升级为 list 且含 image 块
   （mock LLM 调用层 ChatService.chat_stream，断言传入的 prebuilt_messages）；
3. 目标模型无 vision + 识别引擎可用（pick_vision_model 非 None）：不切换模型（model_switched 恒 false），
   系统侧逐张调 recognize_image，识别文本随 user 消息落库（[图片识别] 前缀），图片块不直发；
4. 无 vision 且识别引擎不可用（pick_vision_model 为 None）：降级为说明回复（image_degraded=true，
   图片不直发，不硬报错）；
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
from backend.routers.chat import ChatSendRequest, _attach_image_blocks, _attach_image_note
from backend.services import llm_model_service
from backend.services.chat_task_manager import CHAT_TASK_MANAGER
from backend.services.vision_service import VisionError

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
    elif "VALUES (%s, 'assistant'" in s:
        cur.fetchone.return_value = {"id": 102}  # assistant 占位消息落库（status='streaming'）
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


def _base_patches(conn=None, active_model=None, vision_engine=None):
    """send_message 全链路 mock 的公共 patch 栈；返回 (patches, conn, captured)。

    默认 active_model 为视觉模型（图片直发）；传 active_model=_no_vision_model()
    配合 vision_engine 控制识别/降级场景：vision_engine 为识别引擎 dict（pick_vision_model
    的返回值，非 None → need_recognize 系统侧识别），None → image_degraded 降级。
    LLMClient.protocol 强制返回 anthropic → use_agent=False，走普通通道
    ChatService.chat_stream（最小 mock 面）。
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
        patch.object(chat_module, "pick_vision_model", return_value=vision_engine),
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


@pytest.fixture(autouse=True)
def _cleanup_chat_tasks():
    """测试隔离：清空内存任务表（终态任务本应自清，失败用例可能残留）。"""
    CHAT_TASK_MANAGER._tasks.clear()
    yield
    CHAT_TASK_MANAGER._tasks.clear()


async def _send_and_wait(session_id, body, user):
    """任务制发送：POST 返回 {task_id,...} 后等待后台任务跑完，返回 (result, task)。"""
    result = await chat_module.send_message(session_id, body, user)
    task = CHAT_TASK_MANAGER.get(result["task_id"])
    assert task is not None, "任务应注册到内存管理器"
    try:
        await asyncio.wait_for(task.asyncio_task, timeout=5)
    except asyncio.TimeoutError:
        raise AssertionError(f"后台任务 5s 未完成: {result['task_id']}")
    return result, task


def _task_events(task):
    """从任务事件环提取 [(event, data_dict), ...]（终态后任务已从管理器移除，对象引用仍可读）。"""
    return [(item["type"], item["data"]) for item in task.events]


def _user_message_content(conn):
    """从 conn.execute 调用记录里提取 user 消息落库的 content（含 [图片识别] 注入后的文本）。"""
    for call in conn.execute.call_args_list:
        if "INSERT INTO chat_messages" in str(call.args[0]) and "VALUES (%s, 'user'" in str(call.args[0]):
            return call.args[1][1]
    return None


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
        result, task = _run(_send_and_wait(
            SESSION_ID, ChatSendRequest(content="看图说话", image_file_ids=[IMAGE_FILE_ID]), USER,
        ))

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

    # 任务制契约：POST 返回三个 id；done 事件带 model_switched=false（不再有 user_message_id 事件）
    assert result["user_message_id"] == 101
    assert result["assistant_message_id"] == 102
    assert result["task_id"] == "chat-102"
    events = _task_events(task)
    assert not any(e == "user_message_id" for e, _ in events)
    done = [d for e, d in events if e == "done"][0]
    assert done["text"] == "这是一张图"
    assert done["model_switched"] is False
    assert done["message_id"] == 102


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
# 3. 模型无 vision + 识别引擎可用：系统侧识别注入（不切换模型）
# ---------------------------------------------------------------------------

def test_send_no_vision_system_recognize_injects_text(tmp_path):
    """主模型无 vision + 识别引擎可用：不切换模型，系统侧逐张识别，
    识别文本随 user 消息落库（[图片识别] 前缀），图片块不直发。"""
    with patch.object(chat_module.config, "USER_WORKSPACES_DIR", tmp_path):
        patches, conn, captured = _base_patches(
            active_model=_no_vision_model(), vision_engine=_vision_model("gpt-5.6-luna"),
        )
        with patches, \
             patch.object(chat_module, "recognize_image",
                          new=AsyncMock(return_value="图片里有一只猫")) as mock_rec:
            result, task = _run(_send_and_wait(
                SESSION_ID, ChatSendRequest(content="看图说话", image_file_ids=[IMAGE_FILE_ID]), USER,
            ))

    # 系统侧识别调用 1 次，参数正确（用户 id + 图片行）
    assert mock_rec.await_count == 1
    assert mock_rec.await_args.args[0] == USER["user_id"]
    assert mock_rec.await_args.args[1]["original_name"] == "photo.png"
    # 模型未切换：发给 LLM 的仍是原无 vision 模型
    assert len(captured["chat_stream_calls"]) == 1
    assert captured["chat_stream_calls"][0]["model"]["model_id"] == "no-vision"
    # 图片不直发：最后一条 user 消息没有 image 块（image_blocks 为空，content 保持原样）
    messages = captured["chat_stream_calls"][0]["messages"]
    last_user = [m for m in messages if m["role"] == "user"][-1]
    assert not isinstance(last_user["content"], list) or \
        not any(b.get("type") == "image" for b in last_user["content"])
    # 识别文本随 user 消息落库：[图片识别] 前缀 + 识别原文
    user_content = _user_message_content(conn)
    assert "[图片识别] photo.png (file_id=11)：图片里有一只猫" in user_content
    # done 事件：model_switched 恒 false、非降级
    done = [d for e, d in _task_events(task) if e == "done"][0]
    assert done["model_switched"] is False
    assert done["image_degraded"] is False
    assert result["user_message_id"] == 101


def test_send_no_vision_multiple_images_recognized_in_order(tmp_path):
    """多图识别：逐张调用 recognize_image，user 消息按序注入两条 [图片识别] 文本。"""
    def _two_images(sql, *params):
        cur = _execute_side_effect(sql, *params)
        if "FROM chat_files WHERE id = ANY(%s)" in str(sql) and "status = 'image'" in str(sql):
            cur.fetchall.return_value = [
                {"id": IMAGE_FILE_ID, "original_name": "photo.png",
                 "storage_name": "uploads/aaa.png", "content_type": "image/png"},
                {"id": IMAGE_FILE_ID + 1, "original_name": "photo2.png",
                 "storage_name": "uploads/bbb.png", "content_type": "image/png"},
            ]
        return cur

    conn = MagicMock(name="db_conn")
    conn.execute.side_effect = _two_images
    with patch.object(chat_module.config, "USER_WORKSPACES_DIR", tmp_path):
        patches, conn, captured = _base_patches(
            conn=conn, active_model=_no_vision_model(), vision_engine=_vision_model("gpt-5.6-luna"),
        )
        with patches, \
             patch.object(chat_module, "recognize_image", new=AsyncMock(side_effect=[
                 "第一张图里有一只猫", "第二张图里有一条狗",
             ])) as mock_rec:
            result, task = _run(_send_and_wait(
                SESSION_ID,
                ChatSendRequest(content="看图说话", image_file_ids=[IMAGE_FILE_ID, IMAGE_FILE_ID + 1]),
                USER,
            ))

    # 每张图各识别一次，按序注入
    assert mock_rec.await_count == 2
    user_content = _user_message_content(conn)
    assert "[图片识别] photo.png (file_id=11)：第一张图里有一只猫" in user_content
    assert "[图片识别] photo2.png (file_id=12)：第二张图里有一条狗" in user_content
    assert user_content.index("photo.png") < user_content.index("photo2.png")
    # 图片不直发
    messages = captured["chat_stream_calls"][0]["messages"]
    last_user = [m for m in messages if m["role"] == "user"][-1]
    assert not isinstance(last_user["content"], list) or \
        not any(b.get("type") == "image" for b in last_user["content"])


def test_send_no_vision_recognize_failure_injects_failed_note(tmp_path):
    """单张识别失败（VisionError）：user 消息注入「识别失败」文本，请求不中断、对话正常继续。"""
    with patch.object(chat_module.config, "USER_WORKSPACES_DIR", tmp_path):
        patches, conn, captured = _base_patches(
            active_model=_no_vision_model(), vision_engine=_vision_model("gpt-5.6-luna"),
        )
        with patches, \
             patch.object(chat_module, "recognize_image",
                          new=AsyncMock(side_effect=VisionError("识别服务调用失败：接口超时"))):
            result, task = _run(_send_and_wait(
                SESSION_ID, ChatSendRequest(content="看图说话", image_file_ids=[IMAGE_FILE_ID]), USER,
            ))

    # 失败降级为「识别失败」文本注入，请求不中断
    user_content = _user_message_content(conn)
    assert "[图片识别] photo.png (file_id=11)：识别失败" in user_content
    assert len(captured["chat_stream_calls"]) == 1  # 对话正常继续
    done = [d for e, d in _task_events(task) if e == "done"][0]
    assert done["text"] == "这是一张图"
    assert done["model_switched"] is False


# ---------------------------------------------------------------------------
# 4. 无 vision 且无默认视觉模型：降级为自然回复（不硬报错）
# ---------------------------------------------------------------------------

def test_send_no_vision_and_no_engine_degrades_to_note():
    """无视觉且识别引擎不可用（pick_vision_model 返回 None）：不报错——消息注入说明文本
    （图片不直发），模型自然回复，正常扣费落库。"""
    patches, conn, captured = _base_patches(active_model=_no_vision_model(), vision_engine=None)
    with patches:
        result, task = _run(_send_and_wait(
            SESSION_ID, ChatSendRequest(content="看图说话", image_file_ids=[IMAGE_FILE_ID]), USER,
        ))

    # 发给 LLM 的消息：最后一条 user 消息是 list，含说明文本块、无 image 块（图片不直发）
    assert len(captured["chat_stream_calls"]) == 1
    messages = captured["chat_stream_calls"][0]["messages"]
    last_user = [m for m in messages if m["role"] == "user"][-1]
    assert isinstance(last_user["content"], list)
    assert last_user["content"][0] == {"type": "text", "text": "看图说话"}
    assert last_user["content"][1]["type"] == "text"
    assert "不支持图片识别" in last_user["content"][1]["text"]
    assert not any(b.get("type") == "image" for b in last_user["content"])
    # 模型未切换（仍是原模型）
    assert captured["chat_stream_calls"][0]["model"]["model_id"] == "no-vision"

    # done 事件带 image_degraded=true、model_switched=false；正常得到回复并落库
    events = _task_events(task)
    done = [d for e, d in events if e == "done"][0]
    assert done["image_degraded"] is True
    assert done["model_switched"] is False
    assert done["text"] == "这是一张图"  # 正常得到回复（fake chat_stream 返回）
    # 正常落库：INSERT chat_messages 已执行（user 消息 + assistant 占位消息）
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO chat_messages" in str(c.args[0])]
    assert len(insert_calls) >= 2


def test_attach_image_note_injects_text_block():
    """降级注入：最后一条 user 消息追加说明文本块；content 为 str 时升级为 list。"""
    messages = [
        {"role": "user", "content": "上一轮"},
        {"role": "assistant", "content": "回答"},
        {"role": "user", "content": "看图"},
    ]
    result = _attach_image_note(messages)
    assert result[2]["content"] == [
        {"type": "text", "text": "看图"},
        {"type": "text", "text": "【系统说明】用户刚刚上传了一张图片，但当前模型不支持图片识别（未配置视觉能力），"
         "你无法看到该图片内容。请如实告知用户：本模型无法查看图片，"
         "建议切换到支持视觉的模型（如 GPT-5.6 系列）后重新发送图片。"},
    ]
    assert "不支持图片识别" in result[2]["content"][1]["text"]
    assert result[0] == {"role": "user", "content": "上一轮"}  # 其它消息不动


def test_send_no_vision_agent_channel_registers_recognize_tool(tmp_path, monkeypatch):
    """agent 通道（protocol=openai → use_agent=True）主模型无 vision + 识别引擎可用：
    image_recognize 常态注册（不再要求 image_degraded），且系统侧识别文本注入 user 消息。"""
    monkeypatch.setattr(chat_module.config, "USER_WORKSPACES_DIR", tmp_path)
    captured = {"agent_calls": []}

    async def _fake_prepare(session_id, model=None, attached_docs=None, system_prompt="", override=None):
        return [{"role": "user", "content": "看图说话"}]

    async def _fake_agent_stream(**kwargs):
        captured["agent_calls"].append({"messages": kwargs["messages"], "tools_names": kwargs["tools_names"]})
        yield {"type": "done", "text": "我看到图里有猫", "thinking": ""}

    patches, conn, _ = _base_patches(
        active_model=_no_vision_model(), vision_engine=_vision_model("gpt-5.6-luna"),
    )
    with patches:
        # 覆盖两处：LLMClient.protocol 返回 openai（use_agent=True）→ 走 agent 通道；
        # prepare_session_messages / run_agent_stream 换成 fake；系统侧识别 mock
        with patch.object(chat_module.LLMClient, "protocol", return_value="openai"), \
             patch.object(chat_module.ChatService, "prepare_session_messages", new=_fake_prepare), \
             patch.object(chat_module, "run_agent_stream", new=_fake_agent_stream), \
             patch.object(chat_module, "recognize_image",
                          new=AsyncMock(return_value="图片里有一只猫")):
            result, task = _run(_send_and_wait(
                SESSION_ID, ChatSendRequest(content="看图说话", image_file_ids=[IMAGE_FILE_ID]), USER,
            ))

    assert len(captured["agent_calls"]) == 1
    call = captured["agent_calls"][0]
    # 常态注册 image_recognize 工具（need_recognize，不要求 image_degraded）
    assert "image_recognize" in call["tools_names"]
    # 图片不直发（image_blocks 为空，content 保持原样）
    last_user = [m for m in call["messages"] if m["role"] == "user"][-1]
    assert not isinstance(last_user["content"], list) or \
        not any(b.get("type") == "image" for b in last_user["content"])
    # 系统侧识别文本随 user 消息落库
    user_content = _user_message_content(conn)
    assert "[图片识别] photo.png (file_id=11)：图片里有一只猫" in user_content
    events = _task_events(task)
    done = [d for e, d in events if e == "done"][0]
    assert done["image_degraded"] is False
    assert done["model_switched"] is False
    assert done["text"] == "我看到图里有猫"


def test_send_no_vision_agent_channel_no_engine_skips_recognize_tool(tmp_path, monkeypatch):
    """识别引擎不可用 + agent 通道：image_degraded 降级，image_recognize 不注册，
    注入说明（不带 file_ids，避免误导模型调用必失败的 image_recognize）。"""
    monkeypatch.setattr(chat_module.config, "USER_WORKSPACES_DIR", tmp_path)
    captured = {"agent_calls": []}

    async def _fake_prepare(session_id, model=None, attached_docs=None, system_prompt="", override=None):
        return [{"role": "user", "content": "看图说话"}]

    async def _fake_agent_stream(**kwargs):
        captured["agent_calls"].append({"messages": kwargs["messages"], "tools_names": kwargs["tools_names"]})
        yield {"type": "done", "text": "我看不了图", "thinking": ""}

    patches, conn, _ = _base_patches(active_model=_no_vision_model(), vision_engine=None)
    with patches:
        with patch.object(chat_module.LLMClient, "protocol", return_value="openai"), \
             patch.object(chat_module.ChatService, "prepare_session_messages", new=_fake_prepare), \
             patch.object(chat_module, "run_agent_stream", new=_fake_agent_stream):
            result, task = _run(_send_and_wait(
                SESSION_ID, ChatSendRequest(content="看图说话", image_file_ids=[IMAGE_FILE_ID]), USER,
            ))

    assert len(captured["agent_calls"]) == 1
    call = captured["agent_calls"][0]
    # image_degraded：不注册 image_recognize（工具列表只有常规工具）
    assert "image_recognize" not in call["tools_names"]
    # 降级说明注入：最后一条 user 消息含说明块（不带 file_ids）、无 image 块
    last_user = [m for m in call["messages"] if m["role"] == "user"][-1]
    assert isinstance(last_user["content"], list)
    assert not any(b.get("type") == "image" for b in last_user["content"])
    note = [b for b in last_user["content"] if b.get("type") == "text" and "系统说明" in b.get("text", "")]
    assert note and "不支持图片识别" in note[0]["text"]
    assert str(IMAGE_FILE_ID) not in note[0]["text"]  # 不引导调用必失败的 image_recognize
    # 未做系统侧识别：落库 user 消息无 [图片识别] 注入
    assert _user_message_content(conn) == "看图说话"
    events = _task_events(task)
    done = [d for e, d in events if e == "done"][0]
    assert done["image_degraded"] is True


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
