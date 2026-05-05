import string
import secrets
import smtplib
import asyncio
import logging
from email.mime.text import MIMEText
from email.header import Header
from email.utils import formataddr
from fastapi import HTTPException
from backend.config import get_smtp_config
from backend.db.session import get_db
logger = logging.getLogger(__name__)


VERIFICATION_EMAIL_HTML = """\
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Atelier·AI造梦工坊 邮箱验证</title></head>
<body style="margin:0;padding:0;background-color:#F9FBF8;font-family:Arial,sans-serif;">
<div style="width:90%;max-width:600px;margin:20px auto;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(176,209,187,0.15);">
  <div style="background-color:#B0D1BB;color:#FFFFFF;padding:24px 20px;">
    <h1 style="margin:0;font-size:26px;font-weight:600;">Atelier<span style="font-size:16px;margin-left:8px;opacity:0.9;">AI 造梦工坊</span></h1>
    <p style="margin:6px 0 0;font-size:13px;opacity:0.8;">开启你的AI创作之旅 · 一键生图</p>
  </div>
  <div style="padding:35px 30px;color:#5A7063;">
    <p style="font-size:16px;line-height:1.7;">你好，<span style="color:#8CB39E;font-weight:500;">{email}</span>：</p>
    <p style="font-size:16px;line-height:1.7;margin:16px 0;">感谢使用 <strong style="color:#7AA88F;">Atelier·AI造梦工坊</strong>，你的验证码为：</p>
    <div style="background-color:#F2F7F4;padding:20px 24px;border-radius:10px;text-align:center;margin:20px 0;border:1px dashed #B0D1BB;">
      <strong style="font-size:32px;color:#4A7A5C;letter-spacing:6px;font-family:'Courier New',Courier,monospace;user-select:all;-webkit-user-select:all;">{code}</strong>
      <p style="margin:8px 0 0;font-size:12px;color:#999;">长按或双击验证码即可选中复制</p>
    </div>
    <p style="font-size:15px;line-height:1.7;color:#708579;">该验证码用于账号身份验证，3分钟内有效<br>请勿泄露或转发给他人，如非本人操作请忽略本邮件</p>
    <p style="font-size:16px;line-height:1.7;margin-top:30px;text-align:right;color:#8CB39E;">Atelier · AI 造梦工坊</p>
  </div>
</div>
</body>
</html>"""


def generate_verification_code():
    pool = string.ascii_letters + string.digits
    return ''.join(secrets.choice(pool) for _ in range(6))


def _send_email_sync(to_email, code):
    cfg = get_smtp_config()
    if not cfg["sender"] or not cfg["password"]:
        raise HTTPException(status_code=500, detail="SMTP 未配置，请联系管理员")

    html = VERIFICATION_EMAIL_HTML.format(email=to_email, code=code)
    msg = MIMEText(html, "html", "utf-8")
    msg["Subject"] = "Atelier·AI造梦工坊 邮箱验证码"
    sender_name = cfg.get('sender_name', '')
    if sender_name:
        msg["From"] = formataddr((str(Header(sender_name, 'utf-8')), cfg['sender']))
    else:
        msg["From"] = cfg['sender']
    msg["To"] = to_email

    try:
        with smtplib.SMTP_SSL(cfg["server"], cfg["port"], timeout=30) as server:
            server.login(cfg["sender"], cfg["password"])
            server.sendmail(cfg["sender"], to_email, msg.as_string())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"邮件发送失败：{e}")


async def send_verification_email(to_email, code):
    await asyncio.to_thread(_send_email_sync, to_email, code)


async def create_and_send_code(email, ip):
    email = email.strip().lower()
    with get_db() as conn:
        row = conn.execute(
            "SELECT EXTRACT(EPOCH FROM NOW() - created_at)::int AS age_seconds FROM email_verification_codes WHERE email = %s ORDER BY id DESC LIMIT 1",
            (email,),
        ).fetchone()
        if row and row["age_seconds"] is not None:
            age = int(row["age_seconds"])
            if age < 60:
                raise HTTPException(status_code=429, detail=f"请等待 {60 - age} 秒后再试")

        code = generate_verification_code()
        conn.execute(
            """INSERT INTO email_verification_codes (email, code, expires_at, ip)
               VALUES (%s, %s, NOW() + INTERVAL '3 minutes', %s)""",
            (email, code, ip),
        )
    asyncio.create_task(_send_code_background(email, code))


async def _send_code_background(email, code):
    try:
        await send_verification_email(email, code)
    except Exception as e:
        logger.exception("send verification email failed for %s: %s", email, e)


def verify_code(email, code):
    email = email.strip().lower()
    code_upper = code.strip().upper()
    with get_db() as conn:
        row = conn.execute(
            """SELECT id FROM email_verification_codes
               WHERE email = %s AND UPPER(code) = %s AND used = FALSE AND expires_at > NOW()
               ORDER BY id DESC LIMIT 1""",
            (email, code_upper),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="验证码无效或已过期")
        conn.execute("UPDATE email_verification_codes SET used = TRUE WHERE id = %s", (row["id"],))


def mark_registered(email):
    email = email.strip().lower()
    with get_db() as conn:
        conn.execute(
            """UPDATE email_verification_codes SET registered = TRUE
               WHERE email = %s AND used = TRUE AND registered = FALSE""",
            (email,),
        )
