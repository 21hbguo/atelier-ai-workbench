"""会员卡排队冻结 + 积分包永久化的 mock 单元测试。

覆盖 backend/services/subscription_service.py：
- activate_plan_in_conn：贵的先生效、便宜的排队冻结（pending_days > 0，不消耗时长）；
  同套餐合并（激活中顺延周期 / 排队中累加冻结时长）、新卡更贵升级顶掉、新卡不更贵排队等待
- ensure_current_cycle_in_conn：轮到排队/冻结卡才激活（建 cycle/bucket、pending_days 清零）
- get_current_state：返回 queued_cards（排队冻结中的会员卡列表）
- _create_cycle_in_conn：credits 套餐积分走 PointsService.add_points（永久桶），
  不走订阅桶（周期过期/换套餐不清零）；会员套餐仍走订阅桶（回归保护）

不连真实数据库，conn 与 PointsService 均打桩。
"""
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import backend.services.subscription_service as ss
from backend.services.points_service import PointsService


def _plan(package_type="credits", code="credits-500", name="积分基础包",
          grant_points=500, cycle_days=36500, price_rmb=0, plan_id=7):
    return {"id": plan_id, "code": code, "name": name, "is_free": False,
            "price_rmb": price_rmb,
            "cycle_days": cycle_days, "grant_points": grant_points,
            "features": {"package_type": package_type},
            "allowed_models": [], "max_concurrent_requests": 1}


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
# activate_plan_in_conn：积分包只加积分；会员卡贵的先生效、便宜的排队冻结
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


def test_activate_member_no_card_creates_new_card():
    """会员卡激活：用户无任何付费卡（池空）→ 新建立即生效（current_cycle）。"""
    conn = MagicMock(name="db_conn")
    conn.execute.side_effect = [
        MagicMock(),                                                   # SELECT users FOR UPDATE 锁行
        MagicMock(fetchall=MagicMock(return_value=[])),   # pool 查询：无付费会员卡
        MagicMock(fetchone=MagicMock(return_value={"id": 99, "plan_id": 7})),  # INSERT user_subscriptions
    ]
    with patch.object(ss, "_expire_cycle_in_conn") as mock_expire, \
         patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-day",
                                                         grant_points=0, cycle_days=1))
    assert result == "current_cycle"
    mock_create.assert_called_once()
    mock_expire.assert_not_called()
    # 第一条 SQL 必须是 users 行锁（防同套餐并发激活幻读双建卡的回归保护）
    first_sql = str(conn.execute.call_args_list[0].args[0])
    assert "FROM users" in first_sql and "FOR UPDATE" in first_sql
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO user_subscriptions" in str(c.args[0])]
    assert len(insert_calls) == 1
    user_id, plan_id = insert_calls[0].args[1][0], insert_calls[0].args[1][1]
    assert user_id == 1 and plan_id == 7


