"""generation_service 单元测试（不连真实数据库/上游 API，全部 mock）。

覆盖：
- create_generation_task：扣费成功 / 积分不足(402) / 违禁词(400+退款) /
  幂等(client_request_id 命中不重复扣费) / 并发超限(429) / 套餐模型不允许(403)；
- wait_generation_task：completed / failed / 超时 / 任务不存在。
"""
import asyncio
from contextlib import ExitStack, contextmanager
from unittest.mock import MagicMock, patch

from backend.services.generation_service import (
    GenerationError,
    create_generation_task,
    wait_generation_task,
)
from backend.services import generation_service as gs


@contextmanager
def _mock_db_conn(conn=None):
    """Patch gs.get_db 为 contextmanager，__enter__ 返回 conn mock。"""
    conn = conn or MagicMock(name="db_conn")
    with patch.object(gs, "get_db") as mock_get_db:
        mock_get_db.return_value.__enter__.return_value = conn
        mock_get_db.return_value.__exit__.return_value = False
        yield conn


def _make_conn(*, user_count=0, global_count=0):
    """按 SQL 内容分发的 conn mock：默认幂等未命中、用户存在、并发计数可配。"""
    conn = MagicMock(name="db_conn")

    def _execute(sql, params=None):
        r = MagicMock(name="result")
        s = str(sql)
        if "SELECT task_id,status FROM tasks" in s:
            r.fetchone.return_value = None  # 幂等：无历史任务
        elif "SELECT id FROM users" in s:
            r.fetchone.return_value = {"id": 1}
        elif "COUNT(*) AS cnt" in s:
            if "user_id = %s" in s:
                r.fetchone.return_value = {"cnt": user_count}
            else:
                r.fetchone.return_value = {"cnt": global_count}
        else:
            r.fetchone.return_value = None
        return r

    conn.execute.side_effect = _execute
    return conn


@contextmanager
def _base_patches(**kw):
    """成功路径所需的全部 mock 补丁（ExitStack 一次性进入）。"""
    patches = [
        patch.object(gs, "get_limit_config", return_value={"generate_concurrent_limit_per_user": 10}),
        patch.object(gs, "get_entitlements_in_conn", return_value={
            "active": True,
            "allowed_models": kw.get("allowed_models") or [],
            "max_concurrent_requests": 10,
        }),
        patch.object(gs.PointsService, "consume", return_value=100),
        patch.object(gs.PointsService, "refund", return_value=100),
        patch.object(gs, "record_request"),
        patch.object(gs.StatsService, "record_request"),
        patch.object(gs.StatsService, "record_failed"),
        patch.object(gs.BannedWordsService, "check", return_value=None),
        patch.object(gs.TaskManager, "create_task", return_value={"task_id": "t1"}),
        patch.object(gs.TaskManager, "update_task", return_value={"task_id": "t1"}),
        patch.object(gs.asyncio, "create_task", return_value=MagicMock(name="bg_task")),
    ]
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        yield


def _run(coro):
    return asyncio.run(coro)


# ---------- create_generation_task ----------

def test_create_generation_task_success():
    conn = _make_conn()
    with _mock_db_conn(conn), _base_patches():
        result = create_generation_task(
            1, "text",
            {"prompt": "一只猫", "size": "auto", "model_id": "gpt-image-2",
             "share_to_square": False, "client_request_id": None},
        )
        # patch 仅在 with 块内生效，断言必须放在块内
        assert result["status"] == "processing"
        assert result["task_id"]
        assert result["message"] == "任务已提交"
        # 扣费 + 建行 + 后台执行各一次
        gs.PointsService.consume.assert_called_once()
        assert "consume:" in gs.PointsService.consume.call_args.kwargs["request_key"]
        gs.TaskManager.create_task.assert_called_once()
        gs.asyncio.create_task.assert_called_once()


def test_create_generation_task_insufficient_points():
    conn = _make_conn()
    with _mock_db_conn(conn), _base_patches(), patch.object(gs.PointsService, "consume", side_effect=ValueError("积分不足")):
        try:
            _run(create_generation_task(
                1, "text",
                {"prompt": "p", "model_id": "gpt-image-2", "client_request_id": None},
            ))
        except GenerationError as e:
            assert e.status_code == 402
            assert "积分不足" in str(e)
        else:
            raise AssertionError("expected GenerationError(402)")


def test_create_generation_task_banned_word_refunds():
    conn = _make_conn()
    with _mock_db_conn(conn), _base_patches(), patch.object(gs.BannedWordsService, "check", return_value="违禁词"):
        try:
            _run(create_generation_task(
                1, "text",
                {"prompt": "含违禁词内容", "model_id": "gpt-image-2", "client_request_id": None},
            ))
        except GenerationError as e:
            assert e.status_code == 400
            assert "违禁词" in str(e)
        else:
            raise AssertionError("expected GenerationError(400)")
        # 违禁词：任务标记失败 + 退款 + 统计失败（patch 生效期内断言）
        gs.TaskManager.update_task.assert_called()
        assert gs.TaskManager.update_task.call_args.kwargs["status"] == "failed"
        gs.PointsService.refund.assert_called_once()
        assert gs.PointsService.refund.call_args.kwargs["request_key"].startswith("refund:")
        gs.StatsService.record_failed.assert_called_once()
        # 不启动后台生成
        gs.asyncio.create_task.assert_not_called()


