import asyncio
import time
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException

import backend.services.email_service as es


def _cfg(sg_key="SG.testkey123456"):
    return {
        "smtp_server": "smtp.qq.com",
        "smtp_port": 465,
        "smtp_password": "x",
        "smtp_sender": "a@qq.com",
        "smtp_sender_name": "n",
        "sendgrid_api_key": sg_key,
        "sendgrid_sender": "noreply@x.me",
    }


@pytest.fixture(autouse=True)
def _reset_circuit():
    es._sendgrid_open_until = 0.0
    es._sendgrid_key_fp = ""
    yield
    es._sendgrid_open_until = 0.0
    es._sendgrid_key_fp = ""


def test_sendgrid_failure_falls_back_to_smtp_and_opens_circuit():
    sg = AsyncMock(side_effect=HTTPException(500, "SendGrid 发送失败：Maximum credits exceeded"))
    smtp = Mock(return_value=None)
    with patch.object(es, "get_email_delivery_config", return_value=_cfg()), \
         patch.object(es, "_send_via_sendgrid", new=sg), \
         patch.object(es, "_send_email_sync", new=smtp):
        asyncio.run(es.send_verification_email("a@b.com", "123456"))
    sg.assert_awaited_once()
    smtp.assert_called_once()
    assert es._sendgrid_open_until > time.monotonic()
    assert es._sendgrid_key_fp == "SG.testkey123456"


def test_circuit_open_skips_sendgrid():
    es._sendgrid_open_until = time.monotonic() + 300
    es._sendgrid_key_fp = "SG.testkey123456"
    sg = AsyncMock()
    smtp = Mock(return_value=None)
    with patch.object(es, "get_email_delivery_config", return_value=_cfg()), \
         patch.object(es, "_send_via_sendgrid", new=sg), \
         patch.object(es, "_send_email_sync", new=smtp):
        asyncio.run(es.send_verification_email("a@b.com", "123456"))
    sg.assert_not_awaited()
    smtp.assert_called_once()


def test_circuit_expired_retries_sendgrid():
    es._sendgrid_open_until = time.monotonic() - 1  # 已过冷却期
    es._sendgrid_key_fp = "SG.testkey123456"
    sg = AsyncMock(return_value=None)
    smtp = Mock()
    with patch.object(es, "get_email_delivery_config", return_value=_cfg()), \
         patch.object(es, "_send_via_sendgrid", new=sg), \
         patch.object(es, "_send_email_sync", new=smtp):
        asyncio.run(es.send_verification_email("a@b.com", "123456"))
    sg.assert_awaited_once()
    smtp.assert_not_called()


def test_key_change_resets_circuit():
    es._sendgrid_open_until = time.monotonic() + 300  # 熔断中
    es._sendgrid_key_fp = "SG.oldkey0000000"          # 但 key 已换成新的
    sg = AsyncMock(return_value=None)
    smtp = Mock()
    with patch.object(es, "get_email_delivery_config", return_value=_cfg("SG.newkey1234567")), \
         patch.object(es, "_send_via_sendgrid", new=sg), \
         patch.object(es, "_send_email_sync", new=smtp):
        asyncio.run(es.send_verification_email("a@b.com", "123456"))
    sg.assert_awaited_once()          # 新 key 不再受旧熔断影响
    smtp.assert_not_called()
    assert es._sendgrid_open_until == 0.0
    assert es._sendgrid_key_fp == "SG.newkey1234567"


def test_no_sendgrid_key_goes_straight_to_smtp():
    sg = AsyncMock()
    smtp = Mock(return_value=None)
    with patch.object(es, "get_email_delivery_config", return_value=_cfg("")), \
         patch.object(es, "_send_via_sendgrid", new=sg), \
         patch.object(es, "_send_email_sync", new=smtp):
        asyncio.run(es.send_verification_email("a@b.com", "123456"))
    sg.assert_not_awaited()
    smtp.assert_called_once()