def test_activate_member_same_plan_active_card_extended():
    """同套餐激活中的卡：顺延叠加周期（period_end 变为 now+2d），不 INSERT 新卡、不建新周期。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(),                                                   # SELECT users FOR UPDATE 锁行
        MagicMock(fetchall=MagicMock(return_value=[{       # pool 查询：命中同套餐激活卡
            "sub_id": 5, "plan_id": 7, "pending_days": 0, "current_cycle_id": 10,
            "started_at": now, "period_end": now + timedelta(days=1), "cycle_status": "active",
        }])),
        MagicMock(),                                       # UPDATE subscription_cycles
        MagicMock(),                                       # UPDATE point_buckets（可消费期顺延）
        MagicMock(),                                       # UPDATE user_subscriptions
    ]
    with patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-day",
                                                         grant_points=0, cycle_days=1))
    assert result == "extended"
    mock_create.assert_not_called()
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO user_subscriptions" in str(c.args[0])]
    assert len(insert_calls) == 0
    expected = now + timedelta(days=2)
    cycle_updates = [c for c in conn.execute.call_args_list if "UPDATE subscription_cycles" in str(c.args[0])]
    assert len(cycle_updates) == 1
    assert abs((cycle_updates[0].args[1][0] - expected).total_seconds()) <= 60
    bucket_updates = [c for c in conn.execute.call_args_list if "UPDATE point_buckets" in str(c.args[0])]
    assert len(bucket_updates) == 1
    assert abs((bucket_updates[0].args[1][0] - expected).total_seconds()) <= 60
    assert bucket_updates[0].args[1][1] == 10  # cycle_id
    sub_updates = [c for c in conn.execute.call_args_list if "UPDATE user_subscriptions" in str(c.args[0])]
    assert len(sub_updates) == 1
    assert abs((sub_updates[0].args[1][0] - expected).total_seconds()) <= 60
    assert sub_updates[0].args[1][1] is None  # 未传 order_id 时 last_order_id 走 COALESCE 保留原值
    assert sub_updates[0].args[1][2] == 5


def test_activate_member_same_plan_extended_grants_points():
    """同套餐激活中叠加且 grant_points>0：查订阅桶并补发周期积分，request_key 用新前缀（不被幂等跳过）。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(),                                                   # SELECT users FOR UPDATE 锁行
        MagicMock(fetchall=MagicMock(return_value=[{       # pool 查询：命中同套餐激活卡
            "sub_id": 5, "plan_id": 7, "pending_days": 0, "current_cycle_id": 10,
            "started_at": now, "period_end": now + timedelta(days=1), "cycle_status": "active",
        }])),
        MagicMock(),                                       # UPDATE subscription_cycles
        MagicMock(),                                       # UPDATE point_buckets（可消费期顺延）
        MagicMock(),                                       # UPDATE user_subscriptions
        MagicMock(fetchone=MagicMock(return_value={"id": 20})),  # 订阅桶查询
    ]
    with patch.object(PointsService, "grant_subscription_points_in_conn") as mock_grant:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-day",
                                                         grant_points=50, cycle_days=1), order_id=123)
    assert result == "extended"
    mock_grant.assert_called_once()
    assert mock_grant.call_args.args[1] == 1     # user_id
    assert mock_grant.call_args.args[2] == 20    # bucket_id
    assert mock_grant.call_args.args[3] == 10    # cycle_id
    assert mock_grant.call_args.args[4] == 50.0  # amount
    assert mock_grant.call_args.args[5] == "积分基础包 叠加续期积分"
    key = mock_grant.call_args.args[6]
    assert key.startswith("subscription-extend-grant:10:123")
    # 订阅桶查询发生在积分发放之前（conn.execute 调用顺序：查卡、三个 UPDATE、查桶）
    bucket_calls = [c for c in conn.execute.call_args_list if "SELECT id FROM point_buckets" in str(c.args[0])]
    assert len(bucket_calls) == 1
    assert bucket_calls[0].args[1] == (10,)