def test_create_generation_task_idempotent_no_double_charge():
    conn = MagicMock(name="db_conn")
    r = MagicMock(name="result")
    r.fetchone.return_value = {"task_id": "old-task", "status": "processing"}
    conn.execute.return_value = r
    with _mock_db_conn(conn), _base_patches():
        result = create_generation_task(
            1, "text",
            {"prompt": "p", "model_id": "gpt-image-2", "client_request_id": "req-123"},
        )
        assert result == {"task_id": "old-task", "status": "processing", "message": "请求已存在，返回历史任务"}
        gs.PointsService.consume.assert_not_called()
        gs.TaskManager.create_task.assert_not_called()
        gs.asyncio.create_task.assert_not_called()


def test_create_generation_task_concurrency_limit():
    conn = _make_conn(user_count=99)  # 该用户已满并发
    with _mock_db_conn(conn), _base_patches():
        try:
            _run(create_generation_task(
                1, "text",
                {"prompt": "p", "model_id": "gpt-image-2", "client_request_id": None},
            ))
        except GenerationError as e:
            assert e.status_code == 429
            assert "过于频繁" in str(e)
        else:
            raise AssertionError("expected GenerationError(429)")
        gs.PointsService.consume.assert_not_called()


def test_create_generation_task_global_concurrency_limit():
    conn = _make_conn(global_count=99)  # 全站已满
    with _mock_db_conn(conn), _base_patches():
        try:
            _run(create_generation_task(
                1, "text",
                {"prompt": "p", "model_id": "gpt-image-2", "client_request_id": None},
            ))
        except GenerationError as e:
            assert e.status_code == 429
            assert "全站生成任务已满" in str(e)
        else:
            raise AssertionError("expected GenerationError(429)")


def test_create_generation_task_model_not_allowed():
    conn = _make_conn()
    with _mock_db_conn(conn), _base_patches(allowed_models=["gpt-image-2"]):
        try:
            _run(create_generation_task(
                1, "text",
                {"prompt": "p", "model_id": "other-model", "client_request_id": None},
            ))
        except GenerationError as e:
            assert e.status_code == 403
            assert "套餐不支持该模型" in str(e)
        else:
            raise AssertionError("expected GenerationError(403)")


def test_create_generation_task_subscription_suspended():
    conn = _make_conn()
    with _mock_db_conn(conn), _base_patches(), patch.object(gs, "get_entitlements_in_conn", return_value={
        "active": False,
        "allowed_models": [],
        "max_concurrent_requests": 1,
    }):
        try:
            _run(create_generation_task(
                1, "text",
                {"prompt": "p", "model_id": "gpt-image-2", "client_request_id": None},
            ))
        except GenerationError as e:
            assert e.status_code == 403
            assert "订阅已暂停" in str(e)
        else:
            raise AssertionError("expected GenerationError(403)")


# ---------- wait_generation_task ----------

def test_wait_generation_task_completed():
    with patch.object(gs.TaskManager, "get_task", return_value={
        "status": "completed", "result_urls": ["/data/images/t1_0.png"],
    }):
        result = _run(wait_generation_task("t1", timeout=100, interval=3))
    assert result["status"] == "completed"
    assert result["result_urls"] == ["/data/images/t1_0.png"]
    assert result["timed_out"] is False


def test_wait_generation_task_failed():
    with patch.object(gs.TaskManager, "get_task", return_value={
        "status": "failed", "error": "上游生成失败",
    }):
        result = _run(wait_generation_task("t1", timeout=100, interval=3))
    assert result["status"] == "failed"
    assert result["error"] == "上游生成失败"


def test_wait_generation_task_timeout():
    # 任务一直处于 processing：小超时快速返回 timed_out
    with patch.object(gs.TaskManager, "get_task", return_value={"status": "processing"}):
        result = _run(wait_generation_task("t1", timeout=0.1, interval=0.05))
    assert result["timed_out"] is True
    assert result["status"] == "processing"
    assert result["result_urls"] == []


def test_wait_generation_task_transitions_to_completed():
    # 轮询过程中任务先 processing 后 completed
    state = {"status": "processing"}
    def _get(task_id):
        return dict(state)
    with patch.object(gs.TaskManager, "get_task", side_effect=_get):
        async def _drive():
            task = asyncio.ensure_future(wait_generation_task("t1", timeout=5, interval=0.05))
            await asyncio.sleep(0.12)
            state["status"] = "completed"
            state["result_urls"] = ["/data/images/t1_0.png"]
            return await task
        result = asyncio.run(_drive())
    assert result["status"] == "completed"
    assert result["timed_out"] is False


def test_wait_generation_task_not_found():
    with patch.object(gs.TaskManager, "get_task", return_value=None):
        result = _run(wait_generation_task("nope", timeout=100, interval=3))
    assert result["status"] == "not_found"
