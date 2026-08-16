"""消息编辑（PATCH 编辑端点 + send_message edit_message_id）回归测试。

覆盖（对照 PR-03 方案 §6 后端清单）：
1. PATCH 校验：会话越权/消息不存在 → 404；role=assistant → 400；空内容 → 400；
   超长 → 422（Pydantic）；违禁词 → 400；目标消息 streaming → 409；
2. PATCH 截断范围：DELETE id > X（保留 X 本身），X 原位更新 content，不新插入；
3. PATCH 事务性：任一校验失败 → 无任何删除/更新副作用；
4. 截断范围内 streaming 消息：任务取消、同步退款一次（幂等 key 由
   _refund_chat_request 保证）、消息行已删；退款失败 → 500 且不截断（回滚）；
5. 压缩修复：X <= summary_until → 重置 summary_until=0/summary_text=NULL；
   X > summary_until → 不变；
6. sendMessage edit_message_id：不插入新 user 消息、返回 user_message_id=X、
   X 内容原位更新、预扣正常、assistant 占位消息正常插入、首条编辑自动更新标题；
7. delete_message 回归：改走共享 helper（同步停止退款）+ 压缩修复生效。

不连真实数据库 / 不连真实 LLM，全部 mock（同 test_chat_task_flow.py 风格）。
"""
import asyncio
import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from backend.routers import chat as chat_module
from backend.routers.chat import ChatEditRequest, ChatSendRequest
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


def _make_conn(routes):
    """按 SQL 子串路由 mock cursor：routes[子串] = (fetchone 返回值, fetchall 返回值)。

    未匹配的 SQL 返回空 cursor（fetchone=None / fetchall=[]）。
    """
    conn = MagicMock(name="db_conn")

    def _side_effect(sql, *params):
        cur = MagicMock(name="cursor")
        cur.fetchone.return_value = None
        cur.fetchall.return_value = []
        for sub, (one, all_) in routes.items():
            if sub in str(sql):
                if one is not _UNSET:
                    cur.fetchone.return_value = one
                if all_ is not _UNSET:
                    cur.fetchall.return_value = all_
                break
        return cur

    conn.execute.side_effect = _side_effect
    return conn


_UNSET = object()

# 常用 SQL 子串
_SQL_OWN_SESSION = "SELECT id, title FROM chat_sessions"
_SQL_TARGET = "SELECT id, role, status FROM chat_messages"
_SQL_STREAMING_RANGE = "id > %s AND status = 'streaming'"
_SQL_STREAMING_RANGE_GE = "id >= %s AND status = 'streaming'"
_SQL_SUMMARY = "SELECT summary_until FROM chat_sessions"
_SQL_DELETE = "DELETE FROM chat_messages"
_SQL_UPDATE_CONTENT = "UPDATE chat_messages SET content = %s WHERE id = %s"
_SQL_INSERT_USER = "VALUES (%s, 'user', %s, %s::jsonb)"


def _edit_ok_conn(overrides=None):
    routes = {
        _SQL_OWN_SESSION: ({"id": 1, "title": "t"}, _UNSET),
        _SQL_TARGET: ({"id": 5, "role": "user", "status": "done"}, _UNSET),
        _SQL_STREAMING_RANGE: (_UNSET, []),
        _SQL_SUMMARY: ({"summary_until": 0}, _UNSET),
    }
    if overrides:
        routes.update(overrides)
    return _make_conn(routes)


def _patch_banned(value=False):
    mock = MagicMock()
    mock.check.return_value = value
    return patch.object(chat_module, "BannedWordsService", mock)


# ---------------------------------------------------------------------------
# 1. PATCH 校验
# ---------------------------------------------------------------------------

def test_edit_message_session_not_owned_404():
    # _owns_session fetchone=None → 404（不进入任何后续查询/删除）
    conn = _make_conn({_SQL_OWN_SESSION: (None, _UNSET)})
    with _mock_get_db(conn)[0], _patch_banned():
        with pytest.raises(HTTPException) as ei:
            _run(chat_module.edit_message(1, 5, ChatEditRequest(content="新问题"), USER))
    assert ei.value.status_code == 404
    assert "会话不存在" in ei.value.detail
    assert [c for c in conn.execute.call_args_list if _SQL_DELETE in str(c.args[0])] == []