def test_activate_member_same_plan_extended_no_order_id_grants_points():
    """appPush/vmq 真实路径：order_id=None 时叠加补发积分，request_key 用时间戳兜底（不重复）。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(),                                                   # SELECT users FOR UPDATE 锁行
        MagicMock(fetchall=MagicMock(return_value=[{       # pool 查询：命中同套餐激活卡
            "sub_id": 5, "plan_id": 7, "pending_days": 0, "current_cycle_id": 10,
            "started_at": now, "period_end": now + timedelta(days=1), "cycle_status": "active",
        }])),
        MagicMock(),                                       # UPDATE subscription_cycles
        MagicMock(),                                       # UPDATE point_buckets（可消费期顺延）
        MagicMock(),                                       # UPDATE user_subscriptions
        MagicMock(fetchone=MagicMock(return_value={"id": 20})),  # 订阅桶查询
    ]
    with patch.object(PointsService, "grant_subscription_points_in_conn") as mock_grant:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-day",
                                                         grant_points=50, cycle_days=1))
    assert result == "extended"
    mock_grant.assert_called_once()
    assert mock_grant.call_args.args[4] == 50.0  # amount
    key = mock_grant.call_args.args[6]
    assert key.startswith("subscription-extend-grant:10:") and not key.endswith(":None")
    # last_order_id 参数为 None：COALESCE 保留原值
    sub_updates = [c for c in conn.execute.call_args_list if "UPDATE user_subscriptions" in str(c.args[0])]
    assert sub_updates[0].args[1][1] is None


def test_activate_member_same_plan_expired_card_extended():
    """同套餐卡周期已过期（pending_days=0）：顺延叠加从 now 重新起算，不 INSERT 新卡。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(),                                                   # SELECT users FOR UPDATE 锁行
        MagicMock(fetchall=MagicMock(return_value=[{       # pool 查询：同套餐卡（周期已过期）
            "sub_id": 5, "plan_id": 7, "pending_days": 0, "current_cycle_id": 10,
            "started_at": now, "period_end": now - timedelta(days=1), "cycle_status": "expired",
        }])),
        MagicMock(),                                       # UPDATE subscription_cycles
        MagicMock(),                                       # UPDATE point_buckets
        MagicMock(),                                       # UPDATE user_subscriptions
    ]
    with patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-day",
                                                         grant_points=0, cycle_days=1))
    assert result == "extended"
    mock_create.assert_not_called()
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO user_subscriptions" in str(c.args[0])]
    assert len(insert_calls) == 0
    expected = now + timedelta(days=1)  # max(已过期 period_end, now) + 1d
    cycle_updates = [c for c in conn.execute.call_args_list if "UPDATE subscription_cycles" in str(c.args[0])]
    assert len(cycle_updates) == 1
    assert abs((cycle_updates[0].args[1][0] - expected).total_seconds()) <= 60


def test_activate_member_same_plan_queued_accumulates_pending():
    """同套餐排队/冻结中的卡：冻结时长直接累加（pending_days + days），不建周期、不发积分。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(),                                                   # SELECT users FOR UPDATE 锁行
        MagicMock(fetchall=MagicMock(return_value=[{       # pool 查询：同套餐排队卡（无 active 周期）
            "sub_id": 5, "plan_id": 7, "pending_days": 2, "current_cycle_id": None,
            "started_at": now, "period_end": None, "cycle_status": None,
        }])),
        MagicMock(),                                       # UPDATE user_subscriptions（累加冻结时长）
    ]
    with patch.object(ss, "_create_cycle_in_conn") as mock_create, \
         patch.object(PointsService, "grant_subscription_points_in_conn") as mock_grant:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-day",
                                                         grant_points=50, cycle_days=1), order_id=88)
    assert result == "extended"
    mock_create.assert_not_called()
    mock_grant.assert_not_called()
    # 只做 pending_days 累加 UPDATE，不 INSERT、不建周期
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO user_subscriptions" in str(c.args[0])]
    assert len(insert_calls) == 0
    cycle_updates = [c for c in conn.execute.call_args_list if "UPDATE subscription_cycles" in str(c.args[0])]
    assert len(cycle_updates) == 0
    acc_updates = [c for c in conn.execute.call_args_list if "pending_days = pending_days + %s" in str(c.args[0])]
    assert len(acc_updates) == 1
    assert acc_updates[0].args[1][0] == 1     # 累加 1 天
    assert acc_updates[0].args[1][1] == 88    # order_id
    assert acc_updates[0].args[1][2] == 5     # sub_id


def test_activate_member_new_plan_more_expensive_upgrades():
    """新卡比现有最贵卡更贵：立即生效（upgraded），顶掉激活卡——旧卡冻结剩余时长、周期 expire。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(),                                                   # SELECT users FOR UPDATE 锁行
        MagicMock(fetchall=MagicMock(return_value=[{       # pool 查询：现有激活中的月卡 89.9
            "sub_id": 5, "plan_id": 7, "pending_days": 0, "current_cycle_id": 10,
            "started_at": now, "period_end": now + timedelta(days=30), "cycle_status": "active",
            "price_rmb": 89.9,
        }])),
        MagicMock(),                                       # UPDATE user_subscriptions（旧卡冻结 pending_days=剩余）
        MagicMock(fetchone=MagicMock(return_value={"id": 99, "plan_id": 9})),  # INSERT 新卡
    ]
    with patch.object(ss, "_expire_cycle_in_conn") as mock_expire, \
         patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-year",
                                                         grant_points=0, cycle_days=365,
                                                         price_rmb=199, plan_id=9))
    assert result == "upgraded"
    mock_create.assert_called_once()
    # 被顶掉的旧卡周期被 expire（第二个位置参数 = cycle dict id=10，第一个是 conn）
    mock_expire.assert_called_once()
    assert mock_expire.call_args.args[1] == {"id": 10}
    # 旧卡冻结：pending_days = 剩余约 30 天，expires_at 置 NULL
    freeze_updates = [c for c in conn.execute.call_args_list if "pending_days = %s" in str(c.args[0])]
    assert len(freeze_updates) == 1
    assert abs(freeze_updates[0].args[1][0] - 30.0) <= 0.01
    assert freeze_updates[0].args[1][2] == 5
    # 新卡 INSERT 一行
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO user_subscriptions" in str(c.args[0])]
    assert len(insert_calls) == 1
    assert insert_calls[0].args[1][0] == 1 and insert_calls[0].args[1][1] == 9


