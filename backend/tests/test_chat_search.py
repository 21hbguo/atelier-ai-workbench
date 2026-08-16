"""全局会话搜索 /api/chat/search 单元测试（mock get_db 连接，不连真实数据库）。

覆盖（对应设计文档 §5 验收）：
- kind=message / kind=session 两类结果的字段契约（message_id/role 仅消息命中非空）；
- 标题与消息同时命中分别出两条、total 为二者之和；
- 无命中 → { total: 0, items: [] }；分页 LIMIT/OFFSET 参数正确；
- 用户隔离：两条 SQL 分支都带当前用户 user_id（来自 get_current_user 覆盖）；
- 关键词 % _ \\ 字面匹配（_escape_like 转义 + SQL 显式 ESCAPE）；
- snippet 截断（命中点前后窗口 + …，不返回完整长文）；
- q 空/超长、size 越界 → 422；未登录 → 401；
- SQL 参数化：like_pattern 只经参数传入，不拼接进 SQL 文本。
"""
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.auth import get_current_user
from backend.routers import chat as chat_module


def _row(**kwargs):
    return MagicMock(fetchone=MagicMock(return_value=kwargs))


def _rows(*items):
    return MagicMock(fetchall=MagicMock(return_value=list(items)))


@contextmanager
def _mock_get_db(conn):
    with patch.object(chat_module, "get_db") as mock_get_db:
        mock_get_db.return_value.__enter__.return_value = conn
        mock_get_db.return_value.__exit__.return_value = False
        yield conn


def _client(user_id=1):
    app = FastAPI()
    app.include_router(chat_module.router)
    if user_id is not None:
        app.dependency_overrides[get_current_user] = lambda: {"user_id": user_id}
    return TestClient(app)


def _msg_row(message_id=11, session_id=1, title="画猫练习", role="user",
             content="帮我画一只猫，坐在窗边看夕阳", ts=datetime(2026, 8, 14, 12, 0, 0)):
    return {"kind": "message", "message_id": message_id, "session_id": session_id,
            "session_title": title, "role": role, "raw_content": content, "ts": ts}


def _session_row(session_id=5, title="画一只猫的提示词", ts=datetime(2026, 8, 13, 9, 30, 0)):
    return {"kind": "session", "message_id": None, "session_id": session_id,
            "session_title": title, "role": None, "raw_content": title, "ts": ts}


def _calls(conn, sql_frag):
    return [c for c in conn.execute.call_args_list if sql_frag in str(c.args[0])]


# ---------------------------------------------------------------------------
# _escape_like / _make_snippet 纯函数
# ---------------------------------------------------------------------------

def test_escape_like_literal_wildcards():
    esc = chat_module._escape_like
    assert esc("50% 折扣") == "50\\% 折扣"
    assert esc("a_b") == "a\\_b"
    assert esc("c\\d") == "c\\\\d"
    assert esc("普通词") == "普通词"
    assert esc("%_\\") == "\\%\\_\\\\"


def test_make_snippet_windows_and_ellipsis():
    snip = chat_module._make_snippet
    # 命中点在中间：前后各 50 字符 + …；长度 ≤ 50+len(q)+50+2
    long = "前" * 100 + "目标词" + "后" * 100
    s = snip(long, "目标词")
    assert s.startswith("…") and s.endswith("…")
    assert len(s) <= 50 + 3 + 50 + 2
    assert "目标词" in s
    # 命中点在头部：无前导 …，且保留尾部截断标记
    s = snip("目标词" + "后" * 100, "目标词")
    assert not s.startswith("…") and s.endswith("…")
    # 找不到命中点（兜底取头部）
    assert snip("abc", "zzz") == "abc"
    # 大小写不敏感（与 ILIKE 一致）
    assert "CAT" in snip("a CAT b", "cat")
    # 短内容不加省略号
    assert snip("一只猫", "猫") == "一只猫"


# ---------------------------------------------------------------------------
# 端点行为
# ---------------------------------------------------------------------------

def test_search_message_hit():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(total=2),                                  # COUNT：消息命中 2
        _rows(_msg_row(message_id=11), _msg_row(message_id=12, role="assistant")),  # 数据
    ]
    with _mock_get_db(conn):
        r = _client().get("/api/chat/search", params={"q": "猫"})
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2
    it = data["items"][0]
    assert it["kind"] == "message"
    assert it["message_id"] == 11
    assert it["role"] == "user"
    assert it["session_id"] == 1
    assert it["session_title"] == "画猫练习"
    assert it["ts"] == "2026-08-14T12:00:00"
    # snippet 由 raw_content 截断生成，包含命中词
    assert "猫" in it["snippet"]


def test_search_session_only_hit():
    """仅标题命中 → kind=session，message_id/role 为 null。"""
    conn = MagicMock()
    conn.execute.side_effect = [_row(total=1), _rows(_session_row())]
    with _mock_get_db(conn):
        r = _client().get("/api/chat/search", params={"q": "提示词"})
    data = r.json()
    assert data["total"] == 1
    it = data["items"][0]
    assert it["kind"] == "session"
    assert it["message_id"] is None
    assert it["role"] is None
    assert it["session_id"] == 5
    assert it["snippet"] == "画一只猫的提示词"