def test_edit_message_not_found_404():
    conn = _make_conn({
        _SQL_OWN_SESSION: ({"id": 1, "title": "t"}, _UNSET),
        _SQL_TARGET: (None, _UNSET),
    })
    with _mock_get_db(conn)[0], _patch_banned():
        with pytest.raises(HTTPException) as ei:
            _run(chat_module.edit_message(1, 5, ChatEditRequest(content="新问题"), USER))
    assert ei.value.status_code == 404
    assert "消息不存在" in ei.value.detail
    assert [c for c in conn.execute.call_args_list if _SQL_DELETE in str(c.args[0])] == []


def test_edit_message_assistant_role_400():
    conn = _make_conn({
        _SQL_OWN_SESSION: ({"id": 1, "title": "t"}, _UNSET),
        _SQL_TARGET: ({"id": 5, "role": "assistant", "status": "done"}, _UNSET),
    })
    with _mock_get_db(conn)[0], _patch_banned():
        with pytest.raises(HTTPException) as ei:
            _run(chat_module.edit_message(1, 5, ChatEditRequest(content="新问题"), USER))
    assert ei.value.status_code == 400
    assert "只能编辑用户消息" in ei.value.detail
    assert [c for c in conn.execute.call_args_list if _SQL_DELETE in str(c.args[0])] == []


def test_edit_message_blank_content_400():
    conn = _edit_ok_conn()
    with _mock_get_db(conn)[0], _patch_banned():
        with pytest.raises(HTTPException) as ei:
            _run(chat_module.edit_message(1, 5, ChatEditRequest(content="   "), USER))
    assert ei.value.status_code == 400
    assert "消息内容不能为空" in ei.value.detail
    assert [c for c in conn.execute.call_args_list if _SQL_DELETE in str(c.args[0])] == []


def test_edit_message_content_too_long_422():
    with pytest.raises(ValidationError):
        ChatEditRequest(content="x" * 2001)


def test_edit_message_banned_words_400():
    conn = _edit_ok_conn()
    with _mock_get_db(conn)[0], patch.object(chat_module, "BannedWordsService") as mock_banned:
        mock_banned.check.return_value = True
        with pytest.raises(HTTPException) as ei:
            _run(chat_module.edit_message(1, 5, ChatEditRequest(content="违规内容"), USER))
    assert ei.value.status_code == 400
    assert "违规词汇" in ei.value.detail
    assert [c for c in conn.execute.call_args_list if _SQL_DELETE in str(c.args[0])] == []


def test_edit_message_target_streaming_409():
    conn = _make_conn({
        _SQL_OWN_SESSION: ({"id": 1, "title": "t"}, _UNSET),
        _SQL_TARGET: ({"id": 5, "role": "user", "status": "streaming"}, _UNSET),
    })
    with _mock_get_db(conn)[0], _patch_banned():
        with pytest.raises(HTTPException) as ei:
            _run(chat_module.edit_message(1, 5, ChatEditRequest(content="新问题"), USER))
    assert ei.value.status_code == 409
    assert "请先停止" in ei.value.detail
    assert [c for c in conn.execute.call_args_list if _SQL_DELETE in str(c.args[0])] == []


# ---------------------------------------------------------------------------
# 2/3. 截断范围 + 原位更新 + 事务性
# ---------------------------------------------------------------------------