def test_activate_member_new_plan_no_active_card_starts_immediately():
    """池中无激活中卡（只有排队/已过期卡）时，新卡直接立即生效（不排队、不冻结任何卡）。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(),                                                   # SELECT users FOR UPDATE 锁行
        MagicMock(fetchall=MagicMock(return_value=[{       # pool 查询：仅一张已过期卡（周期 expired）
            "sub_id": 5, "plan_id": 7, "pending_days": 0, "current_cycle_id": 10,
            "started_at": now - timedelta(days=40), "period_end": now - timedelta(days=10),
            "cycle_status": "expired", "price_rmb": 89.9,
        }])),
        MagicMock(fetchone=MagicMock(return_value={"id": 99, "plan_id": 9})),  # INSERT 新卡
    ]
    with patch.object(ss, "_expire_cycle_in_conn") as mock_expire, \
         patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-day",
                                                         grant_points=0, cycle_days=1,
                                                         price_rmb=9.9, plan_id=8))
    assert result == "upgraded"
    mock_create.assert_called_once()
    mock_expire.assert_not_called()   # 无激活卡可顶，不冻结任何卡
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO user_subscriptions" in str(c.args[0])]
    assert len(insert_calls) == 1
    assert insert_calls[0].args[1][1] == 8   # 新卡立即建行生效


def test_activate_member_new_plan_expired_and_queued_queues_new():
    """池中无激活卡但存在更贵排队卡：新卡应排队（不能立即生效，否则会被 ensure 激活的排队卡晾置浪费）。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(),                                                   # SELECT users FOR UPDATE 锁行
        MagicMock(fetchall=MagicMock(return_value=[       # pool：过期年卡 199 + 排队月卡 89.9（pending 10 天）
            {"sub_id": 1, "plan_id": 9, "pending_days": 0, "current_cycle_id": 11,
             "started_at": now - timedelta(days=400), "period_end": now - timedelta(days=10),
             "cycle_status": "expired", "price_rmb": 199},
            {"sub_id": 5, "plan_id": 7, "pending_days": 10, "current_cycle_id": None,
             "started_at": now - timedelta(days=5), "period_end": None,
             "cycle_status": None, "price_rmb": 89.9},
        ])),
        MagicMock(),                                       # INSERT 排队行
    ]
    with patch.object(ss, "_expire_cycle_in_conn") as mock_expire, \
         patch.object(ss, "_create_cycle_in_conn") as mock_create:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-day",
                                                         grant_points=0, cycle_days=1,
                                                         price_rmb=9.9, plan_id=8))
    assert result == "queued"
    mock_create.assert_not_called()
    mock_expire.assert_not_called()
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO user_subscriptions" in str(c.args[0])]
    assert len(insert_calls) == 1
    assert insert_calls[0].args[1][3] == 1     # 排队行 pending_days=1（第 4 个参数）
    assert insert_calls[0].args[1][4] is None  # order_id 未传


