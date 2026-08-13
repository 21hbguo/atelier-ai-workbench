"""AI 助手每日免费次数（consume_ai_chat / refund_ai_chat / get_ai_daily_quota）的 mock 单元测试。

覆盖 backend/services/points_service.py 新增的三个方法：
- consume_ai_chat：免费用户优先扣每日次数（懒重置）、次数用尽/订阅用户扣通用积分、同 request_key 幂等
- refund_ai_chat：free 模式次数 +1（幂等、封顶），paid 模式委托 refund
- get_ai_daily_quota：免费用户展示值（懒重置展示），非免费用户 0/0

不连真实数据库，get_db 与 PointsService._consume_in_conn 均打桩。
"""
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch

import backend.services.points_service as ps_module
from backend.services.points_service import PointsService

_TODAY = datetime.now().date()


@contextmanager
def _mock_db_conn():
    """Patch points_service 模块的 get_db；yield conn mock。"""
    conn = MagicMock(name="db_conn")
    with patch.object(ps_module, "get_db") as mock_get_db:
        mock_get_db.return_value.__enter__.return_value = conn
        mock_get_db.return_value.__exit__.return_value = False
        yield conn


def _row(**kwargs):
    """构造带 fetchone 的 execute 返回对象。"""
    return MagicMock(fetchone=MagicMock(return_value=kwargs))


# ---------------------------------------------------------------------------
# consume_ai_chat：免费用户，有剩余次数 → mode=free，扣次数 + 插标记流水
# ---------------------------------------------------------------------------
def test_consume_ai_chat_free_user_uses_daily_quota():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # SELECT id ... FOR UPDATE
            _row(),                            # 幂等检查 → 无记录（fetchone None）
            _row(),                            # UPDATE 懒重置（不读）
            _row(ai_daily_quota_remaining=5),  # 读剩余次数（重置后）
            _row(),                            # UPDATE 次数 -1
            _row(points=Decimal("100"), ai_daily_quota_remaining=4),  # 读 points + 新剩余
            _row(),                            # INSERT 标记流水（不读）
        ]
        result = PointsService.consume_ai_chat(1, 1, "AI助手对话 x1", "chat:req-1", is_free_user=True, model_id="m1")

    assert result["mode"] == "free"
    assert result["balance"] == Decimal("100")
    assert result["remaining"] == 4
    # 标记流水 amount=0（硬编码在 SQL），balance_after=当前余额，type='ai_daily_free'
    insert_sql = conn.execute.call_args_list[-1][0][0]
    insert_args = conn.execute.call_args_list[-1][0][1]
    assert "point_transactions" in insert_sql and "'ai_daily_free'" in insert_sql
    assert insert_args[0] == 1 and insert_args[1] == Decimal("100")
    assert insert_args[3] == "chat:req-1"


# ---------------------------------------------------------------------------
# consume_ai_chat：免费用户，次数用尽 → 降级扣通用积分
# ---------------------------------------------------------------------------
def test_consume_ai_chat_free_user_quota_exhausted_degrades_to_points():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         patch.object(PointsService, "_consume_in_conn", return_value=Decimal("99")) as mock_ci, \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # FOR UPDATE
            _row(),                            # 幂等检查 → 无记录
            _row(),                            # UPDATE 懒重置（今天已重置过 → 不影响）
            _row(ai_daily_quota_remaining=0),  # 剩余 0
        ]
        result = PointsService.consume_ai_chat(1, 1, "AI助手对话 x1", "chat:req-2", is_free_user=True)

    assert result["mode"] == "paid"
    assert result["balance"] == Decimal("99")
    assert result["remaining"] == 0
    mock_ci.assert_called_once()
    args, kwargs = mock_ci.call_args
    assert args[0] == conn and args[1] == 1 and args[2] == Decimal("1")
    assert kwargs["tx_type"] == "chat_consume"
    assert kwargs["request_key"] == "chat:req-2"


# ---------------------------------------------------------------------------
# consume_ai_chat：订阅用户 → 不耗免费次数，直接扣通用积分
# ---------------------------------------------------------------------------
def test_consume_ai_chat_subscriber_skips_free_quota():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         patch.object(PointsService, "_consume_in_conn", return_value=Decimal("88")) as mock_ci, \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # FOR UPDATE
            _row(),                            # 幂等检查 → 无记录
        ]
        result = PointsService.consume_ai_chat(1, 1, "AI助手对话 x1", "chat:req-3", is_free_user=False)

    assert result["mode"] == "paid"
    assert result["remaining"] == 0
    # 不执行任何 ai_daily 相关 UPDATE（只有锁行 + 幂等查询两次 execute）
    assert conn.execute.call_count == 2
    mock_ci.assert_called_once()