def test_edit_message_truncates_after_and_updates_in_place():
    conn = _edit_ok_conn()
    with _mock_get_db(conn)[0], _patch_banned():
        result = _run(chat_module.edit_message(1, 5, ChatEditRequest(content="新问题"), USER))
    assert result == {"ok": True, "message_id": 5}

    # 截断范围：DELETE id > X（保留编辑消息自身，无 id >= X 的删除）
    dels = [c for c in conn.execute.call_args_list if _SQL_DELETE in str(c.args[0])]
    assert len(dels) == 1
    assert "id > %s" in str(dels[0].args[0])
    assert "id >= %s" not in str(dels[0].args[0])
    assert dels[0].args[1] == (1, 5)

    # 原位更新：仅 content 更新（file_ids/created_at 等列不被触碰 → 天然保持不变）
    ups = [c for c in conn.execute.call_args_list if _SQL_UPDATE_CONTENT in str(c.args[0])]
    assert len(ups) == 1
    assert ups[0].args[1] == ("新问题", 5)

    # 不新插入 user 消息
    inserts = [c for c in conn.execute.call_args_list if _SQL_INSERT_USER in str(c.args[0])]
    assert inserts == []


# ---------------------------------------------------------------------------
# 4. 截断范围内 streaming：停止 + 退款 / 退款失败回滚
# ---------------------------------------------------------------------------

def test_edit_message_stops_streaming_refund_then_truncates():
    """streaming 消息在截断范围内：任务同步停止（stopped 终态）+ 退款一次 + 行被删。"""
    task = CHAT_TASK_MANAGER.create(
        task_id="chat-11", user_id=1, session_id=1, message_id=11,
        req_id="req-11", cost_per=1.0, charge_mode="paid", daily_total=None, model_id="m1",
    )
    conn = _make_conn({
        _SQL_OWN_SESSION: ({"id": 1, "title": "t"}, _UNSET),
        _SQL_TARGET: ({"id": 5, "role": "user", "status": "done"}, _UNSET),
        _SQL_STREAMING_RANGE: (_UNSET, [{"id": 11}]),
        # 共享 helper 的批量 streaming 查询（m.status 前缀区分于上一条）
        "AND m.status = 'streaming'": (_UNSET, [{"id": 11, "req_id": "req-11", "charge_mode": "paid", "daily_total": None}]),
        _SQL_SUMMARY: ({"summary_until": 0}, _UNSET),
    })
    with _mock_get_db(conn)[0], _patch_banned(), \
            patch.object(chat_module, "_refund_chat_request", return_value=True) as mock_refund:
        result = _run(chat_module.edit_message(1, 5, ChatEditRequest(content="新问题"), USER))

    assert result == {"ok": True, "message_id": 5}
    # 任务被同步完成 stopped 终态并移出内存（协程 except 对已终态幂等兜底）
    assert task.status == "stopped"
    assert task.cancelled is True
    assert CHAT_TASK_MANAGER.get("chat-11") is None
    assert task.events[-1]["type"] == "stopped"  # 订阅者能收到停止事件
    # 退款恰一次（幂等 key 由 _refund_chat_request 内部 request_key 唯一索引保证）
    mock_refund.assert_called_once_with(1, 1.0, "req-11", "paid", None, "m1")
    # 消息行已删（截断执行）
    dels = [c for c in conn.execute.call_args_list if _SQL_DELETE in str(c.args[0])]
    assert len(dels) == 1


def test_edit_message_rolls_back_500_when_stop_refund_fails():
    """退款失败（保持 streaming）：整端点 500 回滚，不截断不更新（前端可重试）。"""
    conn = _make_conn({
        _SQL_OWN_SESSION: ({"id": 1, "title": "t"}, _UNSET),
        _SQL_TARGET: ({"id": 5, "role": "user", "status": "done"}, _UNSET),
        _SQL_STREAMING_RANGE: (_UNSET, [{"id": 11}]),
        "AND m.status = 'streaming'": (_UNSET, [{"id": 11, "req_id": "req-11", "charge_mode": "paid", "daily_total": None}]),
        _SQL_SUMMARY: ({"summary_until": 0}, _UNSET),
    })
    with _mock_get_db(conn)[0], _patch_banned(), \
            patch.object(chat_module, "_refund_chat_request", return_value=False):
        with pytest.raises(HTTPException) as ei:
            _run(chat_module.edit_message(1, 5, ChatEditRequest(content="新问题"), USER))
    assert ei.value.status_code == 500
    # 回滚：无 DELETE、无 content UPDATE、无 summary 重置
    assert [c for c in conn.execute.call_args_list if _SQL_DELETE in str(c.args[0])] == []
    assert [c for c in conn.execute.call_args_list if _SQL_UPDATE_CONTENT in str(c.args[0])] == []
    assert [c for c in conn.execute.call_args_list if "summary_until = 0" in str(c.args[0])] == []


