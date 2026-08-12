"""mineru_client 模块单元测试（pytest + asyncio.run，不依赖数据库/网络）。

所有网络调用（_request_file_token/_upload_file/_poll_task/_download_markdown）
均被 patch，零真实请求；测试风格参照 backend/tests/test_url_fetcher.py。
"""
import asyncio
import os
from unittest.mock import AsyncMock, patch

import pytest

import backend.services.mineru_client as mineru_client
from backend.services.mineru_client import _ParseTimeout


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------- is_configured

def test_is_configured_true_when_key_set():
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True):
        assert mineru_client.is_configured() is True


def test_is_configured_false_without_key():
    with patch.dict(os.environ, {}, clear=True):
        assert mineru_client.is_configured() is False
    with patch.dict(os.environ, {"MINERU_API_KEY": "  "}, clear=True):
        assert mineru_client.is_configured() is False


# ---------------------------------------------------------------- 全流程成功

def test_parse_file_full_flow_success():
    """token → 上传 → 轮询 done → markdown 下载 → ok=True。"""
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client, "_request_file_token",
                      new=AsyncMock(return_value=("task-1", "https://oss.example.com/up"))) as m_token, \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()) as m_upload, \
         patch.object(mineru_client, "_poll_task",
                      new=AsyncMock(return_value={"state": "done", "markdown_url": "https://cdn.example.com/full.md"})) as m_poll, \
         patch.object(mineru_client, "_download_markdown",
                      new=AsyncMock(return_value="# 标题\n正文内容")) as m_dl, \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result == {"ok": True, "text": "# 标题\n正文内容"}
    m_token.assert_awaited_once()
    m_upload.assert_awaited_once()
    m_poll.assert_awaited_once()
    m_dl.assert_awaited_once()


def test_parse_file_passes_ocr_and_language():
    """is_ocr/language 透传给 _request_file_token。"""
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client, "_request_file_token",
                      new=AsyncMock(return_value=("t", "https://oss.example.com/u"))) as m_token, \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()), \
         patch.object(mineru_client, "_poll_task",
                      new=AsyncMock(return_value={"state": "done", "markdown_url": "https://cdn.example.com/full.md"})), \
         patch.object(mineru_client, "_download_markdown", new=AsyncMock(return_value="x")), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024):
        _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf", is_ocr=True, language="ch"))
    m_token.assert_awaited_once_with(m_token.await_args.args[0], "x.pdf", True, "ch")


# ---------------------------------------------------------------- _poll_task 直测

class _FakeClient:
    """按序列返回轮询响应；耗尽后复用最后一个。"""

    def __init__(self, responses):
        self.responses = responses
        self.calls = 0

    async def get(self, url, **kwargs):
        idx = min(self.calls, len(self.responses) - 1)
        self.calls += 1
        return _FakeResp(self.responses[idx])


class _FakeResp:
    def __init__(self, body):
        self._body = body

    @property
    def status_code(self):
        return 200

    def json(self):
        return self._body


def test_poll_task_polls_until_done():
    client = _FakeClient([
        {"code": 0, "data": {"state": "pending"}},
        {"code": 0, "data": {"state": "running"}},
        {"code": 0, "data": {"state": "done", "markdown_url": "https://cdn.example.com/full.md"}},
    ])
    data = _run(mineru_client._poll_task(client, "task-1", timeout=30, interval=0.01))
    assert data["state"] == "done"
    assert client.calls == 3  # pending → running → done 共 3 次查询


def test_poll_task_failed_raises():
    client = _FakeClient([{"code": 0, "data": {"state": "failed", "err_msg": "文件格式不支持"}}])
    with pytest.raises(RuntimeError, match="文件格式不支持"):
        _run(mineru_client._poll_task(client, "task-1", timeout=30, interval=0.01))


def test_poll_task_timeout_raises():
    client = _FakeClient([{"code": 0, "data": {"state": "running"}}])
    with pytest.raises(_ParseTimeout, match="超时"):
        _run(mineru_client._poll_task(client, "task-1", timeout=0.01, interval=0.01))


# ---------------------------------------------------------------- 失败路径

