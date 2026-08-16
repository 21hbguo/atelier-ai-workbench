"""会话固定（Pin）回归测试（不连真实数据库，全部 mock，沿用 test_chat_task_flow.py 直调模式）。

覆盖：
1. list_sessions：SELECT 含 pinned/pinned_at 列；ORDER BY 置顶前缀
   （pinned DESC → pinned_at DESC NULLS LAST → 活动时间 DESC → id DESC tie-break）；
   响应体每项带 pinned/pinned_at；
2. pin/unpin 端点：成功返回体、幂等 UPDATE 语句、他人/不存在会话 404；
3. create_session：空会话复用查询排除固定会话（pinned = FALSE）；
4. send_message 的 updated_at bump 不触碰 pinned/pinned_at（固定组顺序不被新消息打乱）。
"""
import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.routers import chat as chat_module

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


def _owned_conn(session_id=5, title="测试会话"):
    """_owns_session 命中（本人会话）的 conn：ownership SELECT fetchone 返回行。"""
    conn = MagicMock(name="db_conn")
    conn.execute.return_value = MagicMock(name="cursor")
    conn.execute.return_value.fetchone.return_value = {"id": session_id, "title": title}
    return conn


# ---------------------------------------------------------------------------
# 1. list_sessions：列 + 排序 + 响应体
# ---------------------------------------------------------------------------

def test_list_sessions_sql_includes_pinned_and_pin_ordering():
    conn = MagicMock(name="db_conn")
    conn.execute.return_value = MagicMock(name="cursor")
    conn.execute.return_value.fetchall.return_value = [
        {
            "id": 1, "title": "普通会话", "created_at": None, "updated_at": None,
            "pinned": False, "pinned_at": None,
            "message_count": 0, "last_message": None, "last_message_at": None,
        },
        {
            "id": 2, "title": "固定会话", "created_at": None, "updated_at": None,
            "pinned": True, "pinned_at": None,
            "message_count": 0, "last_message": None, "last_message_at": None,
        },
    ]
    with _mock_get_db(conn)[0]:
        result = _run(chat_module.list_sessions(USER))

    sql = str(conn.execute.call_args.args[0])
    # SELECT 增加 pinned / pinned_at 列
    assert "s.pinned" in sql and "s.pinned_at" in sql
    # ORDER BY 语义与前端 comparator 对齐：置顶 → 置顶时间倒序 → 活动时间 → id
    order_by = sql[sql.index("ORDER BY"):]
    assert "s.pinned DESC" in order_by
    assert "s.pinned_at DESC NULLS LAST" in order_by
    assert "s.id DESC" in order_by  # 最终 tie-break（原查询无）
    # 原活动时间键保留（未固定组行为与改造前一致）
    assert "s.updated_at, s.created_at" in order_by

    # 响应体每项带 pinned / pinned_at（纯增量字段）
    items = result["items"]
    assert items[0]["pinned"] is False and items[0]["pinned_at"] is None
    assert items[1]["pinned"] is True and items[1]["pinned_at"] is None


def test_list_sessions_pinned_at_serialized_as_iso():
    conn = MagicMock(name="db_conn")
    conn.execute.return_value = MagicMock(name="cursor")
    conn.execute.return_value.fetchall.return_value = [
        {
            "id": 1, "title": "固定会话", "created_at": None, "updated_at": None,
            "pinned": True, "pinned_at": _dt(2026, 8, 16, 10, 0, 0),
            "message_count": 0, "last_message": None, "last_message_at": None,
        },
    ]
    with _mock_get_db(conn)[0]:
        result = _run(chat_module.list_sessions(USER))
    assert result["items"][0]["pinned_at"] == "2026-08-16T10:00:00"


def _dt(y, m, d, hh, mm, ss):
    import datetime
    return datetime.datetime(y, m, d, hh, mm, ss)


# ---------------------------------------------------------------------------
# 2. pin / unpin 端点：成功、幂等、404
# ---------------------------------------------------------------------------

def test_pin_session_success():
    conn = _owned_conn()
    with _mock_get_db(conn)[0]:
        result = _run(chat_module.pin_session(5, USER))
    assert result == {"ok": True, "pinned": True}
    # 同事务内先校验归属（SELECT），再置顶 UPDATE
    updates = [c for c in conn.execute.call_args_list if "UPDATE chat_sessions" in str(c.args[0])]
    assert len(updates) == 1
    assert "pinned = TRUE" in str(updates[0].args[0])
    assert "pinned_at = NOW()" in str(updates[0].args[0])
    assert updates[0].args[1] == (5,)


def test_pin_session_idempotent_repeats_refresh_pinned_at():
    """重复置顶：仍执行同一条 UPDATE（刷新 pinned_at），不报错。"""
    conn = _owned_conn()
    with _mock_get_db(conn)[0]:
        result = _run(chat_module.pin_session(5, USER))
    assert result == {"ok": True, "pinned": True}
    updates = [c for c in conn.execute.call_args_list if "UPDATE chat_sessions" in str(c.args[0])]
    assert len(updates) == 1  # 无额外分支：幂等由 UPDATE 本身保证