def test_edit_message_unblocks_when_streaming_msg_has_no_req_id():
    """存量数据无 req_id 的 streaming 消息：无预扣流水可退（recover 同语义），
    直接标 stopped，编辑不被永久阻塞（防御路径视为退款成功）。"""
    conn = _make_conn({
        _SQL_OWN_SESSION: ({"id": 1, "title": "t"}, _UNSET),
        _SQL_TARGET: ({"id": 5, "role": "user", "status": "done"}, _UNSET),
        _SQL_STREAMING_RANGE: (_UNSET, [{"id": 11}]),
        # 防御路径：任务不在内存 + req_id 为空
        "AND m.status = 'streaming'": (_UNSET, [{"id": 11, "req_id": None, "charge_mode": "paid", "daily_total": None}]),
        _SQL_SUMMARY: ({"summary_until": 0}, _UNSET),
    })
    with _mock_get_db(conn)[0], _patch_banned(), \
            patch.object(chat_module, "_refund_chat_request") as mock_refund:
        result = _run(chat_module.edit_message(1, 5, ChatEditRequest(content="新问题"), USER))
    assert result == {"ok": True, "message_id": 5}
    mock_refund.assert_not_called()  # 无可退（无 req_id 预扣流水）
    # 消息被标 stopped（防御路径 UPDATE）
    stops = [c for c in conn.execute.call_args_list
             if "SET status = 'stopped', error = NULL WHERE id = %s AND status = 'streaming'" in str(c.args[0])]
    assert len(stops) == 1 and stops[0].args[1] == (11,)
    # 截断照常执行
    assert len([c for c in conn.execute.call_args_list if _SQL_DELETE in str(c.args[0])]) == 1


# ---------------------------------------------------------------------------
# 5. 压缩状态修复
# ---------------------------------------------------------------------------

def test_edit_message_resets_summary_in_compressed_area():
    """编辑点落在已压缩区域（X <= summary_until）→ 同一流程重置压缩状态。"""
    conn = _edit_ok_conn({_SQL_SUMMARY: ({"summary_until": 10}, _UNSET)})  # 5 <= 10
    with _mock_get_db(conn)[0], _patch_banned():
        result = _run(chat_module.edit_message(1, 5, ChatEditRequest(content="新问题"), USER))
    assert result["ok"] is True
    resets = [c for c in conn.execute.call_args_list if "summary_until = 0" in str(c.args[0])]
    assert len(resets) == 1
    assert resets[0].args[1] == (1,)


def test_edit_message_keeps_summary_outside_compressed_area():
    """编辑点在未压缩区（X > summary_until）→ 压缩状态不变。"""
    conn = _edit_ok_conn({_SQL_SUMMARY: ({"summary_until": 3}, _UNSET)})  # 5 > 3
    with _mock_get_db(conn)[0], _patch_banned():
        result = _run(chat_module.edit_message(1, 5, ChatEditRequest(content="新问题"), USER))
    assert result["ok"] is True
    assert [c for c in conn.execute.call_args_list if "summary_until = 0" in str(c.args[0])] == []


# ---------------------------------------------------------------------------
# 6. sendMessage edit_message_id：原位 UPDATE 而非 INSERT
# ---------------------------------------------------------------------------

def _send_edit_ok_conn(overrides=None):
    routes = {
        _SQL_OWN_SESSION: ({"id": 1, "title": "新对话"}, _UNSET),
        "SELECT COUNT(*) AS cnt": ({"cnt": 1}, _UNSET),  # 编辑后会话只剩 1 条（编辑消息）
        "SELECT id, original_name, page_content FROM chat_files": (_UNSET, []),
        "SELECT id, role FROM chat_messages": ({"id": 5, "role": "user"}, _UNSET),  # edit 目标
        "INSERT INTO chat_messages (session_id, role, content, thinking, status": ({"id": 100}, _UNSET),  # 占位
    }
    if overrides:
        routes.update(overrides)
    return _make_conn(routes)