def test_parse_file_not_configured_no_network():
    """未配置时直接失败，不发任何网络请求。"""
    with patch.dict(os.environ, {}, clear=True), \
         patch.object(mineru_client, "_request_file_token", new=AsyncMock()) as m_token, \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()) as m_upload, \
         patch.object(mineru_client, "_poll_task", new=AsyncMock()) as m_poll, \
         patch.object(mineru_client, "_download_markdown", new=AsyncMock()) as m_dl:
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "未配置" in result["error"]
    m_token.assert_not_called()
    m_upload.assert_not_called()
    m_poll.assert_not_called()
    m_dl.assert_not_called()


def test_parse_file_missing_file():
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=False), \
         patch.object(mineru_client, "_request_file_token", new=AsyncMock()) as m_token:
        result = _run(mineru_client.parse_file("/tmp/nope.pdf", "nope.pdf"))
    assert result["ok"] is False
    assert "文件不存在" in result["error"]
    m_token.assert_not_called()


def test_parse_file_exceeds_size_limit():
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize",
                      return_value=mineru_client.MAX_FILE_BYTES + 1), \
         patch.object(mineru_client, "_request_file_token", new=AsyncMock()) as m_token:
        result = _run(mineru_client.parse_file("/tmp/big.pdf", "big.pdf"))
    assert result["ok"] is False
    assert "MB" in result["error"]
    m_token.assert_not_called()


def test_parse_file_token_business_error():
    """业务错误（code != 0）转 ok=False。"""
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024), \
         patch.object(mineru_client, "_request_file_token",
                      new=AsyncMock(side_effect=RuntimeError("MinerU 创建任务失败：额度不足"))):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "额度不足" in result["error"]


def test_parse_file_upload_failure():
    """上传失败 → ok=False。"""
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024), \
         patch.object(mineru_client, "_request_file_token",
                      new=AsyncMock(return_value=("t", "https://oss.example.com/u"))), \
         patch.object(mineru_client, "_upload_file",
                      new=AsyncMock(side_effect=RuntimeError("文件上传失败：HTTP 403"))):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "HTTP 403" in result["error"]


def test_parse_file_poll_failed():
    """轮询 failed → ok=False 且带 err_msg。"""
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024), \
         patch.object(mineru_client, "_request_file_token",
                      new=AsyncMock(return_value=("t", "https://oss.example.com/u"))), \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()), \
         patch.object(mineru_client, "_poll_task",
                      new=AsyncMock(side_effect=RuntimeError("文件页数超出轻量接口限制"))):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "页数超出" in result["error"]


def test_parse_file_timeout():
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024), \
         patch.object(mineru_client, "_request_file_token",
                      new=AsyncMock(return_value=("t", "https://oss.example.com/u"))), \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()), \
         patch.object(mineru_client, "_poll_task",
                      new=AsyncMock(side_effect=_ParseTimeout("MinerU 解析超时（超过 300 秒），可稍后重试"))):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "超时" in result["error"]


# ---------------------------------------------------------------- 防御性响应解析

def test_find_url_variants():
    # 已知键名
    assert mineru_client._find_url({"data": {"file_url": "https://a.com/1"}}) == "https://a.com/1"
    assert mineru_client._find_url({"data": {"fileUrl": "https://a.com/2"}}) == "https://a.com/2"
    # list 里的裸 URL 字符串
    assert mineru_client._find_url({"data": {"file_urls": ["https://a.com/3"]}}) == "https://a.com/3"
    # 未知键名 → http 字符串兜底（嵌套 dict + list）
    body = {"code": 0, "data": [{"name": "a.pdf", "href": "https://oss.example.com/y"}]}
    assert mineru_client._find_url(body) == "https://oss.example.com/y"
    # 没有 URL → 空串
    assert mineru_client._find_url({"data": {"state": "pending"}}) == ""


def test_find_task_id_variants():
    assert mineru_client._find_task_id({"data": {"task_id": "t-1"}}) == "t-1"
    assert mineru_client._find_task_id({"data": {"taskId": "t-2"}}) == "t-2"
    assert mineru_client._find_task_id({"data": {"id": 12345}}) == "12345"
    assert mineru_client._find_task_id({"data": {"state": "pending"}}) == ""
