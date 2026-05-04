import string
import secrets
import smtplib
import asyncio
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from fastapi import HTTPException
from backend.config import get_smtp_config
from backend.db.session import get_db


def generate_verification_code():
    pool = string.ascii_letters + string.digits
    return ''.join(secrets.choice(pool) for _ in range(6))


def _send_email_sync(to_email, code):
    cfg = get_smtp_config()
    if not cfg["host"] or not cfg["sender"]:
        raise HTTPException(status_code=500, detail="SMTP 未配置，请联系管理员")

    msg = MIMEMultipart()
    msg["From"] = cfg["sender"]
    msg["To"] = to_email
    msg["Subject"] = "邮箱验证码"
    msg.attach(MIMEText(f"您的验证码是：{code}\n验证码 3 分钟内有效，请勿泄露给他人。", "plain", "utf-8"))

    port = cfg["port"]
    try:
        if port == 465:
            server = smtplib.SMTP_SSL(cfg["host"], port, timeout=10)
        else:
            server = smtplib.SMTP(cfg["host"], port, timeout=10)
            server.starttls()
        server.login(cfg["username"], cfg["password"])
        server.sendmail(cfg["sender"], to_email, msg.as_string())
        server.quit()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"邮件发送失败：{e}")


async def send_verification_email(to_email, code):
    await asyncio.to_thread(_send_email_sync, to_email, code)


def create_and_send_code(email, ip):
    email = email.strip().lower()
    with get_db() as conn:
        row = conn.execute(
            "SELECT created_at FROM email_verification_codes WHERE email = %s ORDER BY id DESC LIMIT 1",
            (email,),
        ).fetchone()
        if row:
            from datetime import datetime
            created = row["created_at"]
            if isinstance(created, str):
                created = datetime.fromisoformat(created)
            now = datetime.utcnow()
            if hasattr(now, 'timestamp') and hasattr(created, 'timestamp'):
                diff = (now - created).total_seconds()
                if diff < 60:
                    wait = int(60 - diff)
                    raise HTTPException(status_code=429, detail=f"请等待 {wait} 秒后再试")

        code = generate_verification_code()
        conn.execute(
            """INSERT INTO email_verification_codes (email, code, expires_at, ip)
               VALUES (%s, %s, NOW() + INTERVAL '3 minutes', %s)""",
            (email, code, ip),
        )

    asyncio.get_event_loop().create_task(send_verification_email(email, code))


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
