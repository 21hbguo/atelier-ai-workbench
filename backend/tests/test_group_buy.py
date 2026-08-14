"""拼团功能（group_buy_service + group_buys router + admin 管理）的 mock 单元测试。

不连真实数据库：所有 conn 均为 MagicMock（fetchone/fetchall 打桩），
activate_plan_in_conn / get_plan_in_conn 直接 patch。
"""
from contextlib import contextmanager
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.services.group_buy_service as gbs
from backend.services.group_buy_service import (
    list_active_group_buys, get_team_detail, join_or_create_team, upgrade_team, on_payment_success,
)
from backend.auth import get_current_user
from backend.database import get_db
from backend.routers import group_buys as group_buys_router
from backend.routers import subscriptions as subs_module


def _row(**kwargs):
    """一次 execute 调用的返回：fetchone → kwargs dict。"""
    return MagicMock(fetchone=MagicMock(return_value=kwargs))


def _rows(*items):
    """一次 execute 调用的返回：fetchall → items 列表。"""
    return MagicMock(fetchall=MagicMock(return_value=list(items)))


@contextmanager
def _mock_get_db(module, conn):
    """Patch 模块级 get_db（router 内 `with get_db() as conn:` 直接调用模块名，
    不走 FastAPI 依赖系统，故不能用 dependency_overrides）。"""
    with patch.object(module, "get_db") as mock_get_db:
        mock_get_db.return_value.__enter__.return_value = conn
        mock_get_db.return_value.__exit__.return_value = False
        yield conn


def _gb_row(**over):
    row = {
        "id": 3, "package_id": 7, "group_size": 5, "group_price": 11.8,
        "time_limit_min": 1440, "virtual_members": 2, "status": 1, "sort_order": 0,
        "package_name": "日卡", "price_rmb": 19.9, "original_price": 19.9,
        "grant_points": 100, "features": {"package_type": "membership", "daily_quota": 60},
        "is_free": False, "enabled": True,
    }
    row.update(over)
    return row


def _team_row(**over):
    row = {
        "team_id": 11, "group_buy_id": 3, "creator_user_id": 8, "team_status": 0,
        "status": 0, "expire_at": datetime.now() + timedelta(days=1),
        "group_size": 5, "group_price": 11.8, "package_id": 7,
        "plan_id": 7, "plan_name": "日卡", "features": {"package_type": "membership"},
        "grant_points": 100, "cycle_days": 1, "price_rmb": 19.9,
    }
    row.update(over)
    return row


def _member_row(**over):
    row = {"id": 9, "user_id": 8, "status": "pending"}
    row.update(over)
    return row


def _plan_dict():
    return {"id": 7, "code": "member-day", "name": "日卡", "price_rmb": "19.9",
            "cycle_days": 1, "grant_points": 100.0,
            "features": {"package_type": "membership", "daily_quota": 60},
            "allowed_models": [], "is_free": False, "enabled": True}


# ---------------------------------------------------------------------------
# 活动列表
# ---------------------------------------------------------------------------
def test_list_active_group_buys_filters_and_orders_teams():
    conn = MagicMock()
    conn.execute.side_effect = [
        _rows(_gb_row(id=1, group_price=9.9), _gb_row(id=2, group_price=11.8)),
        # gb1 的团：remain_need 分别为 2 / 1 / 4 / 0（最后一个满团被过滤）
        _rows({"id": 11, "paid_count": 3}, {"id": 12, "paid_count": 4},
              {"id": 13, "paid_count": 1}, {"id": 14, "paid_count": 5}),
        # gb2 的团
        _rows({"id": 21, "paid_count": 1}),
    ]
    items = list_active_group_buys(conn)

    assert len(items) == 2
    gb1 = items[0]
    assert gb1["package_name"] == "日卡"
    assert gb1["package_type"] == "membership"
    assert gb1["original_price"] == 19.9
    # 9.9 / 19.9 * 10 = 4.97 → 5.0 → 去尾 0 → "5折"
    assert gb1["discount_text"] == "5折"
    assert [t["id"] for t in gb1["teams"]] == [12, 11, 13]  # remain_need 升序 1/2/4，取 3 个
    assert gb1["teams"][0]["remain_need"] == 1
    # 满团（remain_need=0）不进列表
    assert all(t["remain_need"] > 0 for t in gb1["teams"])
    # 11.8 / 19.9 * 10 = 5.93 → 5.9折（保留 1 位）
    assert items[1]["discount_text"] == "5.9折"


