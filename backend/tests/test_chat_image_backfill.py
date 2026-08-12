"""generation_service 聊天补图落库（_append_chat_image_result）单元测试。

覆盖：任务完成时消息已落库（UPDATE 命中、content 追加、mark_image_permanent 被调）/ 消息未落库（UPDATE 0 行、无害）失败路径追加失败文案 / 幂等（消息已含结果不重复追加）/
无 _chat_message_id 直接跳过。不连真实数据库，全部 mock（模式同 test_generation_service.py）。
"""
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from backend.services import generation_service as gs


@contextmanager
def _mock_db_conn(conn=None):
    """Patch gs.get_db 为 contextmanager，__enter__ 返回 conn mock。"""
    conn = conn or MagicMock(name="db_conn")
    with patch.object(gs, "get_db") as mock_get_db:
        mock_get_db.return_value.__enter__.return_value = conn
        mock_get_db.return_value.__exit__.return_value = False
        yield conn


def _conn_with_rowcount(rowcount):
    """UPDATE 返回指定 rowcount 的 conn mock。"""
    conn = MagicMock(name="db_conn")
    cur = MagicMock(name="cursor")
    cur.rowcount = rowcount
    conn.execute.return_value = cur
    return conn


def _last_update(conn):
    """最后一次 execute 调用的 (sql, params)。"""
    args, kwargs = conn.execute.call_args
    sql = args[0] if args else kwargs.get("query")
    params = args[1] if len(args) > 1 else kwargs.get("params")
    return sql, params


# ---------- 完成路径：消息已落库 ----------

def test_backfill_completed_message_exists_appends_markdown():
    conn = _conn_with_rowcount(1)
    with _mock_db_conn(conn), patch.object(gs, "mark_image_permanent") as mock_mark:
        gs._append_chat_image_result(42, "t-1", result_urls=["/data/images/t-1_0.png"])
        # 图片永久保留标记被调（与消息是否落库无关）
        mock_mark.assert_called_once_with("t-1_0.png")
        # UPDATE 幂等追加 markdown
        sql, params = _last_update(conn)
        assert "UPDATE chat_messages SET content = content || %s" in str(sql)
        assert "content NOT LIKE %s" in str(sql)
        assert params[0] == "\n\n![图片](/api/images/file/t-1_0.png)"
        assert params[1] == 42
        assert params[2] == "%/api/images/file/t-1_0.png%"


def test_backfill_completed_multiple_images_all_appended_and_marked():
    conn = _conn_with_rowcount(1)
    with _mock_db_conn(conn), patch.object(gs, "mark_image_permanent") as mock_mark:
        gs._append_chat_image_result(7, "t-m", result_urls=["/x/t-m_0.png", "/x/t-m_1.png"])
        assert mock_mark.call_count == 2
        sql, params = _last_update(conn)
        assert params[0] == "\n\n![图片](/api/images/file/t-m_0.png)\n\n![图片](/api/images/file/t-m_1.png)"


# ---------- 完成路径：消息未落库（UPDATE 0 行） ----------

def test_backfill_completed_message_not_persisted_is_harmless():
    conn = _conn_with_rowcount(0)
    with _mock_db_conn(conn), patch.object(gs, "mark_image_permanent") as mock_mark:
        # 不抛异常、无害跳过（消息落库时已含工具返回的图片）
        gs._append_chat_image_result(42, "t-1", result_urls=["/data/images/t-1_0.png"])
        mock_mark.assert_called_once_with("t-1_0.png")
        sql, params = _last_update(conn)
        assert params[2] == "%/api/images/file/t-1_0.png%"


# ---------- 失败路径 ----------

def test_backfill_failed_appends_error_text():
    conn = _conn_with_rowcount(1)
    with _mock_db_conn(conn), patch.object(gs, "mark_image_permanent") as mock_mark:
        gs._append_chat_image_result(42, "t-9", error="上游生成失败")
        mock_mark.assert_not_called()
        sql, params = _last_update(conn)
        assert params[0] == "\n\n图片生成失败：上游生成失败"
        assert params[1] == 42
        assert params[2] == "%图片生成失败%"


# ---------- 幂等：内容已含任务 ID（NOT LIKE 不命中） ----------

def test_backfill_idempotent_no_duplicate_append():
    # 第一次 UPDATE 命中（消息落库、仅指引文案），第二次模拟内容已含图片 URL → 0 行
    states = iter([1, 0])
    conn = MagicMock(name="db_conn")

    def _execute(sql, params=None):
        cur = MagicMock(name="cursor")
        cur.rowcount = next(states)
        return cur

    conn.execute.side_effect = _execute
    with _mock_db_conn(conn), patch.object(gs, "mark_image_permanent"):
        gs._append_chat_image_result(42, "t-idem", result_urls=["/data/images/t-idem_0.png"])
        gs._append_chat_image_result(42, "t-idem", result_urls=["/data/images/t-idem_0.png"])
    # 两次 UPDATE 均带 NOT LIKE 守卫（第二次 0 行 → 不重复追加）
    assert conn.execute.call_count == 2
    for call in conn.execute.call_args_list:
        sql = call.args[0]
        assert "content NOT LIKE %s" in str(sql)
        # 守卫是图片 URL 而非 task_id：超时指引文案含 task_id，不能用作去重依据
        assert call.args[1][2] == "%/api/images/file/t-idem_0.png%"


# ---------- 无 _chat_message_id / 空参数 ----------

def test_backfill_without_message_id_skipped():
    conn = MagicMock(name="db_conn")
    with _mock_db_conn(conn), patch.object(gs, "mark_image_permanent") as mock_mark:
        gs._append_chat_image_result(None, "t-1", result_urls=["/data/images/t-1_0.png"])
        conn.execute.assert_not_called()
        mock_mark.assert_not_called()


def test_backfill_empty_urls_skipped():
    conn = MagicMock(name="db_conn")
    with _mock_db_conn(conn), patch.object(gs, "mark_image_permanent") as mock_mark:
        gs._append_chat_image_result(42, "t-1", result_urls=[])
        conn.execute.assert_not_called()
        mock_mark.assert_not_called()