def _cfg_resend(sg_key="SG.testkey123456", re_key="re_testkey1234"):
    cfg = _cfg(sg_key=sg_key)
    cfg["resend_api_key"] = re_key
    cfg["resend_sender"] = "onboarding@resend.dev"
    return cfg


def test_resend_used_when_sendgrid_fails():
    """SendGrid 失败（熔断）后走 Resend，成功则不再降级 SMTP。"""
    es._sendgrid_open_until = 0.0
    es._sendgrid_key_fp = ""
    sg = AsyncMock(side_effect=HTTPException(500, "SendGrid 发送失败：x"))
    rs = AsyncMock(return_value={"id": "em_123"})
    smtp = Mock(return_value=None)
    with patch.object(es, "get_email_delivery_config", return_value=_cfg_resend()), \
         patch.object(es, "_send_via_sendgrid", new=sg), \
         patch.object(es, "_send_via_resend", new=rs), \
         patch.object(es, "_send_email_sync", new=smtp):
        asyncio.run(es.send_verification_email("a@b.com", "123456"))
    sg.assert_awaited_once()
    rs.assert_awaited_once()
    smtp.assert_not_called()
    assert es._sendgrid_open_until > time.monotonic()  # sendgrid 已熔断


def test_resend_success_without_sendgrid():
    """未配置 SendGrid 时直接走 Resend，成功则不降级 SMTP。"""
    es._sendgrid_open_until = 0.0
    es._sendgrid_key_fp = ""
    rs = AsyncMock(return_value={"id": "em_456"})
    smtp = Mock(return_value=None)
    with patch.object(es, "get_email_delivery_config", return_value=_cfg_resend(sg_key="")), \
         patch.object(es, "_send_via_resend", new=rs), \
         patch.object(es, "_send_email_sync", new=smtp):
        asyncio.run(es.send_verification_email("a@b.com", "123456"))
    rs.assert_awaited_once()
    smtp.assert_not_called()


def test_resend_failure_falls_back_to_smtp():
    """SendGrid 与 Resend 都失败时降级 SMTP，错误信息合并。"""
    es._sendgrid_open_until = 0.0
    es._sendgrid_key_fp = ""
    sg = AsyncMock(side_effect=HTTPException(500, "SendGrid 发送失败：credits"))
    rs = AsyncMock(side_effect=HTTPException(500, "Resend 发送失败：rate limit"))
    smtp = Mock(side_effect=HTTPException(500, "邮件发送失败：smtp down"))
    with patch.object(es, "get_email_delivery_config", return_value=_cfg_resend()), \
         patch.object(es, "_send_via_sendgrid", new=sg), \
         patch.object(es, "_send_via_resend", new=rs), \
         patch.object(es, "_send_email_sync", new=smtp):
        try:
            asyncio.run(es.send_verification_email("a@b.com", "123456"))
        except HTTPException as e:
            assert "SendGrid" in e.detail and "Resend" in e.detail and "SMTP" in e.detail
        else:
            raise AssertionError("expected HTTPException")


def test_resend_unconfigured_skipped():
    """未配置 resend_api_key 时跳过 Resend 路径，直接 SMTP。"""
    es._sendgrid_open_until = 0.0
    es._sendgrid_key_fp = ""
    sg = AsyncMock(side_effect=HTTPException(500, "SendGrid 发送失败：x"))
    rs = AsyncMock()
    smtp = Mock(return_value=None)
    with patch.object(es, "get_email_delivery_config", return_value=_cfg()), \
         patch.object(es, "_send_via_sendgrid", new=sg), \
         patch.object(es, "_send_via_resend", new=rs), \
         patch.object(es, "_send_email_sync", new=smtp):
        asyncio.run(es.send_verification_email("a@b.com", "123456"))
    rs.assert_not_awaited()
    smtp.assert_called_once()