def test_unpin_session_success():
    conn = _owned_conn()
    with _mock_get_db(conn)[0]:
        result = _run(chat_module.unpin_session(5, USER))
    assert result == {"ok": True, "pinned": False}
    updates = [c for c in conn.execute.call_args_list if "UPDATE chat_sessions" in str(c.args[0])]
    assert len(updates) == 1
    assert "pinned = FALSE" in str(updates[0].args[0])
    assert "pinned_at = NULL" in str(updates[0].args[0])


def test_unpin_session_idempotent_when_already_unpinned():
    conn = _owned_conn()
    with _mock_get_db(conn)[0]:
        result = _run(chat_module.unpin_session(5, USER))
    assert result == {"ok": True, "pinned": False}
    updates = [c for c in conn.execute.call_args_list if "UPDATE chat_sessions" in str(c.args[0])]
    assert len(updates) == 1  # 未置顶再取消：同一条 UPDATE，无副作用


@pytest.mark.parametrize("endpoint", ["pin", "unpin"])
def test_pin_unpin_404_when_not_owner(endpoint):
    """他人会话/不存在会话：_owns_session 兜底 404（与 rename/delete 一致）。"""
    conn = MagicMock(name="db_conn")
    conn.execute.return_value = MagicMock(name="cursor")
    conn.execute.return_value.fetchone.return_value = None  # 归属未命中
    with _mock_get_db(conn)[0]:
        with pytest.raises(HTTPException) as ei:
            if endpoint == "pin":
                _run(chat_module.pin_session(5, USER))
            else:
                _run(chat_module.unpin_session(5, USER))
    assert ei.value.status_code == 404
    assert "会话不存在" in ei.value.detail
    # 归属失败后不执行任何 UPDATE
    updates = [c for c in conn.execute.call_args_list if "UPDATE chat_sessions" in str(c.args[0])]
    assert len(updates) == 0


# ---------------------------------------------------------------------------
# 3. create_session：空会话复用排除固定会话
# ---------------------------------------------------------------------------

def test_create_session_reuse_query_excludes_pinned():
    conn = MagicMock(name="db_conn")
    conn.execute.return_value = MagicMock(name="cursor")
    # fetchone 顺序：复用查询（无可复用空会话 → None）→ INSERT RETURNING（返回新会话行）
    conn.execute.return_value.fetchone.side_effect = [
        None,
        {"id": 100, "title": "新对话", "created_at": None, "updated_at": None},
    ]
    with _mock_get_db(conn)[0]:
        result = _run(chat_module.create_session(USER))

    calls = conn.execute.call_args_list
    # calls[0] = advisory 锁；calls[1] = 空会话复用查询
    reuse_sql = str(calls[1].args[0])
    assert "s.pinned = FALSE" in reuse_sql
    assert "NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id)" in reuse_sql
    assert "ORDER BY s.id LIMIT 1" in reuse_sql
    # 固定空会话被排除后无空会话 → INSERT 新建
    inserts = [c for c in calls if "INSERT INTO chat_sessions" in str(c.args[0])]
    assert len(inserts) == 1
    assert result["id"] == 100


def test_create_session_reuses_unpinned_empty_session():
    """非固定空会话仍被复用：不触发 INSERT。"""
    conn = MagicMock(name="db_conn")
    conn.execute.return_value = MagicMock(name="cursor")
    conn.execute.return_value.fetchone.side_effect = [
        {"id": 7, "title": "新对话", "created_at": None, "updated_at": None},  # 复用命中
    ]
    with _mock_get_db(conn)[0]:
        result = _run(chat_module.create_session(USER))
    assert result["id"] == 7
    inserts = [c for c in conn.execute.call_args_list if "INSERT INTO chat_sessions" in str(c.args[0])]
    assert len(inserts) == 0


# ---------------------------------------------------------------------------
# 4. 发送新消息不 bump 固定状态（pinned_at 不被触碰）
# ---------------------------------------------------------------------------

def test_send_message_bump_does_not_touch_pinned():
    """send_message 的 updated_at bump 语句不含 pinned/pinned_at：
    固定会话收到新消息后仍固定、固定组内顺序不变（pinned_at 未被刷新）。"""
    # 静态契约检查：仅取 send_message 函数体（915 → run_generation 1439 之间）
    import inspect
    src = inspect.getsource(chat_module)
    start = src.index("async def send_message")
    end = src.index("async def run_generation", start)
    send_src = src[start:end]
    bumps = [line for line in send_src.splitlines() if "UPDATE chat_sessions" in line]
    assert len(bumps) >= 1  # 首轮起名 / 普通 bump 至少一处
    for line in bumps:
        assert "pinned" not in line, f"bump 语句不得触碰 pinned: {line.strip()}"