def test_activate_member_new_plan_cheaper_queued():
    """新卡不更贵：排队冻结（queued）——INSERT 行 pending_days=days、expires_at=NULL，不建 cycle/bucket、不发积分。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(),                                                   # SELECT users FOR UPDATE 锁行
        MagicMock(fetchall=MagicMock(return_value=[{       # pool 查询：现有激活中的年卡 199
            "sub_id": 5, "plan_id": 9, "pending_days": 0, "current_cycle_id": 10,
            "started_at": now, "period_end": now + timedelta(days=365), "cycle_status": "active",
            "price_rmb": 199.0,
        }])),
        MagicMock(),                                       # INSERT 排队卡（无 RETURNING）
    ]
    with patch.object(ss, "_expire_cycle_in_conn") as mock_expire, \
         patch.object(ss, "_create_cycle_in_conn") as mock_create, \
         patch.object(PointsService, "grant_subscription_points_in_conn") as mock_grant:
        result = ss.activate_plan_in_conn(conn, 1, _plan("membership", code="member-day",
                                                         grant_points=50, cycle_days=1,
                                                         price_rmb=9.9, plan_id=7), order_id=66)
    assert result == "queued"
    mock_create.assert_not_called()
    mock_expire.assert_not_called()
    mock_grant.assert_not_called()
    insert_calls = [c for c in conn.execute.call_args_list if "INSERT INTO user_subscriptions" in str(c.args[0])]
    assert len(insert_calls) == 1
    assert "pending_days" in str(insert_calls[0].args[0])
    assert insert_calls[0].args[1][0] == 1 and insert_calls[0].args[1][1] == 7
    assert insert_calls[0].args[1][3] == 1     # pending_days = 1 天
    assert insert_calls[0].args[1][4] == 66    # order_id
    # 不建任何周期/桶
    cycle_inserts = [c for c in conn.execute.call_args_list if "INSERT INTO subscription_cycles" in str(c.args[0])]
    assert len(cycle_inserts) == 0


# ---------------------------------------------------------------------------
# ensure_current_cycle_in_conn：多卡并存选最贵；轮到排队卡才激活
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
            "pending_days": 0, "price_rmb": 89.9,
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
            "pending_days": 0, "price_rmb": 89.9,
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
            "pending_days": 0, "price_rmb": 9.9,
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


def test_ensure_activates_queued_card_grants_points():
    """轮到排队卡：建 cycle/bucket、pending_days 清零；该卡从未激活过（current_cycle_id IS NULL）→ 补发积分。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value={"id": 1, "points": 0})),   # users
        MagicMock(),                                                           # point_buckets
        MagicMock(fetchone=MagicMock(return_value={                           # 选卡：排队卡（从未激活）
            "id": 6, "user_id": 1, "plan_id": 7, "status": "active",
            "current_cycle_id": None, "expires_at": None, "pending_days": 3, "price_rmb": 9.9,
        })),
        MagicMock(fetchone=MagicMock(return_value={                           # INSERT cycle
            "id": 12, "plan_id": 7, "status": "active",
            "period_start": now, "period_end": now + timedelta(days=3),
        })),
        MagicMock(fetchone=MagicMock(return_value={"id": 22})),               # INSERT bucket
        MagicMock(),                                                           # UPDATE user_subscriptions（激活）
        MagicMock(fetchone=MagicMock(return_value={                           # SELECT 更新后行
            "id": 6, "user_id": 1, "plan_id": 7, "status": "active",
            "current_cycle_id": 12, "expires_at": now + timedelta(days=3), "pending_days": 0,
        })),
    ]
    with patch.object(ss, "_get_plan", return_value=_plan("membership", code="member-day",
                                                          grant_points=50, cycle_days=1)), \
         patch.object(PointsService, "grant_subscription_points_in_conn") as mock_grant:
        state = ss.ensure_current_cycle_in_conn(conn, 1, now)

    assert state["subscription"]["id"] == 6
    assert state["cycle"]["id"] == 12
    # 周期按冻结时长起算（now + 3 天）
    cycle_inserts = [c for c in conn.execute.call_args_list if "INSERT INTO subscription_cycles" in str(c.args[0])]
    assert len(cycle_inserts) == 1
    assert abs((cycle_inserts[0].args[1][3] - (now + timedelta(days=3))).total_seconds()) <= 60
    # 激活 UPDATE：current_cycle_id=12、pending_days 清零
    activate_updates = [c for c in conn.execute.call_args_list
                        if "UPDATE user_subscriptions" in str(c.args[0]) and "pending_days = 0" in str(c.args[0])]
    assert len(activate_updates) == 1
    assert activate_updates[0].args[1][0] == 12
    # 从未激活过 → 补发积分（subscription-grant:{cycle_id}）
    mock_grant.assert_called_once()
    assert mock_grant.call_args.args[2] == 22    # bucket_id
    assert mock_grant.call_args.args[3] == 12    # cycle_id
    assert mock_grant.call_args.args[4] == 50.0  # amount
    assert mock_grant.call_args.args[6] == "subscription-grant:12"


