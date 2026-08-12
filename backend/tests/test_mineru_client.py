"""mineru_client 模块单元测试（pytest + asyncio.run，不依赖数据库/网络）。

所有网络调用（_request_batch/_upload_file/_poll_batch/_download_full_zip）
均被 patch，零真实请求；测试风格参照 backend/tests/test_url_fetcher.py。
"""
import asyncio
import io
import os
import zipfile
from unittest.mock import AsyncMock, patch

import pytest

import backend.services.mineru_client as mineru_client
from backend.services.mineru_client import _ParseTimeout


def _run(coro):
    return asyncio.run(coro)


def _zip_bytes(md_text: str, prefix: str = "") -> bytes:
    """构造含 full.md 的 zip 字节（可选目录前缀，模拟真实 zip 结构）。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(f"{prefix}full.md", md_text)
    return buf.getvalue()


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
    """batch → 上传 → 轮询 done → zip 解 full.md → ok=True。"""
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client, "_request_batch",
                      new=AsyncMock(return_value=("batch-1", "https://oss.example.com/up"))) as m_batch, \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()) as m_upload, \
         patch.object(mineru_client, "_poll_batch",
                      new=AsyncMock(return_value={"state": "done", "full_zip_url": "https://cdn.example.com/r.zip"})) as m_poll, \
         patch.object(mineru_client, "_download_full_zip",
                      new=AsyncMock(return_value="# 标题\n正文内容")) as m_zip, \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result == {"ok": True, "text": "# 标题\n正文内容"}
    m_batch.assert_awaited_once()
    m_upload.assert_awaited_once()
    m_poll.assert_awaited_once()
    m_zip.assert_awaited_once()


def test_parse_file_passes_ocr_and_language():
    """is_ocr/language 透传给 _request_batch。"""
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client, "_request_batch",
                      new=AsyncMock(return_value=("b", "https://oss.example.com/u"))) as m_batch, \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()), \
         patch.object(mineru_client, "_poll_batch",
                      new=AsyncMock(return_value={"state": "done", "full_zip_url": "https://cdn.example.com/r.zip"})), \
         patch.object(mineru_client, "_download_full_zip", new=AsyncMock(return_value="x")), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024):
        _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf", is_ocr=True, language="ch"))
    m_batch.assert_awaited_once_with(m_batch.await_args.args[0], "x.pdf", True, "ch", "sk-test")


# ---------------------------------------------------------------- _poll_batch 直测

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


def _batch_body(state, **extra):
    return {"code": 0, "data": {"extract_result": [{"file_name": "x.pdf", "state": state, **extra}]}}


def test_poll_batch_polls_until_done():
    client = _FakeClient([
        _batch_body("pending"),
        _batch_body("running"),
        _batch_body("done", full_zip_url="https://cdn.example.com/r.zip"),
    ])
    item = _run(mineru_client._poll_batch(client, "batch-1", "sk-test", timeout=30, interval=0.01))
    assert item["state"] == "done"
    assert client.calls == 3  # pending → running → done


def test_poll_batch_failed_raises():
    client = _FakeClient([_batch_body("failed", err_msg="文件格式不支持")])
    with pytest.raises(RuntimeError, match="文件格式不支持"):
        _run(mineru_client._poll_batch(client, "batch-1", "sk-test", timeout=30, interval=0.01))


def test_poll_batch_timeout_raises():
    client = _FakeClient([_batch_body("running")])
    with pytest.raises(_ParseTimeout, match="超时"):
        _run(mineru_client._poll_batch(client, "batch-1", "sk-test", timeout=0.01, interval=0.01))


def test_poll_batch_empty_results_keeps_waiting():
    client = _FakeClient([
        {"code": 0, "data": {}},
        _batch_body("done", full_zip_url="https://cdn.example.com/r.zip"),
    ])
    item = _run(mineru_client._poll_batch(client, "batch-1", "sk-test", timeout=30, interval=0.01))
    assert item["state"] == "done"
    assert client.calls == 2


# ---------------------------------------------------------------- _download_full_zip 直测

class _ZipClient:
    def __init__(self, body_bytes):
        self._b = body_bytes

    async def get(self, url, **kwargs):
        return _ZipResp(self._b)


class _ZipResp:
    def __init__(self, body):
        self._b = body

    @property
    def status_code(self):
        return 200

    @property
    def content(self):
        return self._b


def test_download_full_zip_with_prefix():
    client = _ZipClient(_zip_bytes("# 文档内容", prefix="20260812/"))
    text = _run(mineru_client._download_full_zip(client, "https://cdn.example.com/r.zip"))
    assert text == "# 文档内容"


def test_download_full_zip_bad_zip():
    client = _ZipClient(b"not a zip")
    with pytest.raises(RuntimeError, match="损坏"):
        _run(mineru_client._download_full_zip(client, "https://cdn.example.com/r.zip"))


# ---------------------------------------------------------------- 失败路径

def test_parse_file_not_configured_no_network():
    with patch.dict(os.environ, {}, clear=True), \
         patch.object(mineru_client, "_request_batch", new=AsyncMock()) as m_batch, \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()) as m_upload, \
         patch.object(mineru_client, "_poll_batch", new=AsyncMock()) as m_poll, \
         patch.object(mineru_client, "_download_full_zip", new=AsyncMock()) as m_zip:
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "未配置" in result["error"]
    m_batch.assert_not_called()
    m_upload.assert_not_called()
    m_poll.assert_not_called()
    m_zip.assert_not_called()


def test_parse_file_missing_file():
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=False), \
         patch.object(mineru_client, "_request_batch", new=AsyncMock()) as m_batch:
        result = _run(mineru_client.parse_file("/tmp/nope.pdf", "nope.pdf"))
    assert result["ok"] is False
    assert "文件不存在" in result["error"]
    m_batch.assert_not_called()


def test_parse_file_exceeds_size_limit():
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize",
                      return_value=mineru_client.MAX_FILE_BYTES + 1), \
         patch.object(mineru_client, "_request_batch", new=AsyncMock()) as m_batch:
        result = _run(mineru_client.parse_file("/tmp/big.pdf", "big.pdf"))
    assert result["ok"] is False
    assert "MB" in result["error"]
    m_batch.assert_not_called()


def test_parse_file_batch_business_error():
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024), \
         patch.object(mineru_client, "_request_batch",
                      new=AsyncMock(side_effect=RuntimeError("MinerU 申请上传地址失败：额度不足"))):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "额度不足" in result["error"]


def test_parse_file_upload_failure():
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024), \
         patch.object(mineru_client, "_request_batch",
                      new=AsyncMock(return_value=("b", "https://oss.example.com/u"))), \
         patch.object(mineru_client, "_upload_file",
                      new=AsyncMock(side_effect=mineru_client._PollFailed("文件上传失败：HTTP 403"))):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "HTTP 403" in result["error"]


def test_parse_file_poll_failed():
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024), \
         patch.object(mineru_client, "_request_batch",
                      new=AsyncMock(return_value=("b", "https://oss.example.com/u"))), \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()), \
         patch.object(mineru_client, "_poll_batch",
                      new=AsyncMock(side_effect=RuntimeError("文件页数超过限制"))):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "页数超过" in result["error"]


def test_parse_file_retries_transient_failure_then_succeeds():
    """瞬时故障（网络/HTTP 5xx）自动重试，第二次成功。"""
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024), \
         patch.object(mineru_client, "_request_batch",
                      new=AsyncMock(side_effect=[
                          RuntimeError("MinerU 申请上传地址失败：HTTP 503"),
                          ("b", "https://oss.example.com/u"),
                      ])) as m_batch, \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()), \
         patch.object(mineru_client, "_poll_batch",
                      new=AsyncMock(return_value={"state": "done", "full_zip_url": "https://cdn.example.com/r.zip"})), \
         patch.object(mineru_client, "_download_full_zip", new=AsyncMock(return_value="重试后成功")):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result == {"ok": True, "text": "重试后成功"}
    assert m_batch.await_count == 2  # 第一次失败重试，第二次成功


def test_parse_file_poll_failed_no_retry():
    """终态失败（_PollFailed）不重试，只调用一次。"""
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024), \
         patch.object(mineru_client, "_request_batch",
                      new=AsyncMock(return_value=("b", "https://oss.example.com/u"))), \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()), \
         patch.object(mineru_client, "_poll_batch",
                      new=AsyncMock(side_effect=mineru_client._PollFailed("文件格式不支持"))) as m_poll:
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "文件格式不支持" in result["error"]
    assert m_poll.await_count == 1  # 终态失败不重试


def test_parse_file_timeout():
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024), \
         patch.object(mineru_client, "_request_batch",
                      new=AsyncMock(return_value=("b", "https://oss.example.com/u"))), \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()), \
         patch.object(mineru_client, "_poll_batch",
                      new=AsyncMock(side_effect=_ParseTimeout("MinerU 解析超时（超过 300 秒），可稍后重试"))):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "超时" in result["error"]


def test_parse_file_zip_missing_md():
    with patch.dict(os.environ, {"MINERU_API_KEY": "sk-test"}, clear=True), \
         patch.object(mineru_client.os.path, "exists", return_value=True), \
         patch.object(mineru_client.os.path, "getsize", return_value=1024), \
         patch.object(mineru_client, "_request_batch",
                      new=AsyncMock(return_value=("b", "https://oss.example.com/u"))), \
         patch.object(mineru_client, "_upload_file", new=AsyncMock()), \
         patch.object(mineru_client, "_poll_batch",
                      new=AsyncMock(return_value={"state": "done", "full_zip_url": "https://cdn.example.com/r.zip"})), \
         patch.object(mineru_client, "_download_full_zip",
                      new=AsyncMock(side_effect=RuntimeError("结果压缩包中没有 full.md"))):
        result = _run(mineru_client.parse_file("/tmp/x.pdf", "x.pdf"))
    assert result["ok"] is False
    assert "full.md" in result["error"]
