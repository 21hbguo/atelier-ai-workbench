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
