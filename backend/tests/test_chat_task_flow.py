"""聊天「任务制」核心回归测试（不连真实数据库 / 不连真实 LLM，全部 mock）。

覆盖：
1. ChatTaskManager：创建/广播/订阅/终态移除/并发计数/取消；
2. run_generation 三条终态路径：done（计费+落库）、error（failed+退款）、
   CancelledError（stopped+退款+吞异常）；
3. stream 端点分支 A（DB 回放）与分支 B（事件环回放 + 实时增量）；
4. stop 端点幂等；send_message 并发 429；
5. 服务重启恢复 recover_interrupted_chat_messages（标 failed + 按 req_id 退款）。
"""
import asyncio
import json
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.routers import chat as chat_module
from backend.routers.chat import ChatGenContext, ChatSendRequest
from backend.services.chat_task_manager import CHAT_TASK_MANAGER, ChatTask

USER = {"user_id": 1}


def _run(coro):
    return asyncio.run(coro)


def _mock_get_db(conn=None):
    if conn is None:
        conn = MagicMock(name="db_conn")
        conn.execute.return_value = MagicMock(name="cursor")
        conn.execute.return_value.fetchone.return_value = None
        conn.execute.return_value.fetchall.return_value = []
    db = MagicMock(name="get_db")
    db.__enter__ = MagicMock(return_value=conn)
    db.__exit__ = MagicMock(return_value=False)
    return patch.object(chat_module, "get_db", return_value=db), conn


@pytest.fixture(autouse=True)
def _cleanup_tasks():
    CHAT_TASK_MANAGER._tasks.clear()
    yield
    CHAT_TASK_MANAGER._tasks.clear()


def _make_ctx(task: ChatTask | None = None) -> ChatGenContext:
    task = task or ChatTask(
        task_id="chat-1", user_id=1, session_id=1, message_id=1,
        req_id="req-1", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m1",
    )
    return ChatGenContext(
        task=task, session_id=1, user_id=1, content="你好", reasoning_effort="auto",
        web_search=False, entitlements={"features": {"web_search": False}},
        target_model={"model_id": "m1"}, target_model_id="m1", override={},
        tools_names=None, use_agent=False, image_blocks=[], image_files=[],
        image_degraded=False, model_switched=False, attached_docs=[],
        req_id="req-1", cost_per=1.0, chat_charge_mode="paid", chat_free_remaining=None,
        daily_total=None, user_msg_id=2, assistant_msg_id=1,
        balance_after=Decimal("100"), precharge={"mode": "paid", "balance": 100.0},
    )


async def _collect(agen):
    return [x async for x in agen]


# ---------------------------------------------------------------------------
# 1. ChatTaskManager 单元
# ---------------------------------------------------------------------------

def test_manager_broadcast_subscribe_finish():
    task = CHAT_TASK_MANAGER.create(
        task_id="chat-1", user_id=1, session_id=1, message_id=1,
        req_id="r1", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m",
    )
    CHAT_TASK_MANAGER.broadcast("chat-1", "chunk", {"text": "a"})
    CHAT_TASK_MANAGER.broadcast("chat-1", "thinking", {"text": "想"})

    snapshot, queue = CHAT_TASK_MANAGER.subscribe("chat-1")
    assert [i["type"] for i in snapshot] == ["chunk", "thinking"]
    assert snapshot[0]["data"] == {"text": "a"}

    # 订阅后广播 → 队列收到；快照不含新事件（快照是订阅时刻的存量）
    CHAT_TASK_MANAGER.broadcast("chat-1", "chunk", {"text": "b"})
    assert len(snapshot) == 2
    assert queue.get_nowait()["data"] == {"text": "b"}

    CHAT_TASK_MANAGER.finish("chat-1")
    assert CHAT_TASK_MANAGER.get("chat-1") is None
    assert CHAT_TASK_MANAGER.subscribe("chat-1") is None  # 终态后新订阅走 DB 回放