def test_search_mixed_hits_and_total_sum():
    """标题与消息同时命中分别出两条记录，total 为二者之和。"""
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(total=3),                                  # 消息 2 + 标题 1
        _rows(_msg_row(message_id=11), _msg_row(message_id=12, role="assistant"), _session_row()),
    ]
    with _mock_get_db(conn):
        r = _client().get("/api/chat/search", params={"q": "猫"})
    data = r.json()
    assert data["total"] == 3
    assert len(data["items"]) == 3
    kinds = sorted(it["kind"] for it in data["items"])
    assert kinds == ["message", "message", "session"]


def test_search_no_hit():
    conn = MagicMock()
    conn.execute.side_effect = [_row(total=0), _rows()]
    with _mock_get_db(conn):
        r = _client().get("/api/chat/search", params={"q": "不存在词xyz"})
    assert r.json() == {"total": 0, "items": []}


def test_search_user_isolation_sql_params():
    """两条 SQL 分支均用当前登录用户 id 过滤（get_current_user 覆盖为 user_id=2）。"""
    conn = MagicMock()
    conn.execute.side_effect = [_row(total=0), _rows()]
    with _mock_get_db(conn):
        _client(user_id=2).get("/api/chat/search", params={"q": "猫"})
    # 每个 SQL 调用：COUNT 与数据查询都传 (user_id, like_pattern, user_id, like_pattern) 前 4 参
    for frag in ("FROM chat_messages m", "FROM chat_sessions s"):
        calls = _calls(conn, frag)
        assert calls, f"缺少含 {frag!r} 的 SQL"
        args = calls[0].args[1]
        assert args[0] == 2 and args[2] == 2, f"user_id 未隔离: {args}"
        assert args[1] == "%猫%" and args[3] == "%猫%"


def test_search_parameterized_sql_no_injection():
    """like_pattern 只经参数传入（占位符 %s），不拼接进 SQL 文本。"""
    conn = MagicMock()
    conn.execute.side_effect = [_row(total=0), _rows()]
    with _mock_get_db(conn):
        _client().get("/api/chat/search", params={"q": "猫"})
    for call in conn.execute.call_args_list:
        sql, args = call.args[0], call.args[1]
        assert "猫" not in sql, "关键词被拼进 SQL 文本！"
        assert "%猫%" in args, "like_pattern 未作为参数传递"
    # 所有 execute 都走 %s 占位符
    for call in conn.execute.call_args_list:
        assert "%s" in call.args[0]


def test_search_escape_like_param():
    """关键词含 % _ \\ 时，like_pattern 参数是转义后的字面匹配模式。"""
    conn = MagicMock()
    conn.execute.side_effect = [_row(total=0), _rows()]
    with _mock_get_db(conn):
        _client().get("/api/chat/search", params={"q": "50% 折扣"})
    args = _calls(conn, "FROM chat_messages m")[0].args[1]
    assert args[1] == "%50\\% 折扣%"


def test_search_pagination_params():
    """page=2&size=20 → LIMIT 20 OFFSET 20；数据 SQL 带分页参数。"""
    conn = MagicMock()
    conn.execute.side_effect = [_row(total=25), _rows()]
    with _mock_get_db(conn):
        r = _client().get("/api/chat/search", params={"q": "的", "page": 2, "size": 20})
    assert r.status_code == 200
    data_call = _calls(conn, "ORDER BY u.ts DESC")[0]
    sql = data_call.args[0]
    assert "LIMIT %s OFFSET %s" in sql
    args = data_call.args[1]
    assert args[-2] == 20 and args[-1] == 20


def test_search_snippet_truncated_not_full_content():
    """长内容只返回截断片段（长度 ≤ 50+len(q)+50+2），不返回完整 content。"""
    long_content = "字" * 200 + "目标词" + "字" * 200
    conn = MagicMock()
    conn.execute.side_effect = [_row(total=1), _rows(_msg_row(message_id=99, content=long_content))]
    with _mock_get_db(conn):
        r = _client().get("/api/chat/search", params={"q": "目标词"})
    snip = r.json()["items"][0]["snippet"]
    assert len(snip) <= 50 + 3 + 50 + 2
    assert snip.startswith("…") and snip.endswith("…")
    assert "目标词" in snip


def test_search_validation_422():
    conn = MagicMock()
    with _mock_get_db(conn):
        c = _client()
        assert c.get("/api/chat/search", params={"q": ""}).status_code == 422
        assert c.get("/api/chat/search", params={"q": "x" * 101}).status_code == 422
        assert c.get("/api/chat/search", params={"q": "x", "size": 0}).status_code == 422
        assert c.get("/api/chat/search", params={"q": "x", "size": 51}).status_code == 422
        assert c.get("/api/chat/search", params={"q": "x", "page": 0}).status_code == 422


def test_search_unauthorized_401():
    conn = MagicMock()
    with _mock_get_db(conn):
        # 不覆盖 get_current_user → 走真实鉴权，无凭据 → 401
        r = _client(user_id=None).get("/api/chat/search", params={"q": "猫"})
    assert r.status_code == 401


def test_search_route_registered_after_list_sessions():
    """路由顺序：/search 与 /sessions/{id} 不冲突，端点可达（上面各用例已隐式验证）。"""
    routes = [r.path for r in chat_module.router.routes]
    assert "/api/chat/search" in routes
