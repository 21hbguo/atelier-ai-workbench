"""AI 助手每日次数（chat_daily_total / consume_ai_chat / refund_ai_chat / get_ai_daily_quota）的 mock 单元测试。

覆盖 backend/services/points_service.py 的新机制：
- chat_daily_total：免费=全局配置；会员套餐=features.daily_quota（None=不限）；credits 包=0
- consume_ai_chat：有限额度先扣每日次数（懒重置含总额变化）、无额度/用尽扣通用积分、
  不限（None）不扣、同 request_key 幂等
- refund_ai_chat：free 次数 +1（幂等、封顶）、paid 委托 refund、unlimited 无操作
- get_ai_daily_quota：展示逻辑（免费/会员/不限/credits）

不连真实数据库，get_db 与 PointsService._consume_in_conn 均打桩。
"""
from contextlib import contextmanager
from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

import backend.services.points_service as ps_module
from backend.services.points_service import PointsService

_TODAY = datetime.now().date()

# 各档位 entitlements 快照（模拟 subscription_service.get_entitlements 的返回）
ENT_FREE = {"plan": {"is_free": True}, "features": {"web_search": True}}
ENT_MEMBER_60 = {"plan": {"is_free": False}, "features": {"package_type": "membership", "daily_quota": 60}}
ENT_MEMBER_UNLIMITED = {"plan": {"is_free": False}, "features": {"package_type": "membership", "daily_quota": None}}
ENT_CREDITS = {"plan": {"is_free": False}, "features": {"package_type": "credits"}}


@contextmanager
def _mock_db_conn():
    """Patch points_service 模块的 get_db；yield conn mock。"""
    conn = MagicMock(name="db_conn")
    with patch.object(ps_module, "get_db") as mock_get_db:
        mock_get_db.return_value.__enter__.return_value = conn
        mock_get_db.return_value.__exit__.return_value = False
        yield conn


def _row(**kwargs):
    return MagicMock(fetchone=MagicMock(return_value=kwargs))


# ---------------------------------------------------------------------------
# chat_daily_total：各档位每日次数总额
# ---------------------------------------------------------------------------
def test_chat_daily_total_free_uses_global_config():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}):
        assert PointsService.chat_daily_total(ENT_FREE) == 5


def test_chat_daily_total_membership_uses_daily_quota():
    assert PointsService.chat_daily_total(ENT_MEMBER_60) == 60


def test_chat_daily_total_membership_unlimited_is_none():
    assert PointsService.chat_daily_total(ENT_MEMBER_UNLIMITED) is None


def test_chat_daily_total_credits_no_quota():
    assert PointsService.chat_daily_total(ENT_CREDITS) == 0


# ---------------------------------------------------------------------------
# consume_ai_chat：有限额度，有剩余次数 → mode=free
# ---------------------------------------------------------------------------
def test_consume_ai_chat_free_uses_daily_quota():
    with _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # SELECT id ... FOR UPDATE
            _row(),                            # 幂等检查 → 无记录
            _row(),                            # UPDATE 懒重置（不读）
            _row(ai_daily_quota_remaining=5),  # 读剩余次数（重置后）
            _row(),                            # UPDATE 次数 -1
            _row(points=Decimal("100"), ai_daily_quota_remaining=4),  # 读 points + 新剩余
            _row(),                            # INSERT 标记流水（不读）
        ]
        result = PointsService.consume_ai_chat(1, 1, "AI助手对话 x1", "chat:req-1", daily_total=5, model_id="m1")

    assert result["mode"] == "free"
    assert result["balance"] == Decimal("100")
    assert result["remaining"] == 4
    # 懒重置 SQL 同时比较日期与总额（套餐档位变化触发重置）
    reset_sql = conn.execute.call_args_list[2][0][0]
    assert "ai_daily_quota_total" in reset_sql and "IS DISTINCT FROM" in reset_sql
    # 标记流水 amount=0（硬编码在 SQL），type='ai_daily_free'
    insert_sql, insert_args = conn.execute.call_args_list[-1][0]
    assert "'ai_daily_free'" in insert_sql
    assert insert_args[0] == 1 and insert_args[1] == Decimal("100")
    assert insert_args[3] == "chat:req-1"


