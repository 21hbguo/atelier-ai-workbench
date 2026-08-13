"""聊天流式增量落库回归测试。"""
import inspect

from backend.routers import chat as chat_module


def test_streamed_assistant_content_is_persisted_before_done():
    source = inspect.getsource(chat_module.send_message)

    assert "def _append_assistant_delta" in source
    assert "UPDATE chat_messages SET content = content || %s" in source
    assert "_append_assistant_delta(text=str(event[\"text\"] or \"\"))" in source
    assert "_append_assistant_delta(thinking=str(event[\"text\"] or \"\"))" in source
    assert "def _save_assistant_message" in source
