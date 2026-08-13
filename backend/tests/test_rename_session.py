"""rename_session agent 工具单元测试（不连数据库，mock get_db 连接）。

覆盖：默认名「新对话」→ 改名成功；用户自定义名 → 不改动；
无会话 / 空 title / 会话不存在 / 无归属权限 → 返回提示。
"""
import asyncio
from unittest.mock import MagicMock, patch

from backend.services.agent.context import AgentContext
from backend.services.agent.tools import rename_session as rs


def _run(coro):
    return asyncio.run(coro)


def _ctx(session_id=10, user_id=1):
    return AgentContext(session_id=session_id, user_id=user_id)


def _mock_db(current_title):
    """mock get_db 上下文管理器：SELECT 返回当前 title；记录 UPDATE 调用。"""
    conn = MagicMock()
    row = MagicMock()
    row.__getitem__ = lambda self, k: {"title": current_title}[k]
    conn.execute.return_value.fetchone.return_value = row
    db = MagicMock()
    db.__enter__ = MagicMock(return_value=conn)
    db.__exit__ = MagicMock(return_value=False)
    return db, conn


def _updates(conn):
    return [c.args[0] for c in conn.execute.call_args_list if "UPDATE" in str(c.args[0])]


# ---------- 成功：默认名 → 改名 ----------

def test_rename_default_title():
    db, conn = _mock_db("新对话")
    with patch.object(rs, "get_db", return_value=db):
        result = _run(rs.rename_session({"title": "旅行攻略"}, _ctx()))
    assert "已将会话命名为「旅行攻略」" in result
    assert len(_updates(conn)) == 1
    # UPDATE 参数：新名字 + session_id
    args = [c.args for c in conn.execute.call_args_list if "UPDATE" in str(c.args[0])][0]
    assert args[1][0] == "旅行攻略"
    assert args[1][1] == 10


def test_rename_empty_db_title():
    """库里 title 为空串时也允许改名（兼容前端展示 fallback 场景）。"""
    db, conn = _mock_db("")
    with patch.object(rs, "get_db", return_value=db):
        result = _run(rs.rename_session({"title": "周报总结"}, _ctx()))
    assert "已将会话命名为「周报总结」" in result
    assert len(_updates(conn)) == 1


# ---------- 用户自定义名 → 不改动 ----------

def test_rename_keep_custom_title():
    db, conn = _mock_db("我的项目需求")
    with patch.object(rs, "get_db", return_value=db):
        result = _run(rs.rename_session({"title": "旅行攻略"}, _ctx()))
    assert "会话已有名称「我的项目需求」" in result
    assert "未做修改" in result
    assert len(_updates(conn)) == 0


# ---------- 边界 ----------

def test_no_session():
    result = _run(rs.rename_session({"title": "xx"}, _ctx(session_id=None)))
    assert "无需改名" in result


def test_empty_title():
    result = _run(rs.rename_session({"title": "  "}, _ctx()))
    assert "title 不能为空" in result


def test_session_not_found():
    db, conn = _mock_db("新对话")
    conn.execute.return_value.fetchone.return_value = None
    with patch.object(rs, "get_db", return_value=db):
        result = _run(rs.rename_session({"title": "xx"}, _ctx()))
    assert "会话不存在或无权访问" in result
    assert len(_updates(conn)) == 0
