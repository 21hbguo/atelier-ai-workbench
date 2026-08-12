import string
import secrets
import smtplib
import asyncio
import logging
import socket
import time
import httpx
from email.mime.text import MIMEText
from email.header import Header
from email.utils import formataddr
from fastapi import HTTPException
from backend.config import get_smtp_config, get_email_delivery_config
from backend.db.session import get_db
logger = logging.getLogger(__name__)


class IPv4SMTP_SSL(smtplib.SMTP_SSL):
    def _get_socket(self, host, port, timeout):
        last_error = None
        for family, socktype, proto, _, sockaddr in socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM):
            sock = None
            try:
                sock = socket.socket(family, socktype, proto)
                if timeout is not None:
                    sock.settimeout(timeout)
                sock.connect(sockaddr)
                if self.context and host:
                    return self.context.wrap_socket(sock, server_hostname=host)
                return sock
            except OSError as e:
                last_error = e
                if sock:
                    try:
                        sock.close()
                    except Exception:
                        pass
        if last_error:
            raise last_error
        raise OSError(f"无法解析 IPv4 地址: {host}")


VERIFICATION_EMAIL_HTML = """\
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Atelier · AI 工作台 邮箱验证</title></head>
<body style="margin:0;padding:0;background-color:#F9FBF8;font-family:Arial,sans-serif;">
<div style="width:90%;max-width:600px;margin:20px auto;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(176,209,187,0.15);">
  <div style="background-color:#B0D1BB;color:#FFFFFF;padding:24px 20px;">
    <h1 style="margin:0;font-size:26px;font-weight:600;">Atelier<span style="font-size:16px;margin-left:8px;opacity:0.9;">AI 工作台</span></h1>
    <p style="margin:6px 0 0;font-size:13px;opacity:0.8;">多模型聚合 · 多模态创作 · 安全私密</p>
  </div>
  <div style="padding:35px 30px;color:#5A7063;">
    <p style="font-size:16px;line-height:1.7;">你好，<span style="color:#8CB39E;font-weight:500;">{email}</span>：</p>
    <p style="font-size:16px;line-height:1.7;margin:16px 0;">感谢使用 <strong style="color:#7AA88F;">Atelier · AI 工作台</strong>，你的验证码为：</p>
    <div style="background-color:#F2F7F4;padding:20px 24px;border-radius:10px;text-align:center;margin:20px 0;border:1px dashed #B0D1BB;">
      <strong style="font-size:32px;color:#4A7A5C;letter-spacing:6px;font-family:'Courier New',Courier,monospace;user-select:all;-webkit-user-select:all;">{code}</strong>
      <p style="margin:8px 0 0;font-size:12px;color:#999;">长按或双击验证码即可选中复制</p>
    </div>
    <p style="font-size:15px;line-height:1.7;color:#708579;">该验证码用于账号身份验证，3分钟内有效<br>请勿泄露或转发给他人，如非本人操作请忽略本邮件</p>
    <p style="font-size:16px;line-height:1.7;margin-top:30px;text-align:right;color:#8CB39E;">Atelier · AI 工作台</p>
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
    msg["Subject"] = "Atelier · AI 工作台 邮箱验证码"
    sender_name = cfg.get('sender_name', '')
    if sender_name:
        msg["From"] = formataddr((str(Header(sender_name, 'utf-8')), cfg['sender']))
    else:
        msg["From"] = cfg['sender']
    msg["To"] = to_email

    try:
        with IPv4SMTP_SSL(cfg["server"], cfg["port"], timeout=30) as server:
            server.login(cfg["sender"], cfg["password"])
            server.sendmail(cfg["sender"], to_email, msg.as_string())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"邮件发送失败：{e}")


def _build_email_html(to_email, code):
    return VERIFICATION_EMAIL_HTML.format(email=to_email, code=code)


def _build_email_subject():
    return "Atelier · AI 工作台 邮箱验证码"


# ---- SendGrid 熔断（circuit breaker）----
# SendGrid 失败（额度耗尽/网络故障等）后短期内直接走 SMTP，避免每次发信都白等超时。
# 冷却期结束后自动重试 SendGrid；API key 变更时自动重置熔断。
_SENDGRID_COOLDOWN_SECONDS = 300
_sendgrid_open_until = 0.0        # time.monotonic() 截止时间；0 = 未熔断
_sendgrid_key_fp = ""            # 触发熔断时的 key 指纹（前 16 字符）


def _key_fingerprint(key: str) -> str:
    return (key or "")[:16]


def _sendgrid_circuit_open(cfg) -> bool:
    global _sendgrid_open_until, _sendgrid_key_fp
    key = (cfg.get("sendgrid_api_key") or "").strip()
    if not key:
        return False
    fp = _key_fingerprint(key)
    if fp != _sendgrid_key_fp:
        # key 变了（管理后台更换配置），重置熔断并允许重试新 key
        _sendgrid_key_fp = fp
        _sendgrid_open_until = 0.0
        return False
    return time.monotonic() < _sendgrid_open_until


def _trip_sendgrid_circuit(cfg):
    global _sendgrid_open_until, _sendgrid_key_fp
    _sendgrid_key_fp = _key_fingerprint((cfg.get("sendgrid_api_key") or "").strip())
    _sendgrid_open_until = time.monotonic() + _SENDGRID_COOLDOWN_SECONDS
    logger.warning(
        "sendgrid circuit opened: skip sendgrid for next %ss",
        _SENDGRID_COOLDOWN_SECONDS,
    )


async def _send_via_sendgrid(to_email, code, cfg):
    api_key=(cfg.get("sendgrid_api_key") or "").strip()
    sender=(cfg.get("sendgrid_sender") or cfg.get("smtp_sender") or "").strip()
    if not api_key or not sender:
        raise HTTPException(status_code=500, detail="SendGrid 未配置，请联系管理员")
    sender_name=(cfg.get("smtp_sender_name") or "Atelier · AI 工作台").strip()
    payload={"personalizations":[{"to":[{"email":to_email}]}],"from":{"email":sender,"name":sender_name},"subject":_build_email_subject(),"content":[{"type":"text/html","value":_build_email_html(to_email,code)}]}
    headers={"Authorization":f"Bearer {api_key}","Content-Type":"application/json"}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp=await client.post("https://api.sendgrid.com/v3/mail/send",headers=headers,json=payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SendGrid 发送失败：{e}")
    if resp.status_code >= 400:
        detail=resp.text[:300] if resp.text else f"HTTP {resp.status_code}"
        raise HTTPException(status_code=500, detail=f"SendGrid 发送失败：{detail}")


async def _send_via_resend(to_email, code, cfg):
    """Resend 发送路径（resend SDK，同步调用放线程池）。"""
    api_key=(cfg.get("resend_api_key") or "").strip()
    sender=(cfg.get("resend_sender") or "onboarding@resend.dev").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="Resend 未配置，请联系管理员")
    try:
        import resend
    except ImportError:
        raise HTTPException(status_code=500, detail="Resend SDK 未安装（pip install resend）")

    def _do():
        resend.api_key = api_key
        return resend.Emails.send({
            "from": sender,
            "to": [to_email],
            "subject": _build_email_subject(),
            "html": _build_email_html(to_email, code),
        })

    try:
        await asyncio.to_thread(_do)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Resend 发送失败：{e}")


async def send_verification_email(to_email, code):
    cfg=get_email_delivery_config()
    resend_error=None
    sendgrid_error=None
    # Resend 最优先（已验证可用；沙箱发件人上线前需绑定域名）
    if (cfg.get("resend_api_key") or "").strip():
        try:
            await _send_via_resend(to_email, code, cfg)
            return
        except HTTPException as e:
            resend_error=e.detail
            logger.warning("resend send failed for %s: %s", to_email, resend_error)
    if (cfg.get("sendgrid_api_key") or "").strip() and not _sendgrid_circuit_open(cfg):
        try:
            await _send_via_sendgrid(to_email, code, cfg)
            return
        except HTTPException as e:
            sendgrid_error=e.detail
            _trip_sendgrid_circuit(cfg)
            logger.warning("sendgrid send failed for %s: %s", to_email, sendgrid_error)
    try:
        await asyncio.to_thread(_send_email_sync, to_email, code)
    except HTTPException as e:
        if resend_error or sendgrid_error:
            parts=[]
            if resend_error:
                parts.append(resend_error)
            if sendgrid_error:
                parts.append(sendgrid_error)
            parts.append(f"SMTP 发送失败：{e.detail.replace('邮件发送失败：','')}")
            raise HTTPException(status_code=500, detail="；".join(parts))
        raise


async def create_and_send_code(email, ip):
    email = email.strip().lower()
    code_id = None
    code = ""
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
        row = conn.execute(
            """INSERT INTO email_verification_codes (email, code, expires_at, ip)
               VALUES (%s, %s, NOW() + INTERVAL '3 minutes', %s) RETURNING id""",
            (email, code, ip),
        ).fetchone()
        code_id = row["id"] if row else None
    try:
        await send_verification_email(email, code)
    except Exception:
        if code_id is not None:
            with get_db() as conn:
                conn.execute("DELETE FROM email_verification_codes WHERE id = %s", (code_id,))
        raise


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