# ---------------------------------------------------------------------------
# 参团 / 开团
# ---------------------------------------------------------------------------
def test_join_or_create_team_creates_new_team_with_virtual_members_and_request():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(**_gb_row()),   # 活动校验
        _row(),              # 该用户 pending 复用检查 → 无
        _row(),              # 无可加入团 → 开新团
        _row(id=11),         # INSERT team RETURNING id
        _row(),              # 虚拟成员 1
        _row(),              # 虚拟成员 2
        _row(id=501),        # INSERT recharge_requests RETURNING id
        _row(),              # INSERT member
    ]
    result = join_or_create_team(conn, 8, 3, "wechat", "1.2.3.4")

    assert result["team_id"] == 11
    assert result["request_id"] == 501
    assert result["amount"] == 11.8
    assert result["remaining_seconds"] == 600
    assert "扫码" in result["message"]

    calls = conn.execute.call_args_list
    # 虚拟成员：昵称从池按 (team_id + i) % 8 轮取（team_id=11 → 大熊 / Momo）
    virtual_sql1, virtual_args1 = calls[4][0]
    assert "group_buy_members" in virtual_sql1 and "'paid'" in virtual_sql1 and "TRUE" in virtual_sql1
    assert virtual_args1[0] == 11 and virtual_args1[1] == "大熊" and virtual_args1[2] == 11.8
    _, virtual_args2 = calls[5][0]
    assert virtual_args2[1] == "Momo"
    # recharge_requests：GB 前缀 tx_no、拼团价、套餐积分、团 id、pending
    req_sql, req_args = calls[6][0]
    assert "recharge_requests" in req_sql
    assert req_args[0] == 8 and req_args[1] == "wechat" and req_args[2] == 11.8
    assert req_args[3] == 100 and req_args[4] == 7 and req_args[5] == 11
    assert req_args[6] == "1.2.3.4" and req_args[7].startswith("GB")
    # 成员行（'pending' 为 SQL 字面量，参数仅 team_id/user_id/request_id）
    member_sql, member_args = calls[7][0]
    assert member_args == (11, 8, 501)


def test_join_or_create_team_reuses_partial_team():
    """存在未满团（paid=3, group_size=5）→ 加入已有团，不建虚拟成员。"""
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(**_gb_row()),   # 活动校验
        _row(),              # pending 复用检查 → 无
        _row(id=22),         # 可加入团
        _row(id=502),        # INSERT recharge_requests
        _row(),              # INSERT member
    ]
    result = join_or_create_team(conn, 8, 3, "alipay", "")

    assert result["team_id"] == 22
    assert result["request_id"] == 502
    calls = conn.execute.call_args_list
    assert len(calls) == 5  # 无虚拟成员插入
    # 加入已有团的请求也带 group_buy_team_id=22
    req_args = calls[3][0][1]
    assert req_args[5] == 22 and req_args[1] == "alipay"


def test_join_or_create_team_reuses_pending_request():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(**_gb_row()),
        _row(member_id=9, team_id=22, recharge_request_id=502),
    ]
    result = join_or_create_team(conn, 8, 3, "wechat", "")
    assert result["team_id"] == 22
    assert result["request_id"] == 502
    assert result["amount"] == 11.8
    assert "已有待支付" in result["message"]
    assert conn.execute.call_count == 2