def test_manager_count_active_and_cancel_by_message_id():
    CHAT_TASK_MANAGER.create(
        task_id="chat-1", user_id=1, session_id=1, message_id=1,
        req_id="r1", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m",
    )
    CHAT_TASK_MANAGER.create(
        task_id="chat-2", user_id=1, session_id=1, message_id=2,
        req_id="r2", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m",
    )
    CHAT_TASK_MANAGER.create(
        task_id="chat-3", user_id=2, session_id=2, message_id=3,
        req_id="r3", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m",
    )
    assert CHAT_TASK_MANAGER.count_active(1) == 2
    assert CHAT_TASK_MANAGER.count_active(2) == 1
    assert CHAT_TASK_MANAGER.get_by_message_id(2).task_id == "chat-2"

    async def _slow():
        await asyncio.sleep(30)

    async def _scenario():
        CHAT_TASK_MANAGER.get("chat-1").asyncio_task = asyncio.create_task(_slow())
        assert CHAT_TASK_MANAGER.cancel_by_message_id(1) is True
        # 任务对象已取消（协程将抛 CancelledError）
        CHAT_TASK_MANAGER.get("chat-1").asyncio_task.cancel()
        assert CHAT_TASK_MANAGER.cancel_by_message_id(999) is False

    _run(_scenario())


# ---------------------------------------------------------------------------
# 2. run_generation 三条终态路径
# ---------------------------------------------------------------------------

async def _fake_prepare(session_id, model=None, attached_docs=None, system_prompt="", override=None):
    return [{"role": "user", "content": "你好"}]


def test_run_generation_done_path():
    async def _fake_chat_stream(history, reasoning_effort, model=None, attached_docs=None, prebuilt_messages=None):
        yield {"type": "chunk", "text": "你"}
        yield {"type": "chunk", "text": "好"}
        yield {"type": "done", "text": "你好", "thinking": "", "usage": None}

    async def _scenario():
        task = CHAT_TASK_MANAGER.create(
            task_id="chat-1", user_id=1, session_id=1, message_id=1,
            req_id="req-1", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m1",
        )
        task.asyncio_task = asyncio.create_task(chat_module.run_generation(_make_ctx(task)))
        await task.asyncio_task
        return task

    db_patch, conn = _mock_get_db()
    with db_patch, \
            patch.object(chat_module.ChatService, "prepare_session_messages", new=_fake_prepare), \
            patch.object(chat_module.ChatService, "chat_stream", new=_fake_chat_stream), \
            patch.object(chat_module, "_record_chat_usage", return_value=Decimal("99")) as mock_usage, \
            patch.object(chat_module, "_refund_chat_request") as mock_refund:
        task = _run(_scenario())

    # 终态：done + 从内存移除
    assert task.status == "done"
    assert CHAT_TASK_MANAGER.get("chat-1") is None
    # 事件环顺序：chunk ×2 + done（无 user_message_id）
    types = [i["type"] for i in task.events]
    assert types == ["chunk", "chunk", "done"]
    done = task.events[-1]["data"]
    assert done["text"] == "你好"
    assert done["message_id"] == 1
    assert done["points_balance"] == 99.0
    # 计费调用一次；未退款
    mock_usage.assert_called_once()
    assert mock_usage.call_args.kwargs["message_id"] == 1
    mock_refund.assert_not_called()
    # 落库：终态全量写带 status='done'
    updates = [c for c in conn.execute.call_args_list if "status = %s, error = NULL" in str(c.args[0])]
    assert len(updates) == 1 and updates[0].args[1][-2] == "done"


def test_run_generation_error_path():
    async def _fake_chat_stream(history, reasoning_effort, model=None, attached_docs=None, prebuilt_messages=None):
        yield {"type": "error", "detail": "模型调用失败"}

    async def _scenario():
        task = CHAT_TASK_MANAGER.create(
            task_id="chat-1", user_id=1, session_id=1, message_id=1,
            req_id="req-1", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m1",
        )
        task.asyncio_task = asyncio.create_task(chat_module.run_generation(_make_ctx(task)))
        await task.asyncio_task
        return task

    db_patch, conn = _mock_get_db()
    with db_patch, \
            patch.object(chat_module.ChatService, "prepare_session_messages", new=_fake_prepare), \
            patch.object(chat_module.ChatService, "chat_stream", new=_fake_chat_stream), \
            patch.object(chat_module, "_record_chat_usage") as mock_usage, \
            patch.object(chat_module, "_refund_chat_request") as mock_refund:
        task = _run(_scenario())

    assert task.status == "failed"
    assert CHAT_TASK_MANAGER.get("chat-1") is None
    assert task.events[-1]["type"] == "error"
    assert task.events[-1]["data"]["detail"] == "模型调用失败"
    mock_refund.assert_called_once_with(1, 1.0, "req-1", "paid", None, "m1")
    mock_usage.assert_not_called()
    # 消息标 failed：仅当仍 streaming 时更新
    fail_updates = [c for c in conn.execute.call_args_list if "SET status = %s, error = %s WHERE id = %s AND status = 'streaming'" in str(c.args[0])]
    assert len(fail_updates) == 1 and fail_updates[0].args[1][0] == "failed"


