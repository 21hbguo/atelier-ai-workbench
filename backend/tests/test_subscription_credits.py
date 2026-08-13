"""积分包永久化：积分进永久桶、激活立即生效的 mock 单元测试。

覆盖 backend/services/subscription_service.py：
- _create_cycle_in_conn：credits 套餐积分走 PointsService.add_points（永久桶），
  不走订阅桶（周期过期/换套餐不清零）；会员套餐仍走订阅桶（回归保护）
- activate_plan_in_conn：积分包相关激活立即生效（current_cycle 不排队）；
  会员套餐在有效期内再次购买仍排队到下一周期（next_cycle，回归保护）

不连真实数据库，conn 与 PointsService 均打桩。
"""
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import backend.services.subscription_service as ss
from backend.services.points_service import PointsService


def _plan(package_type="credits", code="credits-500", name="积分基础包",
          grant_points=500, cycle_days=36500):
    return {"id": 7, "code": code, "name": name, "is_free": False,
            "cycle_days": cycle_days, "grant_points": grant_points,
            "features": {"package_type": package_type},
            "allowed_models": [], "max_concurrent_requests": 1}


def _state(plan, expires_at):
    return {
        "subscription": {"id": 1, "expires_at": expires_at},
        "cycle": {"id": 10, "status": "active"},
        "plan": plan,
    }


# ---------------------------------------------------------------------------
# _create_cycle_in_conn：积分发放路径
# ---------------------------------------------------------------------------
def test_create_cycle_credits_grants_permanent_points():
    """credits 套餐创建周期：积分经 add_points 进永久桶，不调订阅桶发放。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.return_value.fetchone.side_effect = [
        {"id": 10, "period_start": now, "period_end": now + timedelta(days=36500)},  # INSERT cycle
        {"id": 20},  # INSERT bucket
        {"id": 10, "status": "active"},  # SELECT cycle after grant
    ]
    with patch.object(PointsService, "add_points") as mock_add, \
         patch.object(PointsService, "grant_subscription_points_in_conn") as mock_grant:
        cycle = ss._create_cycle_in_conn(conn, 1, 5, _plan("credits", grant_points=500), now)

    mock_add.assert_called_once()
    assert mock_add.call_args.kwargs["amount"] == 500.0
    assert mock_add.call_args.kwargs["request_key"] == "credits-plan-grant:10"
    assert mock_add.call_args.kwargs["description"] == "积分基础包 永久积分"
    mock_grant.assert_not_called()
    assert cycle["id"] == 10


def test_create_cycle_membership_uses_subscription_bucket():
    """会员套餐创建周期：积分仍走订阅桶发放（回归保护）。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.return_value.fetchone.side_effect = [
        {"id": 11, "period_start": now, "period_end": now + timedelta(days=30)},  # INSERT cycle
        {"id": 21},  # INSERT bucket
        {"id": 11, "status": "active"},  # SELECT cycle after grant
    ]
    with patch.object(PointsService, "add_points") as mock_add, \
         patch.object(PointsService, "grant_subscription_points_in_conn") as mock_grant:
        ss._create_cycle_in_conn(conn, 1, 5, _plan("membership", code="member-month",
                                                   grant_points=50, cycle_days=30), now)

    mock_grant.assert_called_once()
    assert mock_grant.call_args.args[2] == 21  # bucket_id
    mock_add.assert_not_called()


# ---------------------------------------------------------------------------
# activate_plan_in_conn：激活/排队策略
# ---------------------------------------------------------------------------
def test_activate_member_immediate_when_credits_active():
    """已有 credits 积分包时购买会员：立即生效（current_cycle），不排队。"""
    conn = MagicMock(name="db_conn")
    state = _state(_plan("credits"), datetime.now() + timedelta(days=36500))
    with patch.object(ss, "ensure_current_cycle_in_conn", return_value=state), \
         patch.object(ss, "_expire_cycle_in_conn") as mock_expire, \
         patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-month",
                                                         grant_points=0, cycle_days=30))

    assert result == "current_cycle"
    mock_expire.assert_called_once()
    mock_create.assert_called_once()


def test_activate_credits_immediate_when_member_active():
    """会员有效期内购买积分包：立即生效（current_cycle），不排队。"""
    conn = MagicMock(name="db_conn")
    state = _state(_plan("membership", code="member-month", grant_points=0, cycle_days=30),
                   datetime.now() + timedelta(days=10))
    with patch.object(ss, "ensure_current_cycle_in_conn", return_value=state), \
         patch.object(ss, "_expire_cycle_in_conn") as mock_expire, \
         patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("credits"))

    assert result == "current_cycle"
    mock_expire.assert_called_once()
    mock_create.assert_called_once()


def test_activate_credits_immediate_when_credits_active():
    """再买一个积分包：立即生效，积分叠加（不排队）。"""
    conn = MagicMock(name="db_conn")
    state = _state(_plan("credits", code="credits-500"), datetime.now() + timedelta(days=36500))
    with patch.object(ss, "ensure_current_cycle_in_conn", return_value=state), \
         patch.object(ss, "_expire_cycle_in_conn") as mock_expire, \
         patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("credits", code="credits-1000",
                                                         grant_points=1000))

    assert result == "current_cycle"
    mock_expire.assert_called_once()
    mock_create.assert_called_once()


def test_activate_membership_queues_when_active():
    """会员有效期内再买会员：仍排队到下一周期（next_cycle，回归保护）。"""
    conn = MagicMock(name="db_conn")
    state = _state(_plan("membership", code="member-month", grant_points=0, cycle_days=30),
                   datetime.now() + timedelta(days=10))
    with patch.object(ss, "ensure_current_cycle_in_conn", return_value=state), \
         patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-year",
                                                         grant_points=0, cycle_days=365))

    assert result == "next_cycle"
    mock_create.assert_not_called()
    # UPDATE user_subscriptions SET next_plan_id ...
    conn.execute.assert_called_once()
    assert conn.execute.call_args.args[0].startswith("UPDATE user_subscriptions SET next_plan_id")