def test_ensure_activates_frozen_card_without_points():
    """被顶掉过的冻结卡（current_cycle_id 指向已 expire 的周期）重新轮到：激活但不再发积分（防双发）。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value={"id": 1, "points": 0})),   # users
        MagicMock(),                                                           # point_buckets
        MagicMock(fetchone=MagicMock(return_value={                           # 选卡：冻结卡（曾被顶掉）
            "id": 6, "user_id": 1, "plan_id": 7, "status": "active",
            "current_cycle_id": 10, "expires_at": None, "pending_days": 5, "price_rmb": 9.9,
        })),
        MagicMock(fetchone=MagicMock(return_value={                           # INSERT cycle
            "id": 13, "plan_id": 7, "status": "active",
            "period_start": now, "period_end": now + timedelta(days=5),
        })),
        MagicMock(fetchone=MagicMock(return_value={"id": 23})),               # INSERT bucket
        MagicMock(),                                                           # UPDATE user_subscriptions
        MagicMock(fetchone=MagicMock(return_value={                           # SELECT 更新后行
            "id": 6, "user_id": 1, "plan_id": 7, "status": "active",
            "current_cycle_id": 13, "expires_at": now + timedelta(days=5), "pending_days": 0,
        })),
    ]
    with patch.object(ss, "_get_plan", return_value=_plan("membership", code="member-day",
                                                          grant_points=50, cycle_days=1)), \
         patch.object(PointsService, "grant_subscription_points_in_conn") as mock_grant:
        state = ss.ensure_current_cycle_in_conn(conn, 1, now)

    assert state["subscription"]["id"] == 6
    assert state["cycle"]["id"] == 13
    mock_grant.assert_not_called()  # 曾被顶掉（current_cycle_id 非空）→ 不发积分


def test_ensure_expired_card_then_activates_next_queued():
    """贵卡真过期被清理后：下一张排队卡激活（建周期倒计时，pending_days 清零）。"""
    conn = MagicMock(name="db_conn")
    now = datetime.now()
    conn.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value={"id": 1, "points": 0})),   # users
        MagicMock(),                                                           # point_buckets
        MagicMock(fetchone=MagicMock(return_value={                           # 选卡1：月卡（最贵但周期已耗尽）
            "id": 5, "user_id": 1, "plan_id": 7, "status": "active",
            "current_cycle_id": 10, "expires_at": now - timedelta(days=1),
            "pending_days": 0, "price_rmb": 89.9,
        })),
        MagicMock(fetchone=MagicMock(return_value={                           # 月卡 cycle（status active 但已过期）
            "id": 10, "plan_id": 7, "status": "active",
            "period_end": now - timedelta(days=1),
            "entitlements_snapshot": {"id": 7, "code": "member-month", "is_free": False,
                                      "features": {"package_type": "membership"},
                                      "allowed_models": [], "max_concurrent_requests": 1},
        })),
        MagicMock(),                                                           # UPDATE 卡 expired
        MagicMock(fetchone=MagicMock(return_value={                           # 选卡2：排队卡（轮到它了）
            "id": 6, "user_id": 1, "plan_id": 8, "status": "active",
            "current_cycle_id": None, "expires_at": None, "pending_days": 2, "price_rmb": 9.9,
        })),
        MagicMock(fetchone=MagicMock(return_value={                           # INSERT cycle
            "id": 14, "plan_id": 8, "status": "active",
            "period_start": now, "period_end": now + timedelta(days=2),
        })),
        MagicMock(fetchone=MagicMock(return_value={"id": 24})),               # INSERT bucket
        MagicMock(),                                                           # UPDATE user_subscriptions（激活）
        MagicMock(fetchone=MagicMock(return_value={                           # SELECT 更新后行
            "id": 6, "user_id": 1, "plan_id": 8, "status": "active",
            "current_cycle_id": 14, "expires_at": now + timedelta(days=2), "pending_days": 0,
        })),
    ]
    with patch.object(ss, "_get_plan", return_value=_plan("membership", code="member-day",
                                                          grant_points=0, cycle_days=1)), \
         patch.object(ss, "_expire_cycle_in_conn") as mock_expire:
        state = ss.ensure_current_cycle_in_conn(conn, 1, now)

    assert state["subscription"]["id"] == 6
    assert state["cycle"]["id"] == 14
    assert state["plan"]["code"] == "member-day"
    mock_expire.assert_called_once()  # 只 expire 真过期的月卡周期


# ---------------------------------------------------------------------------
# get_current_state：返回 queued_cards
# ---------------------------------------------------------------------------
def test_get_current_state_returns_queued_cards():
    """当前生效卡之外，排队冻结中的会员卡以 queued_cards 返回（价格降序、含 pending_days）。"""
    now = datetime.now()
    plan = _plan("membership", code="member-month", name="月卡", grant_points=0,
                 cycle_days=30, price_rmb=89.9)
    state = {
        "subscription": {"id": 5, "status": "active", "next_plan_id": None},
        "cycle": {"id": 10, "status": "active", "period_start": now,
                  "period_end": now + timedelta(days=30), "granted_points": 0, "remaining_points": 0},
        "plan": plan,
    }
    conn = MagicMock(name="db_conn")
    conn.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value={"points": 100})),   # permanent 桶
        MagicMock(fetchall=MagicMock(return_value=[                    # queued_cards 查询
            {"plan_id": 9, "plan_name": "年卡", "pending_days": 1.0, "price_rmb": "199"},
            {"plan_id": 7, "plan_name": "日卡", "pending_days": 2.5, "price_rmb": "9.9"},
        ])),
        MagicMock(fetchone=MagicMock(return_value={"points": 100})),   # users points
    ]
    with patch.object(ss, "ensure_current_cycle_in_conn", return_value=state), \
         patch("backend.database.get_db") as mock_db:
        mock_db.return_value.__enter__.return_value = conn
        result = ss.get_current_state(1)

    assert result["queued_cards"] == [
        {"plan_id": 9, "plan_name": "年卡", "pending_days": 1.0, "price_rmb": "199"},
        {"plan_id": 7, "plan_name": "日卡", "pending_days": 2.5, "price_rmb": "9.9"},
    ]
    # 排队卡查询 SQL 按价格降序、id 升序
    queued_sql = str(conn.execute.call_args_list[1].args[0])
    assert "pending_days > 0" in queued_sql
    assert "ORDER BY p.price_rmb DESC, us.id ASC" in queued_sql
