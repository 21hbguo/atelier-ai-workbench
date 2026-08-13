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
# activate_plan_in_conn：新语义（积分包只加积分不动订阅；会员卡新增独立计时卡）
# ---------------------------------------------------------------------------
def test_activate_credits_only_adds_points_keeps_subscription():
    """积分包激活：只加永久积分，不建周期、不动订阅（不 expire 当前会员周期、不切换套餐）。"""
    conn = MagicMock(name="db_conn")
    with patch.object(PointsService, "add_points") as mock_add, \
         patch.object(ss, "ensure_current_cycle_in_conn") as mock_ensure, \
         patch.object(ss, "_expire_cycle_in_conn") as mock_expire, \
         patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("credits", grant_points=500))

    assert result == "credits"
    mock_add.assert_called_once()
    assert mock_add.call_args.kwargs["amount"] == 500.0
    mock_ensure.assert_not_called()
    mock_expire.assert_not_called()
    mock_create.assert_not_called()
    # 未对 user_subscriptions / subscription_cycles 做任何写入
    for call in conn.execute.call_args_list:
        sql = str(call.args[0])
        assert "user_subscriptions" not in sql and "subscription_cycles" not in sql


def test_activate_credits_zero_points_noop():
    """积分包 grant_points=0：仍返回 credits，不写任何东西。"""
    conn = MagicMock(name="db_conn")
    with patch.object(PointsService, "add_points") as mock_add:
        result = ss.activate_plan_in_conn(conn, 1, _plan("credits", grant_points=0))
    assert result == "credits"
    mock_add.assert_not_called()


def test_activate_member_creates_new_independent_card():
    """会员卡激活：INSERT 新订阅行（独立计时）+ 建新周期；不 expire 现有卡。"""
    conn = MagicMock(name="db_conn")
    conn.execute.return_value.fetchone.return_value = {"id": 99, "plan_id": 7}
    with patch.object(ss, "_expire_cycle_in_conn") as mock_expire, \
         patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-day",
                                                         grant_points=0, cycle_days=1))
    assert result == "current_cycle"
    mock_create.assert_called_once()
    mock_expire.assert_not_called()
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO user_subscriptions" in str(c.args[0])]
    assert len(insert_calls) == 1
    user_id, plan_id = insert_calls[0].args[1][0], insert_calls[0].args[1][1]
    assert user_id == 1 and plan_id == 7


# ---------------------------------------------------------------------------
# ensure_current_cycle_in_conn：多卡并存选最贵
# ---------------------------------------------------------------------------
def test_ensure_picks_most_expensive_active_card():
    """多张会员卡并存：选价格最高、未过期的一张作为当前权益（贵的优先）。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value={"id": 1, "points": 0})),  # SELECT users FOR UPDATE
        MagicMock(),                                                          # INSERT point_buckets
        MagicMock(fetchone=MagicMock(return_value={                           # 选卡查询（最贵=月卡89.9）
            "id": 5, "user_id": 1, "plan_id": 7, "status": "active",
            "current_cycle_id": 10, "expires_at": now + timedelta(days=30),
            "price_rmb": 89.9,
        })),
        MagicMock(fetchone=MagicMock(return_value={                           # SELECT cycle FOR UPDATE
            "id": 10, "plan_id": 7, "status": "active",
            "period_end": now + timedelta(days=30),
            "entitlements_snapshot": {"id": 7, "code": "member-month", "name": "月卡",
                                      "is_free": False, "features": {"package_type": "membership"},
                                      "allowed_models": [], "max_concurrent_requests": 1},
        })),
    ]
    state = ss.ensure_current_cycle_in_conn(conn, 1, now)
    assert state["subscription"]["id"] == 5
    assert state["plan"]["code"] == "member-month"


def test_ensure_falls_back_to_free_when_no_active_paid_card():
    """无有效付费卡：回退免费套餐（复用已有 free 行）。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    free_plan = {"id": 1, "code": "free", "is_free": True, "features": {},
                 "allowed_models": [], "max_concurrent_requests": 1}
    conn.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value={"id": 1, "points": 0})),   # users
        MagicMock(),                                                           # point_buckets
        MagicMock(fetchone=MagicMock(return_value=None)),                      # 选卡查询无结果
        MagicMock(fetchone=MagicMock(return_value={                            # free 行查询
            "id": 2, "user_id": 1, "plan_id": 1, "status": "active",
            "current_cycle_id": 3, "expires_at": now + timedelta(days=30),
        })),
        MagicMock(fetchone=MagicMock(return_value={                            # free cycle
            "id": 3, "plan_id": 1, "status": "active", "period_end": now + timedelta(days=30),
            "entitlements_snapshot": {"id": 1, "code": "free", "is_free": True,
                                      "features": {}, "allowed_models": [], "max_concurrent_requests": 1},
        })),
    ]
    with patch.object(ss, "_get_plan", return_value=free_plan):
        state = ss.ensure_current_cycle_in_conn(conn, 1, now)
    assert state["plan"]["code"] == "free"


def test_ensure_expires_stale_cards_and_switches_to_next():
    """贵卡过期：自动清理（expire 周期 + 卡标记 expired）并切换到下一张有效卡。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value={"id": 1, "points": 0})),   # users
        MagicMock(),                                                           # point_buckets
        MagicMock(fetchone=MagicMock(return_value={                           # 选卡：月卡（最贵但已过期）
            "id": 5, "user_id": 1, "plan_id": 7, "status": "active",
            "current_cycle_id": 10, "expires_at": now - timedelta(days=1),
            "price_rmb": 89.9,
        })),
        MagicMock(fetchone=MagicMock(return_value={                           # 月卡 cycle（已过期）
            "id": 10, "plan_id": 7, "status": "active",
            "period_end": now - timedelta(days=1),
            "entitlements_snapshot": {"id": 7, "code": "member-month", "is_free": False,
                                      "features": {"package_type": "membership"},
                                      "allowed_models": [], "max_concurrent_requests": 1},
        })),
        MagicMock(),                                                           # UPDATE 卡 expired
        MagicMock(fetchone=MagicMock(return_value={                           # 选卡：日卡（有效，次贵）
            "id": 6, "user_id": 1, "plan_id": 8, "status": "active",
            "current_cycle_id": 11, "expires_at": now + timedelta(days=2),
            "price_rmb": 9.9,
        })),
        MagicMock(fetchone=MagicMock(return_value={                           # 日卡 cycle（有效）
            "id": 11, "plan_id": 8, "status": "active", "period_end": now + timedelta(days=2),
            "entitlements_snapshot": {"id": 8, "code": "member-day", "is_free": False,
                                      "features": {"package_type": "membership"},
                                      "allowed_models": [], "max_concurrent_requests": 1},
        })),
    ]
    with patch.object(ss, "_expire_cycle_in_conn") as mock_expire:
        state = ss.ensure_current_cycle_in_conn(conn, 1, now)
    assert state["subscription"]["id"] == 6
    assert state["plan"]["code"] == "member-day"
    mock_expire.assert_called_once()  # 只 expire 过期的月卡周期
    # 过期卡被标记 expired
    update_calls = [c for c in conn.execute.call_args_list if "SET status = 'expired'" in str(c.args[0])]
    assert len(update_calls) == 1