# ---------------------------------------------------------------------------
# consume_ai_chat：同 request_key 重放 → 幂等，不重复扣
# ---------------------------------------------------------------------------
def test_consume_ai_chat_idempotent_replay():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # FOR UPDATE
            _row(type="ai_daily_free"),        # 幂等检查 → 已有免费标记
            _row(points=Decimal("100"), ai_daily_quota_remaining=4),
        ]
        result = PointsService.consume_ai_chat(1, 1, "AI助手对话 x1", "chat:req-4", is_free_user=True)

    assert result["mode"] == "free"
    assert result["remaining"] == 4
    assert conn.execute.call_count == 3  # 无任何 UPDATE


# ---------------------------------------------------------------------------
# refund_ai_chat：free 模式 → 次数 +1（幂等、封顶 total）
# ---------------------------------------------------------------------------
def test_refund_ai_chat_free_mode_adds_quota():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # FOR UPDATE
            _row(),                            # 退款标记检查 → 无
            _row(),                            # UPDATE 次数 +1（LEAST 封顶）
            _row(points=Decimal("100")),       # _balance_in_conn
            _row(),                            # INSERT 退款标记
        ]
        balance = PointsService.refund_ai_chat(1, 1, "AI助手回复失败退还", request_key="chat_refund:req-5", mode="free")

    assert balance == Decimal("100")
    update_sql = conn.execute.call_args_list[2][0][0]
    assert "LEAST(COALESCE(ai_daily_quota_remaining, 0) + 1" in update_sql
    assert "%s" in update_sql  # 封顶参数
    insert_sql = conn.execute.call_args_list[-1][0][0]
    assert "'ai_daily_free_refund'" in insert_sql


# ---------------------------------------------------------------------------
# refund_ai_chat：free 模式重放 → 幂等，不重复 +1
# ---------------------------------------------------------------------------
def test_refund_ai_chat_free_mode_idempotent():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # FOR UPDATE
            _row(id=99),                       # 退款标记已存在
            _row(points=Decimal("100")),       # _balance_in_conn
        ]
        balance = PointsService.refund_ai_chat(1, 1, "AI助手回复失败退还", request_key="chat_refund:req-6", mode="free")

    assert balance == Decimal("100")
    assert conn.execute.call_count == 3  # 无 UPDATE 次数
    assert not any("ai_daily_quota_remaining" in call[0][0] for call in conn.execute.call_args_list)


# ---------------------------------------------------------------------------
# refund_ai_chat：paid 模式 → 原样委托 PointsService.refund
# ---------------------------------------------------------------------------
def test_refund_ai_chat_paid_mode_delegates_refund():
    with patch.object(PointsService, "refund", return_value=Decimal("80")) as mock_refund:
        balance = PointsService.refund_ai_chat(1, 1, "AI助手回复失败退还", request_key="chat_refund:req-7", mode="paid", model_id="m1")

    assert balance == Decimal("80")
    mock_refund.assert_called_once_with(
        1, Decimal("1"), "AI助手回复失败退还",
        request_key="chat_refund:req-7", tx_type="chat_refund", model_id="m1",
    )


# ---------------------------------------------------------------------------
# get_ai_daily_quota：展示逻辑（免费用户懒重置展示，非免费用户 0/0）
# ---------------------------------------------------------------------------
def test_get_ai_daily_quota_free_user_today():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [_row(ai_daily_quota_remaining=3, ai_daily_quota_date=_TODAY)]
        info = PointsService.get_ai_daily_quota(1, True)
    assert info == {"total": 5, "remaining": 3}


def test_get_ai_daily_quota_free_user_stale_date_shows_total():
    from datetime import timedelta
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [_row(ai_daily_quota_remaining=0, ai_daily_quota_date=_TODAY - timedelta(days=1))]
        info = PointsService.get_ai_daily_quota(1, True)
    assert info == {"total": 5, "remaining": 5}  # 展示为 total，不落库


def test_get_ai_daily_quota_free_user_null_date_shows_total():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [_row(ai_daily_quota_remaining=0, ai_daily_quota_date=None)]
        info = PointsService.get_ai_daily_quota(1, True)
    assert info == {"total": 5, "remaining": 5}


def test_get_ai_daily_quota_subscriber_zero():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         _mock_db_conn() as conn:
        info = PointsService.get_ai_daily_quota(1, False)
    assert info == {"total": 0, "remaining": 0}
    conn.execute.assert_not_called()