def test_send_message_edit_branch_updates_in_place():
    """edit_message_id：不插入 user 消息；原位 UPDATE；返回 user_message_id=X；
    预扣正常（新 req_id）；assistant 占位消息正常插入；首条编辑自动更新标题。"""
    entitlements = {
        "active": True, "allowed_models": None,
        "features": {"web_search": False, "file_upload": True},
        "max_concurrent_requests": 2,
    }
    precharge = {"balance": 100.0, "mode": "paid", "remaining": None}
    conn = _send_edit_ok_conn()

    async def _noop(ctx):
        return None

    async def _scenario():
        with _mock_get_db(conn)[0], \
                patch.object(chat_module, "get_active_model", return_value={"model_id": "m", "enabled": True}), \
                patch.object(chat_module, "get_by_model_id", return_value=None), \
                patch.object(chat_module, "BannedWordsService") as mock_banned, \
                patch.object(chat_module, "get_entitlements_in_conn", return_value=entitlements), \
                patch.object(chat_module, "_check_rate_limit"), \
                patch.object(chat_module.PointsService, "consume_ai_chat", return_value=precharge) as mock_consume, \
                patch.object(chat_module, "run_generation", new=_noop):
            mock_banned.check.return_value = False
            res = await chat_module.send_message(1, ChatSendRequest(content="编辑后的问题", edit_message_id=5), USER)
            return res, mock_consume

    res, mock_consume = _run(_scenario())

    # 返回原位 id（前端无需 id 交换）
    assert res["user_message_id"] == 5
    assert res["assistant_message_id"] == 100

    # 不新插入 user 消息（无 INSERT ... role 'user'）
    user_inserts = [c for c in conn.execute.call_args_list if _SQL_INSERT_USER in str(c.args[0])]
    assert user_inserts == []

    # 原位 UPDATE：content（含无视觉识别文本时拼接）+ file_ids 快照重算
    edits = [c for c in conn.execute.call_args_list if "SET content = %s, file_ids = %s::jsonb" in str(c.args[0])]
    assert len(edits) == 1
    assert edits[0].args[1][0] == "编辑后的问题"
    assert json.loads(edits[0].args[1][1]) == []  # 无已解析文档 → 空快照
    assert edits[0].args[1][2] == 5

    # 预扣正常（新 req_id 的 chat:{...} key）
    mock_consume.assert_called_once()
    assert mock_consume.call_args.kwargs["request_key"].startswith("chat:")

    # 占位 assistant 消息正常插入（req_id/charge_mode/daily_total 落库供重启退款）
    placeholders = [c for c in conn.execute.call_args_list
                    if "INSERT INTO chat_messages (session_id, role, content, thinking, status" in str(c.args[0])]
    assert len(placeholders) == 1

    # 首条编辑（会话只剩该消息且标题默认）→ 自动更新标题
    title_updates = [c for c in conn.execute.call_args_list if "SET title = %s, updated_at = NOW()" in str(c.args[0])]
    assert len(title_updates) == 1
    assert title_updates[0].args[1][0] == "编辑后的问题"


