"""image_recognize 工具测试：归属校验、识别引擎选择、文件读取、调用与错误路径。"""
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from backend.services.agent.context import AgentContext
from backend.services.agent.tools import image_recognize as tool


def _run(coro):
    return asyncio.run(coro)


def _ctx(session_id=7, user_id=29):
    return AgentContext(session_id=session_id, user_id=user_id)


def _mock_get_db(rows):
    """mock get_db：chat_files 查询返回给定 rows（[{id, original_name, storage_name}]）。"""
    conn = MagicMock(name="db_conn")

    def _side(sql, *params):
        cur = MagicMock(name="cur")
        if "FROM chat_files" in str(sql):
            cur.fetchall.return_value = rows
        return cur

    conn.execute.side_effect = _side
    db = MagicMock(name="get_db")
    db.__enter__ = MagicMock(return_value=conn)
    db.__exit__ = MagicMock(return_value=False)
    return patch.object(tool, "get_db", return_value=db)


def _vision_model(model_id="gpt-5.6-luna"):
    return {
        "model_id": model_id, "label": model_id, "protocol": "openai",
        "base_url": "http://proxy.example.test/v1", "api_key": "env:ATELIER_PROXY_API_KEY",
        "reasoning_efforts": ["auto"], "default_reasoning_effort": "auto",
        "capabilities": ["vision"], "enabled": True,
    }


def test_recognize_returns_description(tmp_path, monkeypatch):
    """正常路径：查图 → 读文件 → 调视觉模型 → 返回识别文本。"""
    (tmp_path / "uploads").mkdir(exist_ok=True)
    img = tmp_path / "uploads" / "a.png"
    img.write_bytes(b"\x89PNG fake")
    monkeypatch.setattr(tool, "user_workspace_root", lambda uid: tmp_path)
    rows = [{"id": 23, "original_name": "a.png", "storage_name": "uploads/a.png"}]

    async def _fake_complete(**kwargs):
        assert kwargs["override"]["model"] == "gpt-5.6-luna"  # 优先 luna
        assert kwargs["override"]["base_url"] == "http://proxy.example.test/v1"
        assert "ATELIER_PROXY_API_KEY" in kwargs["override"]["api_key"] or "sk-" in str(kwargs["override"]["api_key"])
        # 消息带图片块
        content = kwargs["messages"][0]["content"]
        assert content[0]["type"] == "text"
        assert content[1]["type"] == "image"
        assert content[1]["media_type"] == "image/png"
        return "红色矩形中央有一个黄色圆形，写着 HELLO"

    with _mock_get_db(rows), \
         patch.object(tool, "get_by_model_id", return_value=_vision_model()), \
         patch.object(tool.LLMClient, "complete", new=_fake_complete):
        result = _run(tool.image_recognize({"file_ids": [23]}, _ctx()))

    assert "红色矩形" in result


def test_recognize_env_key_resolved(tmp_path, monkeypatch):
    """env: 引用 key 解析为环境变量值。"""
    (tmp_path / "uploads").mkdir(exist_ok=True)
    img = tmp_path / "uploads" / "b.jpg"
    img.write_bytes(b"fake jpg")
    monkeypatch.setattr(tool, "user_workspace_root", lambda uid: tmp_path)
    monkeypatch.setenv("ATELIER_PROXY_API_KEY", "sk-test-123")
    rows = [{"id": 24, "original_name": "b.jpg", "storage_name": "uploads/b.jpg"}]

    async def _fake_complete(**kwargs):
        assert kwargs["override"]["api_key"] == "sk-test-123"
        assert kwargs["messages"][0]["content"][1]["media_type"] == "image/jpeg"  # jpg 推断
        return "描述"

    with _mock_get_db(rows), \
         patch.object(tool, "get_by_model_id", return_value=_vision_model()), \
         patch.object(tool.LLMClient, "complete", new=_fake_complete):
        result = _run(tool.image_recognize({"file_ids": [24]}, _ctx()))
    assert result == "描述"


def test_recognize_empty_file_ids_returns_error():
    result = _run(tool.image_recognize({"file_ids": []}, _ctx()))
    assert "file_ids 不能为空" in result


def test_recognize_images_not_in_session_returns_error():
    with _mock_get_db([]):
        result = _run(tool.image_recognize({"file_ids": [99]}, _ctx()))
    assert "不存在或不属于当前会话" in result


def test_recognize_no_vision_model_returns_error():
    with _mock_get_db([{"id": 23, "original_name": "a.png", "storage_name": "uploads/a.png"}]), \
         patch.object(tool, "get_by_model_id", return_value=None), \
         patch.object(tool, "get_vision_default", return_value=None):
        result = _run(tool.image_recognize({"file_ids": [23]}, _ctx()))
    assert "没有可用的图片识别模型" in result


def test_recognize_falls_back_to_vision_default(tmp_path, monkeypatch):
    """luna 不可用时回退 get_vision_default()。"""
    (tmp_path / "uploads").mkdir(exist_ok=True)
    img = tmp_path / "uploads" / "c.png"
    img.write_bytes(b"png")
    monkeypatch.setattr(tool, "user_workspace_root", lambda uid: tmp_path)
    rows = [{"id": 25, "original_name": "c.png", "storage_name": "uploads/c.png"}]
    fallback = _vision_model("gpt-5.6-terra")

    async def _fake_complete(**kwargs):
        assert kwargs["override"]["model"] == "gpt-5.6-terra"
        return "识别结果"

    with _mock_get_db(rows), \
         patch.object(tool, "get_by_model_id", return_value=None), \
         patch.object(tool, "get_vision_default", return_value=fallback), \
         patch.object(tool.LLMClient, "complete", new=_fake_complete):
        result = _run(tool.image_recognize({"file_ids": [25]}, _ctx()))
    assert result == "识别结果"


def test_recognize_file_missing_returns_error(tmp_path, monkeypatch):
    monkeypatch.setattr(tool, "user_workspace_root", lambda uid: tmp_path)  # 目录为空，文件不存在
    rows = [{"id": 26, "original_name": "gone.png", "storage_name": "uploads/gone.png"}]
    with _mock_get_db(rows), \
         patch.object(tool, "get_by_model_id", return_value=_vision_model()):
        result = _run(tool.image_recognize({"file_ids": [26]}, _ctx()))
    assert "文件缺失" in result


def test_recognize_llm_error_returns_readable_message(tmp_path, monkeypatch):
    (tmp_path / "uploads").mkdir(exist_ok=True)
    img = tmp_path / "uploads" / "d.png"
    img.write_bytes(b"png")
    monkeypatch.setattr(tool, "user_workspace_root", lambda uid: tmp_path)
    rows = [{"id": 27, "original_name": "d.png", "storage_name": "uploads/d.png"}]

    async def _fake_complete(**kwargs):
        from backend.services.llm_client import LLMError
        raise LLMError("识别模型接口超时")

    with _mock_get_db(rows), \
         patch.object(tool, "get_by_model_id", return_value=_vision_model()), \
         patch.object(tool.LLMClient, "complete", new=_fake_complete):
        result = _run(tool.image_recognize({"file_ids": [27]}, _ctx()))
    assert "识别模型接口超时" in result