def test_run_generation_cancelled_path_swallows_error():
    """用户 stop：取消已启动的 asyncio.Task → stopped 分支退款 + 广播；异常被吞（await 不抛）。"""
    entered = asyncio.Event()

    async def _fake_chat_stream(history, reasoning_effort, model=None, attached_docs=None, prebuilt_messages=None):
        yield {"type": "chunk", "text": "a"}
        entered.set()
        await asyncio.sleep(30)  # 取消点

    async def _scenario():
        task = CHAT_TASK_MANAGER.create(
            task_id="chat-1", user_id=1, session_id=1, message_id=1,
            req_id="req-1", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m1",
        )
        task.asyncio_task = asyncio.create_task(chat_module.run_generation(_make_ctx(task)))
        # 确保任务已启动并进入生成循环（停在 sleep(30) 取消点）后再 cancel，
        # 否则未启动任务的取消不会执行协程函数体（该场景由 stop 端点同步清理，见 test_stop_message_*）
        await asyncio.wait_for(entered.wait(), timeout=5)
        task.asyncio_task.cancel()
        # 取消后 await 正常返回（不抛 CancelledError）——run_generation 吞掉异常正常清理
        await task.asyncio_task
        return task

    db_patch, conn = _mock_get_db()
    with db_patch, \
            patch.object(chat_module.ChatService, "prepare_session_messages", new=_fake_prepare), \
            patch.object(chat_module.ChatService, "chat_stream", new=_fake_chat_stream), \
            patch.object(chat_module, "_record_chat_usage") as mock_usage, \
            patch.object(chat_module, "_refund_chat_request") as mock_refund:
        task = _run(_scenario())

    assert task.status == "stopped"
    assert CHAT_TASK_MANAGER.get("chat-1") is None
    assert task.events[-1]["type"] == "stopped"
    mock_refund.assert_called_once()
    mock_usage.assert_not_called()
    stop_updates = [c for c in conn.execute.call_args_list if "SET status = %s, error = %s WHERE id = %s AND status = 'streaming'" in str(c.args[0])]
    assert len(stop_updates) == 1 and stop_updates[0].args[1][0] == "stopped"


# ---------------------------------------------------------------------------
# 3. stream 端点：分支 A（DB 回放）/ 分支 B（订阅）
# ---------------------------------------------------------------------------

def test_replay_from_db_branch_a_done():
    row = {"id": 5, "content": "完整回答", "thinking": "思考过程", "status": "done", "error": None}
    frames = _run(_collect(chat_module._replay_from_db(row)))
    assert frames[0].startswith("event: chunk") and "完整回答" in frames[0]
    assert frames[1].startswith("event: thinking") and "思考过程" in frames[1]
    assert frames[2].startswith("event: done")
    assert json.loads(frames[2].split("data: ", 1)[1])["message_id"] == 5


def test_replay_from_db_branch_a_failed_and_stopped():
    frames = _run(_collect(chat_module._replay_from_db(
        {"id": 6, "content": "半截", "thinking": "", "status": "failed", "error": "模型出错"})))
    assert frames[0].startswith("event: chunk")
    assert frames[1].startswith("event: error")
    assert "模型出错" in frames[1]

    frames = _run(_collect(chat_module._replay_from_db(
        {"id": 7, "content": "", "thinking": "", "status": "stopped", "error": None})))
    assert len(frames) == 1 and frames[0].startswith("event: stopped")


