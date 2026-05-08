import hashlib
import logging
import secrets
from datetime import datetime

from fastapi import APIRouter, Form, HTTPException, Request

from backend.config import get_config
from backend.database import get_db
from backend.services.invite_service import InviteService
from backend.services.notification_service import NotificationService
from backend.services.points_service import PointsService

router = APIRouter(prefix="/api/vmq", tags=["vmq"])
logger = logging.getLogger(__name__)


def _md5(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest()


@router.post("/notify")
async def vmq_notify(
    request: Request,
    trade_no: str = Form(...),
    type: str = Form(...),
    money: str = Form(...),
    trade_status: str = Form(...),
    sign: str = Form(...),
):
    secret = get_config().get("vmq_notify_secret") or ""
    if not secret:
        logger.warning("[vmq.notify] vmq_notify_secret 未配置")
        raise HTTPException(status_code=500, detail="回调密钥未配置")

    expected = _md5(trade_no + type + money + secret)
    if sign != expected:
        logger.warning(f"[vmq.notify] 签名验证失败 trade_no={trade_no}")
        raise HTTPException(status_code=403, detail="签名错误")

    if trade_status != "TRADE_SUCCESS":
        return {"status": "ignored", "reason": "非成功交易"}

    channel = "wechat" if type == "wxpay" else "alipay"
    amount = float(money)

    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM point_transactions WHERE request_key = %s",
            (f"vmq-notify:{trade_no}",),
        ).fetchone()
        if existing:
            return {"status": "ok", "reason": "已处理过"}

        row = conn.execute(
            "SELECT * FROM recharge_requests WHERE channel = %s AND amount = %s AND status = 'pending' ORDER BY created_at ASC LIMIT 1",
            (channel, amount),
        ).fetchone()

        if not row:
            logger.warning(f"[vmq.notify] 未找到匹配的充值请求 channel={channel} amount={amount} trade_no={trade_no}")
            return {"status": "ok", "reason": "未找到匹配的充值请求"}

        item = dict(row)
        request_id = item["id"]
        user_id = item["user_id"]
        base_points = int(item["points"])
        bonus_points = int(item.get("invite_bonus_points") or 0)
        points = base_points + bonus_points

        while True:
            code = secrets.token_urlsafe(8).upper()
            if not conn.execute("SELECT id FROM redemption_codes WHERE code = %s", (code,)).fetchone():
                break

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "INSERT INTO redemption_codes (code, points, recharge_request_id) VALUES (%s, %s, %s)",
            (code, points, request_id),
        )
        code_id = conn.execute("SELECT id FROM redemption_codes WHERE code = %s", (code,)).fetchone()["id"]
        conn.execute(
            "UPDATE redemption_codes SET is_used = true, used_by = %s, used_at = %s WHERE id = %s",
            (user_id, now, code_id),
        )
        PointsService.add_points(
            user_id, points, "redeem_code", f"VMQ自动审核 (¥{amount})",
            conn=conn, request_key=f"vmq-notify:{trade_no}", recharge_request_id=request_id,
        )
        conn.execute(
            "UPDATE recharge_requests SET status = 'approved', points = %s, redeem_code = %s, review_note = %s, reviewed_at = %s WHERE id = %s",
            (points, code, f"VMQ自动审核 trade_no={trade_no}", now, request_id),
        )
        invite_result = InviteService.apply_recharge_rewards(conn, {**item, "points": base_points}, item.get("submit_ip") or "")

    try:
        NotificationService.create(user_id, "recharge_approved", "充值成功", f"你的 ¥{amount} 充值已自动到账，获得 {points} 积分", str(request_id))
        if item.get("inviter_user_id") and invite_result.get("rebate_points", 0) > 0:
            NotificationService.create(item["inviter_user_id"], "invite_recharge_rebate", "邀请返利到账", f"你收到 {invite_result['rebate_points']} 积分返利", str(request_id))
    except Exception:
        pass

    logger.info(f"[vmq.notify] 自动审核通过 request={request_id} user={user_id} points={points} amount={amount} trade_no={trade_no}")
    return {"status": "ok"}