def test_join_or_create_team_rejects_invalid_channel():
    conn = MagicMock()
    with pytest.raises(ValueError, match="wechat/alipay"):
        join_or_create_team(conn, 8, 3, "paypal", "")
    conn.execute.assert_not_called()


def test_join_or_create_team_rejects_offline_group_buy():
    conn = MagicMock()
    conn.execute.side_effect = [_row(**_gb_row(status=0))]
    with pytest.raises(ValueError, match="已下线"):
        join_or_create_team(conn, 8, 3, "wechat", "")


# ---------------------------------------------------------------------------
# on_payment_success：成团 / 幂等 / 升级
# ---------------------------------------------------------------------------
def test_on_payment_success_completes_group_and_activates_each_member_once():
    """成团：member 置 paid → 达标 → 锁团置 status=1 → 全部真实 paid 成员各激活一次。"""
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(**_team_row()),            # team JOIN
        _row(**_member_row()),          # member（锁前）
        _row(status=0),                 # FOR UPDATE 锁 team
        _row(**_member_row()),          # member（锁后）
        _row(),                         # UPDATE member → paid
        _row(cnt=5),                    # COUNT paid（虚拟2 + 真实3）
        _row(),                         # UPDATE team status=1
        _rows({"user_id": 1}, {"user_id": 2}, {"user_id": 8}),  # 真实 paid 成员
    ]
    with patch.object(gbs, "get_plan_in_conn", return_value=_plan_dict()) as mock_plan, \
         patch.object(gbs, "activate_plan_in_conn", return_value="current_cycle") as mock_act:
        result = on_payment_success(conn, {"id": 501, "user_id": 8, "amount": 11.8, "group_buy_team_id": 11})

    assert result == "group_buy_completed"
    mock_plan.assert_called_once_with(conn, 7)
    # 每成员恰好一次，order_id=team_id（credits 幂等 request_key 复用团 id）
    assert [c.args[1] for c in mock_act.call_args_list] == [1, 2, 8]
    assert all(c.kwargs.get("order_id") == 11 for c in mock_act.call_args_list)
    # 成员置 paid：paid_amount=11.8、recharge_request_id=501
    update_sql, update_args = conn.execute.call_args_list[4][0]
    assert "status = 'paid'" in update_sql
    assert update_args[0] == 11.8 and update_args[1] == 501 and update_args[2] == 9
    # 成团 UPDATE 在成员激活之前
    assert conn.execute.call_args_list[6][0][0].startswith("UPDATE group_buy_teams")


def test_on_payment_success_duplicate_callback_is_idempotent():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(**_team_row()),
        _row(**_member_row(status="paid")),  # 已 paid → 幂等
    ]
    with patch.object(gbs, "activate_plan_in_conn") as mock_act:
        result = on_payment_success(conn, {"id": 501, "user_id": 8, "amount": 11.8, "group_buy_team_id": 11})
    assert result == "group_buy_duplicate"
    mock_act.assert_not_called()


def test_on_payment_success_pending_when_not_full():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(**_team_row()),
        _row(**_member_row()),
        _row(status=0),
        _row(**_member_row()),
        _row(),
        _row(cnt=4),  # 未达标
    ]
    with patch.object(gbs, "activate_plan_in_conn") as mock_act:
        result = on_payment_success(conn, {"id": 501, "user_id": 8, "amount": 11.8, "group_buy_team_id": 11})
    assert result == "group_buy_pending"
    mock_act.assert_not_called()


def test_on_payment_success_upgrade_activates_user():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(**_team_row(team_status=2, status=2)),  # 已过期
        _row(status=2),                              # FOR UPDATE 锁 team
        _row(),                                      # approved 幂等检查 → 无
    ]
    with patch.object(gbs, "get_plan_in_conn", return_value=_plan_dict()) as mock_plan, \
         patch.object(gbs, "activate_plan_in_conn", return_value="current_cycle") as mock_act:
        result = on_payment_success(conn, {"id": 601, "user_id": 8, "amount": 8.1, "group_buy_team_id": 11})

    assert result == "group_buy_upgrade_activated"
    mock_act.assert_called_once_with(conn, 8, _plan_dict(), order_id=11)