# ---------------------------------------------------------------------------
# consume_ai_chat：免费用户，次数用尽 → 降级扣通用积分
# ---------------------------------------------------------------------------
def test_consume_ai_chat_quota_exhausted_degrades_to_points():
    with patch.object(PointsService, "_consume_in_conn", return_value=Decimal("99")) as mock_ci, \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # FOR UPDATE
            _row(),                            # 幂等检查 → 无记录
            _row(),                            # UPDATE 懒重置（今天已重置过 → 不影响）
            _row(ai_daily_quota_remaining=0),  # 剩余 0
        ]
        result = PointsService.consume_ai_chat(1, 1, "AI助手对话 x1", "chat:req-2", daily_total=5)

    assert result["mode"] == "paid"
    assert result["balance"] == Decimal("99")
    assert result["remaining"] == 0
    mock_ci.assert_called_once()
    args, kwargs = mock_ci.call_args
    assert args[0] == conn and args[1] == 1 and args[2] == Decimal("1")
    assert kwargs["tx_type"] == "chat_consume"
    assert kwargs["request_key"] == "chat:req-2"


# ---------------------------------------------------------------------------
# consume_ai_chat：无每日次数（画图积分包）→ 直接扣通用积分
# ---------------------------------------------------------------------------
def test_consume_ai_chat_credits_skips_quota():
    with patch.object(PointsService, "_consume_in_conn", return_value=Decimal("88")) as mock_ci, \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # FOR UPDATE
            _row(),                            # 幂等检查 → 无记录
        ]
        result = PointsService.consume_ai_chat(1, 1, "AI助手对话 x1", "chat:req-3", daily_total=0)

    assert result["mode"] == "paid"
    assert conn.execute.call_count == 2  # 无任何 ai_daily 相关 UPDATE
    mock_ci.assert_called_once()


# ---------------------------------------------------------------------------
# consume_ai_chat：不限次数（会员永久卡）→ 不扣次数不扣积分
# ---------------------------------------------------------------------------
def test_consume_ai_chat_unlimited_no_deduction():
    with _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # FOR UPDATE
            _row(),                            # 幂等检查 → 无记录
            _row(points=Decimal("100")),       # SELECT points
        ]
        result = PointsService.consume_ai_chat(1, 1, "AI助手对话 x1", "chat:req-4", daily_total=None)

    assert result["mode"] == "unlimited"
    assert result["balance"] == Decimal("100")
    assert result["remaining"] is None
    assert conn.execute.call_count == 3  # 无 UPDATE、无流水


# ---------------------------------------------------------------------------
# consume_ai_chat：同 request_key 重放 → 幂等，不重复扣
# ---------------------------------------------------------------------------
def test_consume_ai_chat_idempotent_replay():
    with _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # FOR UPDATE
            _row(type="ai_daily_free"),        # 幂等检查 → 已有免费标记
            _row(points=Decimal("100"), ai_daily_quota_remaining=4),
        ]
        result = PointsService.consume_ai_chat(1, 1, "AI助手对话 x1", "chat:req-5", daily_total=5)

    assert result["mode"] == "free"
    assert result["remaining"] == 4
    assert conn.execute.call_count == 3  # 无任何 UPDATE


# ---------------------------------------------------------------------------
# refund_ai_chat：free 模式 → 次数 +1（幂等、封顶 daily_total）
# ---------------------------------------------------------------------------
def test_refund_ai_chat_free_mode_adds_quota():
    with _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # FOR UPDATE
            _row(),                            # 退款标记检查 → 无
            _row(),                            # UPDATE 次数 +1（LEAST 封顶）
            _row(points=Decimal("100")),       # _balance_in_conn
            _row(),                            # INSERT 退款标记
        ]
        balance = PointsService.refund_ai_chat(1, 1, "AI助手回复失败退还", request_key="chat_refund:req-6", mode="free", daily_total=5)

    assert balance == Decimal("100")
    update_sql, update_args = conn.execute.call_args_list[2][0]
    assert "LEAST(COALESCE(ai_daily_quota_remaining, 0) + 1" in update_sql
    assert update_args[0] == 5  # 封顶参数=当前档位总额
    insert_sql = conn.execute.call_args_list[-1][0][0]
    assert "'ai_daily_free_refund'" in insert_sql