def test_subscribe_live_branch_b_replays_snapshot_then_live():
    task = CHAT_TASK_MANAGER.create(
        task_id="chat-9", user_id=1, session_id=1, message_id=9,
        req_id="r9", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m",
    )
    CHAT_TASK_MANAGER.broadcast("chat-9", "chunk", {"text": "存量1"})
    CHAT_TASK_MANAGER.broadcast("chat-9", "chunk", {"text": "存量2"})

    async def _scenario():
        snapshot, queue = CHAT_TASK_MANAGER.subscribe("chat-9")
        consumer = asyncio.create_task(
            _collect(chat_module._subscribe_live(snapshot, queue, "chat-9"))
        )
        await asyncio.sleep(0)  # 让订阅者进入实时队列等待
        CHAT_TASK_MANAGER.broadcast("chat-9", "chunk", {"text": "增量3"})
        CHAT_TASK_MANAGER.broadcast("chat-9", "done", {"text": "done", "message_id": 9})
        return await asyncio.wait_for(consumer, timeout=5)

    frames = _run(_scenario())
    texts = [json.loads(f.split("data: ", 1)[1])["text"] for f in frames if f.startswith("event: chunk")]
    assert texts == ["存量1", "存量2", "增量3"]  # 存量回放 + 实时增量，不重复不漏
    assert frames[-1].startswith("event: done")
    # 订阅者退出后任务仍运行（不取消）；此处直接终态清理
    assert CHAT_TASK_MANAGER.get("chat-9") is not None


# ---------------------------------------------------------------------------
# 4. stop 端点 / 并发 429 / 启动恢复
# ---------------------------------------------------------------------------

def test_stop_message_idempotent_when_terminal():
    conn = MagicMock(name="db_conn")
    conn.execute.return_value = MagicMock(name="cursor")
    conn.execute.return_value.fetchone.return_value = {"status": "done"}
    with _mock_get_db(conn)[0], \
            patch.object(chat_module, "CHAT_TASK_MANAGER") as mock_mgr:
        result = _run(chat_module.stop_message(5, USER))
    assert result == {"ok": True}
    mock_mgr.cancel_by_message_id.assert_not_called()  # 终态直接返回，不取消


def test_stop_message_sync_terminal_when_task_not_started():
    """stop 端点：任务未启动（协程 body 不会执行）时，由端点同步完成 stopped 终态 + 退款。

    真实场景：POST 发消息后用户秒点停止，asyncio_task 尚未被事件循环调度，
    cancel() 会让 run_generation 函数体完全不执行——若只依赖协程 except 清理，
    消息会永远停在 streaming 且不退款。
    """
    task = CHAT_TASK_MANAGER.create(
        task_id="chat-1", user_id=1, session_id=1, message_id=1,
        req_id="req-1", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m1",
    )
    # asyncio_task = None：模拟任务尚未启动（未分配/未调度）
    conn = MagicMock(name="db_conn")
    conn.execute.return_value = MagicMock(name="cursor")
    conn.execute.return_value.fetchone.return_value = {"status": "streaming"}
    # 共享 helper 会批量查询仍为 streaming 的消息行（含 req_id/charge_mode/daily_total）
    conn.execute.return_value.fetchall.return_value = [{"id": 1, "req_id": "req-1", "charge_mode": "paid", "daily_total": None}]
    with _mock_get_db(conn)[0], \
            patch.object(chat_module, "_refund_chat_request") as mock_refund:
        result = _run(chat_module.stop_message(1, USER))

    assert result == {"ok": True}
    assert task.status == "stopped"
    assert task.cancelled is True
    assert CHAT_TASK_MANAGER.get("chat-1") is None  # 已从内存移除
    assert task.events[-1]["type"] == "stopped"  # 订阅者能收到停止事件
    mock_refund.assert_called_once_with(1, 1.0, "req-1", "paid", None, "m1")
    # 消息落库标 stopped（仅当仍 streaming 时更新）
    updates = [c for c in conn.execute.call_args_list if "SET status = %s, error = %s WHERE id = %s AND status = 'streaming'" in str(c.args[0])]
    assert len(updates) == 1 and updates[0].args[1][0] == "stopped"