def test_on_payment_success_upgrade_duplicate():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(**_team_row(team_status=2, status=2)),
        _row(status=2),  # FOR UPDATE 锁 team
        _row(id=555),    # 已 approved 升级单
    ]
    with patch.object(gbs, "activate_plan_in_conn") as mock_act:
        result = on_payment_success(conn, {"id": 601, "user_id": 8, "amount": 8.1, "group_buy_team_id": 11})
    assert result == "group_buy_duplicate"
    mock_act.assert_not_called()


def test_on_payment_success_non_group_returns_none():
    conn = MagicMock()
    assert on_payment_success(conn, {"id": 1, "user_id": 1}) is None
    conn.execute.assert_not_called()


def test_on_payment_success_team_missing_returns_none():
    conn = MagicMock()
    conn.execute.side_effect = [_row()]
    assert on_payment_success(conn, {"id": 501, "user_id": 8, "group_buy_team_id": 999}) is None


# ---------------------------------------------------------------------------
# 团详情
# ---------------------------------------------------------------------------
def test_get_team_detail_members_order_and_flags():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(team_id=11, group_buy_id=3, creator_user_id=8, status=0,
             expire_at=datetime(2026, 12, 2, 10, 30, 0), group_size=5, group_price=11.8,
             package_name="日卡", original_price=19.9,
             features={"package_type": "membership", "daily_quota": 60}),
        _rows(
            {"id": 1, "user_id": 8, "status": "paid", "is_virtual": False,
             "virtual_nickname": "", "virtual_avatar": "", "created_at": datetime(2026, 1, 1, 9, 0, 0)},
            {"id": 2, "user_id": 9, "status": "pending", "is_virtual": False,
             "virtual_nickname": "", "virtual_avatar": "", "created_at": datetime(2026, 1, 1, 9, 1, 0)},
            {"id": 3, "user_id": None, "status": "paid", "is_virtual": True,
             "virtual_nickname": "桃子", "virtual_avatar": "", "created_at": datetime(2026, 1, 1, 9, 2, 0)},
        ),
    ]
    detail = get_team_detail(conn, 11, viewer_user_id=8)

    assert detail["id"] == 11
    assert detail["expire_at"] == "2026-12-02T10:30:00"
    assert detail["paid_count"] == 2
    assert detail["group_size"] == 5
    assert detail["package_name"] == "日卡"
    assert detail["my_paid"] is True
    assert detail["my_member"] is True
    # 虚拟成员排后
    assert [m["is_virtual"] for m in detail["members"]] == [False, False, True]
    assert detail["members"][0]["is_creator"] is True
    assert detail["members"][0]["is_self"] is True
    assert detail["members"][1]["is_self"] is False
    assert detail["members"][2]["virtual_nickname"] == "桃子"
    assert detail["members"][2]["is_creator"] is False


def test_get_team_detail_missing_team_raises():
    conn = MagicMock()
    conn.execute.side_effect = [_row()]
    with pytest.raises(ValueError, match="拼团不存在"):
        get_team_detail(conn, 999)


def test_get_team_detail_lazily_expires_stale_team():
    """回归（review block）：过期团必须能被置为 status=2，否则补差价升级永远不可达。"""
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(team_id=11, group_buy_id=3, creator_user_id=8, status=0,
             expire_at=datetime.now() - timedelta(minutes=1), group_size=5, group_price=11.8,
             package_name="日卡", original_price=19.9,
             features={"package_type": "membership", "daily_quota": 60}),
        _row(),  # UPDATE team SET status=2
        _rows(),
    ]
    detail = get_team_detail(conn, 11)
    assert detail["status"] == 2
    update_sql = conn.execute.call_args_list[1][0][0]
    assert "UPDATE group_buy_teams" in update_sql and "status = 2" in update_sql


