"""订阅权益快照兜底（老周期快照缺 is_free/package_type）的 mock 单元测试。

覆盖 backend/services/subscription_service.py 的 get_entitlements_in_conn：
- 套餐体系上线前的 free 周期快照缺 is_free → 按 cycle.plan_id 查当前套餐定义兜底为 is_free=True
- 快照缺 package_type 的会员/credits 套餐 → 用当前套餐定义补齐档位
- 新格式快照（含 is_free）不受影响
"""
from unittest.mock import MagicMock, patch

import backend.services.subscription_service as ss


def _state_with_snapshot(snapshot: dict, plan_id: int = 5):
    return {
        "subscription": {"status": "active", "id": 1},
        "cycle": {"id": 10, "plan_id": plan_id, "status": "active", "period_end": None,
                  "entitlements_snapshot": snapshot},  # psycopg 对 jsonb 列返回已解析 dict
    }


def _free_plan_db():
    return {"id": 5, "code": "free", "is_free": True, "features": {"web_search": True},
            "allowed_models": [], "max_concurrent_requests": 1}


def test_old_free_snapshot_without_is_free_is_backfilled():
    """老 free 周期快照缺 is_free → 兜底为 is_free=True。"""
    old_snapshot = {"id": 5, "code": "free", "name": "免费版", "features": {}, "allowed_models": [], "max_concurrent_requests": 1}
    conn = MagicMock()
    with patch.object(ss, "ensure_current_cycle_in_conn", return_value=_state_with_snapshot(old_snapshot)), \
         patch.object(ss, "_get_plan", return_value=_free_plan_db()):
        ent = ss.get_entitlements_in_conn(conn, 1)

    assert ent["plan"]["is_free"] is True
    assert ent["plan"]["code"] == "free"
    assert ent["active"] is True


def test_new_snapshot_with_is_free_unchanged():
    """新格式快照（含 is_free）不被兜底逻辑改写。"""
    new_snapshot = {"id": 5, "code": "free", "name": "免费版", "is_free": True, "features": {}, "allowed_models": [], "max_concurrent_requests": 1}
    conn = MagicMock()
    with patch.object(ss, "ensure_current_cycle_in_conn", return_value=_state_with_snapshot(new_snapshot)), \
         patch.object(ss, "_get_plan", return_value=_free_plan_db()) as mock_get_plan:
        ent = ss.get_entitlements_in_conn(conn, 1)

    assert ent["plan"]["is_free"] is True
    # is_free 已为 True，不触发查库兜底
    mock_get_plan.assert_not_called()


def test_membership_snapshot_missing_package_type_backfilled():
    """老会员周期快照缺 package_type → 用当前套餐定义补齐（日卡 60）。"""
    old_snapshot = {"id": 7, "code": "member-day", "name": "日卡", "is_free": False,
                    "features": {"web_search": True}, "allowed_models": [], "max_concurrent_requests": 1}
    db_member = {"id": 7, "code": "member-day", "is_free": False,
                 "features": {"web_search": True, "package_type": "membership", "daily_quota": 60},
                 "allowed_models": [], "max_concurrent_requests": 1}
    conn = MagicMock()
    with patch.object(ss, "ensure_current_cycle_in_conn", return_value=_state_with_snapshot(old_snapshot, plan_id=7)), \
         patch.object(ss, "_get_plan", return_value=db_member):
        ent = ss.get_entitlements_in_conn(conn, 1)

    assert ent["plan"]["is_free"] is False
    assert ent["features"]["package_type"] == "membership"
    assert ent["features"]["daily_quota"] == 60


def test_old_snapshot_plan_missing_in_db_keeps_snapshot():
    """当前套餐定义不存在（被删）→ 保持快照原值（is_free=False，不崩溃）。"""
    old_snapshot = {"id": 99, "code": "ghost", "name": "旧套餐", "features": {}, "allowed_models": [], "max_concurrent_requests": 1}
    conn = MagicMock()
    with patch.object(ss, "ensure_current_cycle_in_conn", return_value=_state_with_snapshot(old_snapshot, plan_id=99)), \
         patch.object(ss, "_get_plan", return_value=None):
        ent = ss.get_entitlements_in_conn(conn, 1)

    assert ent["plan"]["is_free"] is False
    assert ent["active"] is True


def test_entitlements_period_end_is_isoformat_string():
    """回归：entitlements.period_end 必须是 ISO 字符串（非 datetime 对象）。

    ctx.extra 透传 entitlements 给沙箱子进程时 json.dumps(payload)，
    datetime 不可序列化会导致工具全部失败；与 get_current_state 的 isoformat 行为对齐。
    """
    import json
    from datetime import datetime as _dt

    new_snapshot = {"id": 5, "code": "free", "name": "免费版", "is_free": True,
                    "features": {}, "allowed_models": [], "max_concurrent_requests": 1}
    state = _state_with_snapshot(new_snapshot)
    state["cycle"]["period_end"] = _dt(2026, 8, 14, 12, 0, 0)
    conn = MagicMock()
    with patch.object(ss, "ensure_current_cycle_in_conn", return_value=state), \
         patch.object(ss, "_get_plan", return_value=_free_plan_db()):
        ent = ss.get_entitlements_in_conn(conn, 1)

    assert ent["period_end"] == "2026-08-14T12:00:00"
    assert isinstance(ent["period_end"], str)
    # 沙箱 payload 链路（ctx.extra → json.dumps）必须可序列化
    json.dumps({"extra": {"entitlements": ent}})