def test_send_message_edit_branch_target_missing_or_non_user():
    """edit_message_id 目标不存在 → 404；role != user → 400（同 PATCH 校验，重发路径防御）。"""
    for target_row, expected_status, expected_detail in [
        (None, 404, "消息不存在"),
        ({"id": 5, "role": "assistant"}, 400, "只能编辑用户消息"),
    ]:
        entitlements = {
            "active": True, "allowed_models": None,
            "features": {"web_search": False, "file_upload": True},
            "max_concurrent_requests": 2,
        }
        precharge = {"balance": 100.0, "mode": "paid", "remaining": None}
        conn = _send_edit_ok_conn({"SELECT id, role FROM chat_messages": (target_row, _UNSET)})

        async def _noop(ctx):
            return None

        async def _scenario():
            with _mock_get_db(conn)[0], \
                    patch.object(chat_module, "get_active_model", return_value={"model_id": "m", "enabled": True}), \
                    patch.object(chat_module, "get_by_model_id", return_value=None), \
                    patch.object(chat_module, "BannedWordsService") as mock_banned, \
                    patch.object(chat_module, "get_entitlements_in_conn", return_value=entitlements), \
                    patch.object(chat_module, "_check_rate_limit"), \
                    patch.object(chat_module.PointsService, "consume_ai_chat", return_value=precharge), \
                    patch.object(chat_module, "run_generation", new=_noop):
                mock_banned.check.return_value = False
                try:
                    await chat_module.send_message(1, ChatSendRequest(content="编辑后的问题", edit_message_id=5), USER)
                except HTTPException as e:
                    return e
                return None

        exc = _run(_scenario())
        assert exc is not None and exc.status_code == expected_status
        assert expected_detail in exc.detail


# ---------------------------------------------------------------------------
# 7. delete_message 回归：共享 helper + 压缩修复
# ---------------------------------------------------------------------------

def test_delete_message_uses_helper_and_resets_summary():
    """重新回答路径回归：先同步停止+退款（helper 调用），截断 id >= X，压缩修复生效。"""
    conn = _make_conn({
        _SQL_OWN_SESSION: ({"id": 1, "title": "t"}, _UNSET),
        "SELECT id FROM chat_messages WHERE id = %s AND session_id = %s": ({"id": 3}, _UNSET),
        _SQL_STREAMING_RANGE_GE: (_UNSET, [{"id": 9}]),
        _SQL_SUMMARY: ({"summary_until": 10}, _UNSET),  # 3 <= 10 → 重置
    })
    with _mock_get_db(conn)[0], \
            patch.object(chat_module, "_stop_streaming_messages", return_value=[]) as mock_helper:
        result = _run(chat_module.delete_message(1, 3, USER))
    assert result == {"ok": True}
    # 共享 helper 收到范围内 streaming 消息（含未启动任务同步退款，修复漏退边角）
    mock_helper.assert_called_once_with([9], 1)
    # 截断范围仍是本消息及之后（行为不变）
    dels = [c for c in conn.execute.call_args_list if _SQL_DELETE in str(c.args[0])]
    assert len(dels) == 1
    assert "id >= %s" in str(dels[0].args[0])
    assert dels[0].args[1] == (1, 3)
    # 压缩修复生效
    resets = [c for c in conn.execute.call_args_list if "summary_until = 0" in str(c.args[0])]
    assert len(resets) == 1


def test_delete_message_no_summary_reset_outside_compressed_area():
    conn = _make_conn({
        _SQL_OWN_SESSION: ({"id": 1, "title": "t"}, _UNSET),
        "SELECT id FROM chat_messages WHERE id = %s AND session_id = %s": ({"id": 3}, _UNSET),
        _SQL_STREAMING_RANGE_GE: (_UNSET, []),
        _SQL_SUMMARY: ({"summary_until": 2}, _UNSET),  # 3 > 2 → 不变
    })
    with _mock_get_db(conn)[0], \
            patch.object(chat_module, "_stop_streaming_messages", return_value=[]):
        result = _run(chat_module.delete_message(1, 3, USER))
    assert result == {"ok": True}
    assert [c for c in conn.execute.call_args_list if "summary_until = 0" in str(c.args[0])] == []


def test_delete_message_not_found_404_regression():
    conn = _make_conn({
        _SQL_OWN_SESSION: ({"id": 1, "title": "t"}, _UNSET),
        "SELECT id FROM chat_messages WHERE id = %s AND session_id = %s": (None, _UNSET),
    })
    with _mock_get_db(conn)[0], \
            patch.object(chat_module, "_stop_streaming_messages", return_value=[]) as mock_helper:
        with pytest.raises(HTTPException) as ei:
            _run(chat_module.delete_message(1, 99, USER))
    assert ei.value.status_code == 404
    mock_helper.assert_not_called()