def test_upgrade_team_allows_stale_expired_team():
    """回归：status=0 但已过 expire_at 的团，升级下单应可用（惰性过期后走升级）。"""
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(team_id=11, team_status=0, expire_at=datetime.now() - timedelta(minutes=1),
             group_price=9.9, plan_id=7, price_rmb=19.9, grant_points=100),
        _row(),  # UPDATE team SET status=2
        _row(id=9),   # paid member
        _row(),       # 已激活检查 → 无
        _row(),       # pending 升级单 → 无
        _row(id=602), # INSERT request
    ]
    result = upgrade_team(conn, 8, 11, "wechat", "1.2.3.4")
    assert result["request_id"] == 602
    assert result["amount"] == 10.0


# ---------------------------------------------------------------------------
# 过期升级（下单）
# ---------------------------------------------------------------------------
def test_upgrade_team_creates_diff_request():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(team_id=11, team_status=2, expire_at=datetime.now() + timedelta(days=1),
             group_price=9.9, plan_id=7, price_rmb=19.9, grant_points=100),
        _row(id=9),      # paid member
        _row(),          # 已激活检查 → 无
        _row(),          # pending 升级单 → 无
        _row(id=602),    # INSERT request
    ]
    result = upgrade_team(conn, 8, 11, "wechat", "1.2.3.4")

    assert result["team_id"] == 11
    assert result["request_id"] == 602
    assert result["amount"] == 10.0  # 19.9 - 9.9
    assert result["remaining_seconds"] == 600
    req_args = conn.execute.call_args_list[4][0][1]
    assert req_args[2] == 10.0 and req_args[3] == 100 and req_args[4] == 7 and req_args[5] == 11
    assert req_args[7].startswith("GB")


def test_upgrade_team_rejects_non_member():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(team_id=11, team_status=2, expire_at=datetime.now() + timedelta(days=1),
             group_price=9.9, plan_id=7, price_rmb=19.9, grant_points=100),
        _row(),  # 非 paid 成员
    ]
    with pytest.raises(ValueError, match="已支付成员"):
        upgrade_team(conn, 8, 11, "wechat", "")


def test_upgrade_team_rejects_not_expired_team():
    conn = MagicMock()
    conn.execute.side_effect = [_row(team_id=11, team_status=0, expire_at=datetime.now() + timedelta(days=1),
                                     group_price=9.9, plan_id=7, price_rmb=19.9, grant_points=100)]
    with pytest.raises(ValueError, match="未过期"):
        upgrade_team(conn, 8, 11, "wechat", "")


def test_upgrade_team_rejects_already_activated():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(team_id=11, team_status=2, expire_at=datetime.now() + timedelta(days=1),
             group_price=9.9, plan_id=7, price_rmb=19.9, grant_points=100),
        _row(id=9),
        _row(id=555),  # 已 approved
    ]
    with pytest.raises(ValueError, match="已通过该团激活"):
        upgrade_team(conn, 8, 11, "wechat", "")


def test_upgrade_team_rejects_non_positive_diff():
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(team_id=11, team_status=2, expire_at=datetime.now() + timedelta(days=1),
             group_price=19.9, plan_id=7, price_rmb=19.9, grant_points=100),
        _row(id=9),
        _row(),
        _row(),
    ]
    with pytest.raises(ValueError, match="无需补差价"):
        upgrade_team(conn, 8, 11, "wechat", "")


# ---------------------------------------------------------------------------
# router 层：登录 / 参数校验 / admin
# ---------------------------------------------------------------------------
@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(group_buys_router.router)
    return TestClient(app)


@pytest.fixture
def admin_client():
    app = FastAPI()
    app.include_router(subs_module.admin_router)
    return TestClient(app)


def test_active_group_buys_requires_login(client):
    resp = client.get("/api/group-buys/active")
    assert resp.status_code == 401