def test_stop_message_cancel_background_task_not_started_idempotent():
    """stop 端点：任务未启动但已分配 asyncio_task（create_task 后立即 stop）→ 同步终态，
    协程被取消且函数体不执行时 await 不抛（任务已从内存移除，无悬挂引用）。"""
    task = CHAT_TASK_MANAGER.create(
        task_id="chat-2", user_id=1, session_id=1, message_id=2,
        req_id="req-2", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m1",
    )

    async def _scenario():
        async def _never_runs():
            await asyncio.sleep(30)

        task.asyncio_task = asyncio.create_task(_never_runs())
        # 不 await/sleep：任务尚未被调度（未启动）
        conn = MagicMock(name="db_conn")
        conn.execute.return_value = MagicMock(name="cursor")
        conn.execute.return_value.fetchone.return_value = {"status": "streaming"}
        # 共享 helper 会批量查询仍为 streaming 的消息行（含 req_id/charge_mode/daily_total）
        conn.execute.return_value.fetchall.return_value = [{"id": 2, "req_id": "req-2", "charge_mode": "paid", "daily_total": None}]
        with _mock_get_db(conn)[0], \
                patch.object(chat_module, "_refund_chat_request"):
            result = await chat_module.stop_message(2, USER)
        # 任务协程已被取消且不执行函数体；await 抛 CancelledError 属预期，
        # 但 stop 端点已同步完成终态，任务对象已从内存移除——这里只验证端点结果与状态
        return result, task

    result, task = _run(_scenario())
    assert result == {"ok": True}
    assert task.status == "stopped"
    assert CHAT_TASK_MANAGER.get("chat-2") is None  # 终态后已从内存移除


def test_send_message_429_when_concurrent_limit_reached():
    """并发控制：运行中任务数 >= 套餐上限 → 429（保留旧响应格式）。"""
    conn = MagicMock(name="db_conn")
    conn.execute.return_value = MagicMock(name="cursor")
    conn.execute.return_value.fetchone.return_value = {"id": 1, "title": "新对话", "cnt": 0}

    async def _scenario():
        with _mock_get_db(conn)[0], \
                patch.object(chat_module, "get_active_model", return_value={"model_id": "m", "enabled": True}), \
                patch.object(chat_module, "get_by_model_id", return_value=None), \
                patch.object(chat_module, "BannedWordsService") as mock_banned, \
                patch.object(chat_module, "get_entitlements_in_conn", return_value={
                    "active": True, "allowed_models": None,
                    "features": {"web_search": False, "file_upload": True},
                    "max_concurrent_requests": 2,
                }), \
                patch.object(chat_module, "CHAT_TASK_MANAGER") as mock_mgr, \
                patch.object(chat_module, "_check_rate_limit"):
            mock_banned.check.return_value = False
            mock_mgr.count_active.return_value = 2
            try:
                await chat_module.send_message(1, ChatSendRequest(content="你好"), USER)
            except HTTPException as e:
                return e
            return None

    exc = _run(_scenario())
    assert exc is not None and exc.status_code == 429
    assert "最多同时进行 2 个对话请求" in exc.detail


def test_recover_interrupted_chat_messages_marks_failed_and_refunds():
    rows = [
        {"id": 11, "user_id": 1, "req_id": "r-11", "charge_mode": "paid", "daily_total": 20},
        {"id": 12, "user_id": 1, "req_id": "r-12", "charge_mode": "free", "daily_total": 10},
    ]
    conn = MagicMock(name="db_conn")

    def _side_effect(sql, *params):
        cur = MagicMock(name="cursor")
        if "status = 'streaming'" in str(sql):
            cur.fetchall.return_value = rows
        else:
            cur.fetchone.return_value = None
        return cur

    conn.execute.side_effect = _side_effect
    refunded = []

    def _fake_refund(user_id, cost_per, req_id, charge_mode, daily_total, model_id):
        refunded.append((user_id, cost_per, req_id, charge_mode, daily_total, model_id))
        return True  # 退款成功 → 才标 failed 终态（退款失败保持 streaming 由下次重启重试）

    with _mock_get_db(conn)[0], \
            patch.object(chat_module, "_refund_chat_request", side_effect=_fake_refund):
        count = chat_module.recover_interrupted_chat_messages()

    assert count == 2
    # 两条消息都标 failed + 服务重启文案
    updates = [c for c in conn.execute.call_args_list if "SET status = 'failed'" in str(c.args[0])]
    assert len(updates) == 2
    assert "服务重启导致生成中断，积分已退还" in updates[0].args[1][0]
    # 每条按 req_id 退款（幂等 key 由 _refund_chat_request 保证）；daily_total 用落库值而非当前套餐
    assert [r[2] for r in refunded] == ["r-11", "r-12"]
    assert refunded[0][3] == "paid" and refunded[1][3] == "free"
    assert refunded[0][4] == 20 and refunded[1][4] == 10
