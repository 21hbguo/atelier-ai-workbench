"""拼团服务：活动列表 / 团详情 / 参团开团 / 过期升级 / 支付到账处理。

设计约定（与 recharge_requests 支付链路对齐）：
- 拼团下单走 recharge_requests（channel/amount/points/plan_id/group_buy_team_id），
  不插入 point_transactions（成团激活由 activate_plan_in_conn 内部记账，幂等靠
  member 状态 / team 状态 / credits request_key 唯一索引）。
- 所有函数接收 conn，不自开事务，由调用方（router / 支付回调 / 人工审核）管理事务。
- 支付回调（on_payment_success）用「FOR UPDATE 锁 team 行」串行化同一团的并发回调：
  先幂等检查（member 状态）→ 锁 team → 锁内重查 member（防并发窗口）→ 置 paid →
  count 达标则成团并逐个激活真实 paid 成员；成团后迟到的支付（并发尾单）补激活本人。
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from psycopg.errors import UniqueViolation

from backend.services.subscription_service import activate_plan_in_conn, get_plan_in_conn

_VIRTUAL_NICKNAME_POOL = ["小琳", "阿杰", "桃子", "大熊", "Momo", "星星", "老白", "柚子"]

_REMAINING_SECONDS = 600

# on_payment_success 返回值 → 中文说明（调用方写入 review_note / 通知文案）
PAYMENT_RESULT_NOTES = {
    "group_buy_pending": "拼团款已到账，等待成团后统一激活",
    "group_buy_completed": "拼团款已到账，团已成团，套餐已激活",
    "group_buy_upgrade_activated": "拼团补差价已到账，套餐已激活",
    "group_buy_duplicate": "拼团支付重复回调，已忽略",
}


def _iso(dt) -> str:
    """datetime → ISO 字符串（兼容字符串输入，方便测试）。"""
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


def _float(value) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _maybe_expire_team(conn, team_id: int, team_status, expire_at) -> int:
    """惰性过期：status=0 且已过 expire_at 的团置为 status=2（幂等，供详情/升级/回调共用）。

    返回处理后的 team status。"""
    status = int(team_status or 0)
    if status == 0 and expire_at is not None:
        if isinstance(expire_at, str):
            try:
                expire_at = datetime.fromisoformat(expire_at)
            except ValueError:
                return status
        if expire_at < datetime.now():
            conn.execute("UPDATE group_buy_teams SET status = 2 WHERE id = %s AND status = 0", (team_id,))
            return 2
    return status


def _discount_text(group_price: float, original_price: float) -> str:
    """折扣文案：现价/原价*10 保留 1 位小数并去尾 0，如 5.9折 / 5折。"""
    if original_price <= 0:
        return "—"
    discount = round(group_price / original_price * 10, 1)
    text = f"{discount:g}"
    return f"{text}折"


def _build_group_buy_row(row) -> dict:
    """JOIN 结果（group_buys + subscription_plans）转活动 dict。"""
    gb = dict(row)
    return {
        "id": gb["id"],
        "package_id": gb["package_id"],
        "package_name": gb.get("package_name") or "",
        "package_type": (gb.get("features") or {}).get("package_type") or "",
        "group_size": int(gb["group_size"] or 0),
        "group_price": _float(gb["group_price"]),
        "original_price": _float(gb.get("original_price") or gb.get("price_rmb")),
        "status": int(gb["status"] or 0),
        "sort_order": int(gb.get("sort_order") or 0),
        "time_limit_min": int(gb.get("time_limit_min") or 1440),
        "virtual_members": int(gb.get("virtual_members") or 0),
        "grant_points": int(gb.get("grant_points") or 0),
    }


def _get_group_buy_row(conn, group_buy_id: int):
    return conn.execute(
        """SELECT gb.*, p.name AS package_name, p.price_rmb AS original_price, p.features,
                  p.is_free, p.enabled, p.grant_points
           FROM group_buys gb
           JOIN subscription_plans p ON p.id = gb.package_id
           WHERE gb.id = %s""",
        (group_buy_id,),
    ).fetchone()


def _insert_recharge_request(conn, *, user_id: int, channel: str, amount: float, points: int,
                             plan_id: int, team_id: int, ip: str) -> int:
    """创建拼团 recharge_requests（结构对齐 create_recharge_request，无随机折扣）。

    邀请快照等字段给默认空值（拼团不参与邀请返利）。不插入 point_transactions。
    """
    from datetime import datetime as _dt
    tx_no = f"GB{_dt.now().strftime('%Y%m%d%H%M%S')}{user_id}{secrets.token_hex(4).upper()}"
    cursor = conn.execute(
        """INSERT INTO recharge_requests
           (user_id, channel, amount, points, plan_id, group_buy_team_id, submit_ip,
            invite_code, inviter_user_id, invite_discount_percent_snapshot,
            invite_rebate_percent_snapshot, invite_bonus_points, invite_rebate_points,
            tx_no, status, risk_level, risk_flags, discount)
           VALUES (%s, %s, %s, %s, %s, %s, %s, '', NULL, 0, 0, 0, 0, %s, 'pending', 'low', '[]'::jsonb, 0)
           RETURNING id""",
        (user_id, channel, amount, points, plan_id, team_id, (ip or "")[:45], tx_no),
    )
    return cursor.fetchone()["id"]


def _find_joinable_team(conn, group_buy_id: int, group_size: int, user_id: int):
    """找该活动下可加入的团：status=0、未过期、remain_need>0、用户不在其中。"""
    return conn.execute(
        """SELECT t.id
           FROM group_buy_teams t
           WHERE t.group_buy_id = %s AND t.status = 0 AND t.expire_at > NOW()
             AND (SELECT COUNT(*) FROM group_buy_members m
                  WHERE m.team_id = t.id AND m.status = 'paid') < %s
             AND NOT EXISTS (SELECT 1 FROM group_buy_members m2
                             WHERE m2.team_id = t.id AND m2.user_id = %s)
           ORDER BY t.id ASC
           LIMIT 1
           FOR UPDATE OF t""",
        (group_buy_id, group_size, user_id),
    ).fetchone()


def list_active_group_buys(conn) -> list[dict]:
    """活动列表：status=1 且套餐 enabled 非 free；teams 为可拼团（未满、未过期）最多 3 个。"""
    rows = conn.execute(
        """SELECT gb.*, p.name AS package_name, p.price_rmb AS original_price, p.features
           FROM group_buys gb
           JOIN subscription_plans p ON p.id = gb.package_id
           WHERE gb.status = 1 AND p.enabled = TRUE AND COALESCE(p.is_free, FALSE) = FALSE
           ORDER BY gb.sort_order ASC, gb.id ASC""",
    ).fetchall()
    items = []
    for row in rows:
        gb = _build_group_buy_row(row)
        team_rows = conn.execute(
            """SELECT t.id,
                      (SELECT COUNT(*) FROM group_buy_members m
                       WHERE m.team_id = t.id AND m.status = 'paid') AS paid_count
               FROM group_buy_teams t
               WHERE t.group_buy_id = %s AND t.status = 0 AND t.expire_at > NOW()
               ORDER BY t.id ASC""",
            (gb["id"],),
        ).fetchall()
        teams = []
        for tr in team_rows:
            paid_count = int(tr["paid_count"] or 0)
            remain_need = gb["group_size"] - paid_count
            if remain_need > 0:
                teams.append({"id": tr["id"], "paid_count": paid_count, "remain_need": remain_need})
        teams.sort(key=lambda t: (t["remain_need"], t["id"]))
        gb["teams"] = teams[:3]
        gb["discount_text"] = _discount_text(gb["group_price"], gb["original_price"])
        items.append(gb)
    return items


def get_team_detail(conn, team_id: int, viewer_user_id: int | None = None) -> dict:
    """团详情（公开接口）；viewer_user_id 可空。真实成员 user_id 不下发（隐私）。"""
    row = conn.execute(
        """SELECT t.id AS team_id, t.group_buy_id, t.creator_user_id, t.status, t.expire_at,
                  gb.group_size, gb.group_price,
                  p.name AS package_name, p.price_rmb AS original_price, p.features
           FROM group_buy_teams t
           JOIN group_buys gb ON gb.id = t.group_buy_id
           JOIN subscription_plans p ON p.id = gb.package_id
           WHERE t.id = %s""",
        (team_id,),
    ).fetchone()
    if not row:
        raise ValueError("拼团不存在")
    team_status = _maybe_expire_team(conn, team_id, row["status"], row["expire_at"])
    members = conn.execute(
        """SELECT id, user_id, status, is_virtual, virtual_nickname, virtual_avatar, created_at
           FROM group_buy_members
           WHERE team_id = %s
           ORDER BY is_virtual ASC, created_at ASC, id ASC""",
        (team_id,),
    ).fetchall()
    member_list = []
    paid_count = 0
    my_paid = False
    my_member = False
    for m in members:
        item = dict(m)
        is_self = bool(viewer_user_id) and item.get("user_id") == viewer_user_id
        member_list.append({
            "id": item["id"],
            "status": item["status"],
            "is_virtual": bool(item.get("is_virtual")),
            "virtual_nickname": item.get("virtual_nickname") or "",
            "virtual_avatar": item.get("virtual_avatar") or "",
            "is_creator": bool(item.get("user_id")) and item.get("user_id") == row["creator_user_id"],
            "is_self": is_self,
        })
        if item.get("status") == "paid":
            paid_count += 1
        if is_self:
            my_member = True
            if item.get("status") == "paid":
                my_paid = True
    return {
        "id": row["team_id"],
        "group_buy_id": row["group_buy_id"],
        "status": team_status,
        "expire_at": _iso(row["expire_at"]),
        "paid_count": paid_count,
        "group_size": int(row["group_size"] or 0),
        "group_price": _float(row["group_price"]),
        "original_price": _float(row["original_price"]),
        "package_name": row["package_name"] or "",
        "package_type": (row["features"] or {}).get("package_type") or "",
        "my_paid": my_paid,
        "my_member": my_member,
        "members": member_list,
    }


def join_or_create_team(conn, user_id: int, group_buy_id: int, channel: str, ip: str) -> dict:
    """参团/开团并创建支付请求。

    优先加入该活动下未满、未过期、用户不在其中的团；否则开新团（预置虚拟成员）。
    返回 {team_id, request_id, amount, remaining_seconds, message}。
    """
    channel = (channel or "").strip().lower()
    if channel not in {"wechat", "alipay"}:
        raise ValueError("支持方式仅支持 wechat/alipay")
    gb_row = _get_group_buy_row(conn, group_buy_id)
    if not gb_row or int(gb_row["status"] or 0) != 1 or not gb_row["enabled"] or gb_row["is_free"]:
        raise ValueError("拼团活动不存在或已下线")
    gb = _build_group_buy_row(gb_row)

    # 该用户在本活动下已有待支付成员行 → 复用其 pending 请求（防重复下单）
    pending = conn.execute(
        """SELECT m.id AS member_id, m.team_id, m.recharge_request_id
           FROM group_buy_members m
           JOIN group_buy_teams t ON t.id = m.team_id
           LEFT JOIN recharge_requests r ON r.id = m.recharge_request_id
           WHERE m.user_id = %s AND t.group_buy_id = %s AND m.is_virtual = FALSE
             AND m.status = 'pending' AND r.status = 'pending'
           ORDER BY m.id ASC LIMIT 1""",
        (user_id, group_buy_id),
    ).fetchone()
    if pending:
        return {
            "team_id": pending["team_id"],
            "request_id": pending["recharge_request_id"],
            "amount": gb["group_price"],
            "remaining_seconds": _REMAINING_SECONDS,
            "message": "已有待支付拼团请求",
        }

    team_row = _find_joinable_team(conn, group_buy_id, gb["group_size"], user_id)
    if team_row:
        team_id = team_row["id"]
        is_creator = False
    else:
        # 开新团：expire_at = now + time_limit_min 分钟，预置虚拟成员（paid）
        expire_at = datetime.now() + timedelta(minutes=max(1, gb["time_limit_min"]))
        team_id = conn.execute(
            """INSERT INTO group_buy_teams (group_buy_id, creator_user_id, status, expire_at)
               VALUES (%s, %s, 0, %s) RETURNING id""",
            (group_buy_id, user_id, expire_at),
        ).fetchone()["id"]
        pool = _VIRTUAL_NICKNAME_POOL
        for i in range(max(0, gb["virtual_members"])):
            nickname = pool[(team_id + i) % len(pool)]
            conn.execute(
                """INSERT INTO group_buy_members
                   (team_id, user_id, status, is_virtual, virtual_nickname, virtual_avatar, paid_amount)
                   VALUES (%s, NULL, 'paid', TRUE, %s, '', %s)""",
                (team_id, nickname, gb["group_price"]),
            )
        is_creator = True

    request_id = _insert_recharge_request(
        conn, user_id=user_id, channel=channel, amount=gb["group_price"],
        points=gb["grant_points"], plan_id=gb["package_id"], team_id=team_id, ip=ip,
    )
    try:
        conn.execute(
            """INSERT INTO group_buy_members (team_id, user_id, status, recharge_request_id)
               VALUES (%s, %s, 'pending', %s)""",
            (team_id, user_id, request_id),
        )
    except UniqueViolation:
        # 并发下两人同时加入同一团撞 UNIQUE(team_id, user_id) → 提示重试
        raise ValueError("请勿重复参团，请刷新后重试")
    return {
        "team_id": team_id,
        "request_id": request_id,
        "amount": gb["group_price"],
        "remaining_seconds": _REMAINING_SECONDS,
        "message": "已创建，请扫码支付拼团款" if is_creator else "已加入拼团，请扫码支付",
    }


def upgrade_team(conn, user_id: int, team_id: int, channel: str, ip: str) -> dict:
    """过期团（status=2）成员补差价升级为单人购买。"""
    channel = (channel or "").strip().lower()
    if channel not in {"wechat", "alipay"}:
        raise ValueError("支持方式仅支持 wechat/alipay")
    row = conn.execute(
        """SELECT t.id AS team_id, t.status AS team_status, t.expire_at, gb.group_price,
                  p.id AS plan_id, p.price_rmb, p.grant_points
           FROM group_buy_teams t
           JOIN group_buys gb ON gb.id = t.group_buy_id
           JOIN subscription_plans p ON p.id = gb.package_id
           WHERE t.id = %s""",
        (team_id,),
    ).fetchone()
    if not row:
        raise ValueError("拼团不存在")
    team_status = _maybe_expire_team(conn, team_id, row["team_status"], row["expire_at"])
    if team_status != 2:
        raise ValueError("该团未过期，无需补差价升级")
    member = conn.execute(
        "SELECT id FROM group_buy_members WHERE team_id = %s AND user_id = %s AND status = 'paid'",
        (team_id, user_id),
    ).fetchone()
    if not member:
        raise ValueError("你不是该团已支付成员")
    activated = conn.execute(
        """SELECT id FROM recharge_requests
           WHERE user_id = %s AND group_buy_team_id = %s AND status = 'approved'
             AND plan_id IS NOT NULL LIMIT 1""",
        (user_id, team_id),
    ).fetchone()
    if activated:
        raise ValueError("你已通过该团激活过套餐")
    pending = conn.execute(
        """SELECT id, amount FROM recharge_requests
           WHERE user_id = %s AND group_buy_team_id = %s AND status = 'pending'
           ORDER BY id ASC LIMIT 1""",
        (user_id, team_id),
    ).fetchone()
    if pending:
        return {
            "team_id": team_id,
            "request_id": pending["id"],
            "amount": _float(pending["amount"]),
            "remaining_seconds": _REMAINING_SECONDS,
            "message": "已有待支付升级请求",
        }
    diff = round(_float(row["price_rmb"]) - _float(row["group_price"]), 2)
    if diff <= 0:
        raise ValueError("当前无需补差价")
    request_id = _insert_recharge_request(
        conn, user_id=user_id, channel=channel, amount=diff,
        points=int(row["grant_points"] or 0), plan_id=row["plan_id"], team_id=team_id, ip=ip,
    )
    return {
        "team_id": team_id,
        "request_id": request_id,
        "amount": diff,
        "remaining_seconds": _REMAINING_SECONDS,
        "message": "已创建补差价订单，请扫码支付",
    }


def on_payment_success(conn, request: dict) -> str | None:
    """支付到账处理（recharge_requests 行 dict）。返回状态串或 None（非拼团/异常走原逻辑）。

    - team.status=0 拼团中：member 置 paid；达标则锁 team 成团并逐个激活真实 paid 成员
    - team.status=2 已过期：升级单，直接激活该用户套餐
    - 幂等：member 已 paid / 已 approved 升级单 → "group_buy_duplicate"
    """
    team_id = request.get("group_buy_team_id")
    if not team_id:
        return None
    team_row = conn.execute(
        """SELECT t.id AS team_id, t.status AS team_status, t.group_buy_id, t.expire_at,
                  gb.package_id, gb.group_size, gb.group_price,
                  p.id AS plan_id, p.name AS plan_name, p.features, p.grant_points,
                  p.cycle_days, p.price_rmb
           FROM group_buy_teams t
           JOIN group_buys gb ON gb.id = t.group_buy_id
           JOIN subscription_plans p ON p.id = gb.package_id
           WHERE t.id = %s""",
        (team_id,),
    ).fetchone()
    if not team_row:
        return None
    user_id = request.get("user_id")
    team_status = _maybe_expire_team(conn, team_id, team_row["team_status"], team_row["expire_at"])

    # ---------- 升级单（团已过期） ----------
    if team_status == 2:
        # 锁 team 行串行化并发回调/审核；锁内重查幂等标记，避免双激活
        locked_team = conn.execute(
            "SELECT status FROM group_buy_teams WHERE id = %s FOR UPDATE", (team_id,)
        ).fetchone()
        if not locked_team:
            return None
        # 幂等：该用户已因本团激活过（存在 approved 单）
        approved = conn.execute(
            """SELECT id FROM recharge_requests
               WHERE user_id = %s AND group_buy_team_id = %s AND status = 'approved'
                 AND plan_id IS NOT NULL LIMIT 1""",
            (user_id, team_id),
        ).fetchone()
        if approved:
            return "group_buy_duplicate"
        plan = get_plan_in_conn(conn, team_row["plan_id"])
        if not plan:
            return None
        activate_plan_in_conn(conn, user_id, plan, order_id=team_id)
        return "group_buy_upgrade_activated"

    # ---------- 拼团单（status 0 拼团中 / 1 已成团） ----------
    member = _find_member(conn, team_id, user_id, request.get("id"))
    if not member:
        return None
    if member["status"] == "paid":
        return "group_buy_duplicate"
    # 锁 team 行串行化同团并发回调；锁内重查 member 防并发窗口
    locked = conn.execute(
        "SELECT status FROM group_buy_teams WHERE id = %s FOR UPDATE", (team_id,)
    ).fetchone()
    if not locked:
        return None
    member = _find_member(conn, team_id, user_id, request.get("id"))
    if not member:
        return None
    if member["status"] == "paid":
        return "group_buy_duplicate"
    conn.execute(
        """UPDATE group_buy_members
           SET status = 'paid', paid_amount = %s,
               recharge_request_id = COALESCE(%s, recharge_request_id)
           WHERE id = %s""",
        (request.get("amount") or 0, request.get("id"), member["id"]),
    )
    paid_count = int(conn.execute(
        "SELECT COUNT(*) AS cnt FROM group_buy_members WHERE team_id = %s AND status = 'paid'",
        (team_id,),
    ).fetchone()["cnt"] or 0)
    if paid_count < int(team_row["group_size"] or 0):
        return "group_buy_pending"
    plan = get_plan_in_conn(conn, team_row["plan_id"])
    if not plan:
        return None
    if int(locked["status"] or 0) == 0:
        # 成团：置 status=1，逐个激活所有真实 paid 成员（每个恰好一次，因锁内查询）
        conn.execute("UPDATE group_buy_teams SET status = 1 WHERE id = %s", (team_id,))
        paid_members = conn.execute(
            """SELECT user_id FROM group_buy_members
               WHERE team_id = %s AND status = 'paid' AND user_id IS NOT NULL
               ORDER BY id ASC""",
            (team_id,),
        ).fetchall()
        for m in paid_members:
            activate_plan_in_conn(conn, m["user_id"], plan, order_id=team_id)
    else:
        # 已成团后迟到的支付（并发尾单）：本成员尚未激活，补激活本人
        if member["user_id"]:
            activate_plan_in_conn(conn, member["user_id"], plan, order_id=team_id)
    return "group_buy_completed"


def _find_member(conn, team_id: int, user_id: int | None, request_id: int | None):
    """按 recharge_request_id 优先、其次 user_id 找本团成员行。"""
    return conn.execute(
        """SELECT id, user_id, status FROM group_buy_members
           WHERE team_id = %s
             AND (recharge_request_id = %s OR (user_id = %s AND user_id IS NOT NULL))
           ORDER BY (recharge_request_id = %s) DESC, id ASC
           LIMIT 1""",
        (team_id, request_id, user_id, request_id),
    ).fetchone()