def test_team_detail_is_public_without_login(client):
    conn = MagicMock()
    conn.execute.side_effect = [
        _row(team_id=11, group_buy_id=3, creator_user_id=8, status=0,
             expire_at=datetime(2026, 12, 2, 10, 30, 0), group_size=5, group_price=11.8,
             package_name="日卡", original_price=19.9, features={"package_type": "membership"}),
        _rows(),
    ]

    with _mock_get_db(group_buys_router, conn):
        resp = client.get("/api/group-buys/teams/11")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == 11
    assert body["my_member"] is False  # 未登录无 viewer


def test_create_team_and_pay_rejects_invalid_channel(client):
    conn = MagicMock()
    conn.execute.side_effect = [_row(**_gb_row())]

    client.app.dependency_overrides[get_current_user] = lambda: {"user_id": 8}
    with _mock_get_db(group_buys_router, conn):
        resp = client.post("/api/group-buys/3/create-team-and-pay", json={"channel": "paypal"})
    assert resp.status_code == 400
    assert "wechat/alipay" in resp.json()["detail"]


def test_create_team_and_pay_ok_with_login(client):
    conn = MagicMock()
    # 活动校验 / pending 复用检查 / 无可加入团 / INSERT team / 虚拟成员×2 / INSERT recharge / INSERT member
    conn.execute.side_effect = [
        _row(**_gb_row()),
        _row(),
        _row(),
        _row(id=22),
        _row(),
        _row(),
        _row(id=502),
        _row(),
    ]

    client.app.dependency_overrides[get_current_user] = lambda: {"user_id": 8}
    with _mock_get_db(group_buys_router, conn):
        resp = client.post("/api/group-buys/3/create-team-and-pay", json={"channel": "wechat"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["team_id"] == 22 and body["request_id"] == 502


def test_admin_create_group_buy_requires_valid_package(admin_client):
    conn = MagicMock()
    conn.execute.return_value = _row()  # package 查询 → 不存在

    admin_client.app.dependency_overrides[get_current_user] = lambda: {"user_id": 1, "is_admin": True}
    with _mock_get_db(subs_module, conn):
        resp = admin_client.post("/api/admin/group-buys", json={
            "package_id": 999, "group_size": 5, "group_price": 9.9,
            "time_limit_min": 1440, "virtual_members": 2, "sort_order": 1, "status": 1,
        })
    assert resp.status_code == 404


def test_admin_create_group_buy_validates_size(admin_client):
    conn = MagicMock()
    conn.execute.side_effect = [_row(id=7, allow_group_buy=True)]

    admin_client.app.dependency_overrides[get_current_user] = lambda: {"user_id": 1, "is_admin": True}
    with _mock_get_db(subs_module, conn):
        resp = admin_client.post("/api/admin/group-buys", json={
            "package_id": 7, "group_size": 1, "group_price": 9.9,
            "time_limit_min": 1440, "virtual_members": 0, "sort_order": 1, "status": 1,
        })
    assert resp.status_code == 400
    assert "成团人数" in resp.json()["detail"]


def test_admin_create_group_buy_requires_allow_group_buy(admin_client):
    """套餐未开启拼团 → 400（套餐编辑里的「允许拼团」开关控制）。"""
    conn = MagicMock()
    conn.execute.side_effect = [_row(id=7, allow_group_buy=False)]

    admin_client.app.dependency_overrides[get_current_user] = lambda: {"user_id": 1, "is_admin": True}
    with _mock_get_db(subs_module, conn):
        resp = admin_client.post("/api/admin/group-buys", json={
            "package_id": 7, "group_size": 3, "group_price": 9.9,
            "time_limit_min": 1440, "virtual_members": 1, "sort_order": 1, "status": 1,
        })
    assert resp.status_code == 400
    assert "未开启拼团" in resp.json()["detail"]


def test_admin_group_buys_requires_login(admin_client):
    resp = admin_client.get("/api/admin/group-buys")
    assert resp.status_code == 401
