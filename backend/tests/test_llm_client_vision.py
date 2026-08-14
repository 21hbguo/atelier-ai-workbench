"""LLMClient 图片消息块（视觉输入）单元测试：openai/anthropic 双协议、url/data/path 三种来源。

直接调用 _build_request 断言请求体 dict 结构（不 mock 被测函数本身）。
"""
import base64

import pytest

from backend.services.llm_client import LLMClient, LLMError

CFG = {
    "base_url": "https://api.example.com/v1",
    "api_key": "sk-test",
    "protocol": "openai",
    "model": "test-model",
    "enabled": True,
    "timeout_seconds": 10,
}

# 1x1 透明 PNG 的 base64 裸串
B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def _cfg(**kw):
    c = dict(CFG)
    c.update(kw)
    return c


def _build(cfg, messages, system="", **kw):
    """真正调用 _build_request，返回 body（OpenAI 分支含 system 消息）。"""
    _, _, body = LLMClient._build_request(cfg, system, messages, 2000, "auto", None, None, **kw)
    return body


# ---------- 1. 纯字符串消息透传不变（向后兼容） ----------

def test_plain_text_content_passthrough():
    messages = [
        {"role": "user", "content": "你好"},
        {"role": "assistant", "content": "你好，有什么可以帮你？"},
    ]
    body = _build(CFG, messages)
    assert body["messages"] == messages
    assert all(isinstance(m["content"], str) for m in body["messages"])


def test_plain_text_passthrough_anthropic():
    cfg = _cfg(protocol="anthropic")
    messages = [{"role": "user", "content": "你好"}]
    body = _build(cfg, messages)
    assert body["messages"] == messages
    assert isinstance(body["messages"][0]["content"], str)


# ---------- 2/3. OpenAI 协议 ----------

def test_openai_base64_image_block():
    messages = [{"role": "user", "content": [
        {"type": "text", "text": "看这张图"},
        {"type": "image", "data": B64, "media_type": "image/png"},
    ]}]
    body = _build(CFG, messages)
    content = body["messages"][0]["content"]
    # text 块与 image 块混排：content 为 list，text 块原样保留
    assert content[0] == {"type": "text", "text": "看这张图"}
    assert content[1] == {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{B64}"}}


def test_openai_base64_data_without_media_type_defaults_png():
    messages = [{"role": "user", "content": [{"type": "image", "data": B64}]}]
    body = _build(CFG, messages)
    assert body["messages"][0]["content"] == [
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{B64}"}}
    ]


def test_openai_url_image_block_passthrough():
    messages = [{"role": "user", "content": [{"type": "image", "url": "https://example.com/a.png"}]}]
    body = _build(CFG, messages)
    assert body["messages"][0]["content"] == [
        {"type": "image_url", "image_url": {"url": "https://example.com/a.png"}}
    ]


# ---------- 4/5. Anthropic 协议 ----------

def test_anthropic_base64_image_block():
    cfg = _cfg(protocol="anthropic")
    messages = [{"role": "user", "content": [
        {"type": "text", "text": "描述图片"},
        {"type": "image", "data": B64, "media_type": "image/png"},
    ]}]
    body = _build(cfg, messages)
    content = body["messages"][0]["content"]
    assert content[0] == {"type": "text", "text": "描述图片"}
    assert content[1] == {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": B64}}


def test_anthropic_url_image_block():
    cfg = _cfg(protocol="anthropic")
    messages = [{"role": "user", "content": [{"type": "image", "url": "https://example.com/a.png"}]}]
    body = _build(cfg, messages)
    assert body["messages"][0]["content"] == [
        {"type": "image", "source": {"type": "url", "url": "https://example.com/a.png"}}
    ]


# ---------- 6/7. 本地文件 path ----------

def test_openai_local_path_reads_and_b64encodes(tmp_path):
    p = tmp_path / "photo.jpg"
    raw = b"\xff\xd8\xff\xe0fake-jpeg-bytes"
    p.write_bytes(raw)
    messages = [{"role": "user", "content": [{"type": "image", "path": str(p)}]}]
    body = _build(CFG, messages)
    expect_b64 = base64.b64encode(raw).decode("ascii")
    assert body["messages"][0]["content"] == [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{expect_b64}"}}
    ]


def test_anthropic_local_path_with_explicit_media_type(tmp_path):
    cfg = _cfg(protocol="anthropic")
    p = tmp_path / "pic.png"
    raw = b"\x89PNG-fake"
    p.write_bytes(raw)
    messages = [{"role": "user", "content": [{"type": "image", "path": str(p), "media_type": "image/png"}]}]
    body = _build(cfg, messages)
    expect_b64 = base64.b64encode(raw).decode("ascii")
    assert body["messages"][0]["content"] == [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": expect_b64}}
    ]


def test_missing_path_raises_llm_error():
    messages = [{"role": "user", "content": [{"type": "image", "path": "/no/such/file.png"}]}]
    with pytest.raises(LLMError) as ei:
        _build(CFG, messages)
    assert "图片文件不存在" in str(ei.value)


# ---------- 补充：扩展名推断 ----------

def test_extension_inference_png_and_unknown(tmp_path):
    png = tmp_path / "pic.PNG"
    png.write_bytes(b"png-bytes")
    unknown = tmp_path / "pic.bin"
    unknown.write_bytes(b"bin-bytes")

    messages = [
        {"role": "user", "content": [{"type": "image", "path": str(png)}]},
        {"role": "user", "content": [{"type": "image", "path": str(unknown)}]},
    ]
    body = _build(CFG, messages)
    c0 = body["messages"][0]["content"][0]["image_url"]["url"]
    c1 = body["messages"][1]["content"][0]["image_url"]["url"]
    assert c0.startswith("data:image/png;base64,")  # 大写扩展名也识别
    assert c1.startswith("data:image/png;base64,")  # 未知扩展名默认 png


def test_image_block_missing_source_raises():
    messages = [{"role": "user", "content": [{"type": "image"}]}]
    with pytest.raises(LLMError) as ei:
        _build(CFG, messages)
    assert "缺少 url/data/path" in str(ei.value)