# ---------------------------------------------------------------------------
# refund_ai_chat：free 模式重放 → 幂等，不重复 +1
# ---------------------------------------------------------------------------
def test_refund_ai_chat_free_mode_idempotent():
    with _mock_db_conn() as conn:
        conn.execute.side_effect = [
            _row(id=1),                        # FOR UPDATE
            _row(id=99),                       # 退款标记已存在
            _row(points=Decimal("100")),       # _balance_in_conn
        ]
        balance = PointsService.refund_ai_chat(1, 1, "AI助手回复失败退还", request_key="chat_refund:req-7", mode="free", daily_total=5)

    assert balance == Decimal("100")
    assert conn.execute.call_count == 3  # 无 UPDATE 次数
    assert not any("ai_daily_quota_remaining" in call[0][0] for call in conn.execute.call_args_list)


# ---------------------------------------------------------------------------
# refund_ai_chat：paid 模式 → 委托 PointsService.refund
# ---------------------------------------------------------------------------
def test_refund_ai_chat_paid_mode_delegates_refund():
    with patch.object(PointsService, "refund", return_value=Decimal("80")) as mock_refund:
        balance = PointsService.refund_ai_chat(1, 1, "AI助手回复失败退还", request_key="chat_refund:req-8", mode="paid", model_id="m1")

    assert balance == Decimal("80")
    mock_refund.assert_called_once_with(
        1, Decimal("1"), "AI助手回复失败退还",
        request_key="chat_refund:req-8", tx_type="chat_refund", model_id="m1",
    )


# ---------------------------------------------------------------------------
# refund_ai_chat：unlimited 模式 → 无操作，直接返回余额
# ---------------------------------------------------------------------------
def test_refund_ai_chat_unlimited_noop():
    with patch.object(PointsService, "get_balance", return_value=Decimal("100")) as mock_bal, \
         patch.object(PointsService, "refund") as mock_refund:
        balance = PointsService.refund_ai_chat(1, 1, "AI助手回复失败退还", request_key="chat_refund:req-9", mode="unlimited")

    assert balance == Decimal("100")
    mock_bal.assert_called_once_with(1)
    mock_refund.assert_not_called()


# ---------------------------------------------------------------------------
# get_ai_daily_quota：展示逻辑（免费/会员/不限/credits + 懒重置展示）
# ---------------------------------------------------------------------------
def test_get_ai_daily_quota_free_user_today():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [_row(ai_daily_quota_remaining=3, ai_daily_quota_date=_TODAY, ai_daily_quota_total=5)]
        info = PointsService.get_ai_daily_quota(1, ENT_FREE)
    assert info == {"total": 5, "remaining": 3}


def test_get_ai_daily_quota_free_user_stale_date_shows_total():
    with patch.object(ps_module, "get_limit_config", return_value={"ai_daily_free_quota": 5}), \
         _mock_db_conn() as conn:
        conn.execute.side_effect = [_row(ai_daily_quota_remaining=0, ai_daily_quota_date=_TODAY - timedelta(days=1), ai_daily_quota_total=5)]
        info = PointsService.get_ai_daily_quota(1, ENT_FREE)
    assert info == {"total": 5, "remaining": 5}  # 展示为 total，不落库


def test_get_ai_daily_quota_quota_total_changed_shows_total():
    """套餐档位变化（如免费 5 → 月卡 60）后，即使同一天也按新总额展示。"""
    with _mock_db_conn() as conn:
        conn.execute.side_effect = [_row(ai_daily_quota_remaining=3, ai_daily_quota_date=_TODAY, ai_daily_quota_total=5)]
        info = PointsService.get_ai_daily_quota(1, ENT_MEMBER_60)
    assert info == {"total": 60, "remaining": 60}


def test_get_ai_daily_quota_membership_limited():
    with _mock_db_conn() as conn:
        conn.execute.side_effect = [_row(ai_daily_quota_remaining=45, ai_daily_quota_date=_TODAY, ai_daily_quota_total=60)]
        info = PointsService.get_ai_daily_quota(1, ENT_MEMBER_60)
    assert info == {"total": 60, "remaining": 45}


def test_get_ai_daily_quota_unlimited():
    with _mock_db_conn() as conn:
        info = PointsService.get_ai_daily_quota(1, ENT_MEMBER_UNLIMITED)
    assert info == {"total": None, "remaining": None}
    conn.execute.assert_not_called()


def test_get_ai_daily_quota_credits_zero():
    with _mock_db_conn() as conn:
        info = PointsService.get_ai_daily_quota(1, ENT_CREDITS)
    assert info == {"total": 0, "remaining": 0}
    conn.execute.assert_not_called()
