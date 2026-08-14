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


def test_list_messages_tolerates_psycopg3_jsonb_objects():
    """回归：psycopg3 自动把 jsonb 反序列化为 list/dict，直接 json.loads 会抛 TypeError
    被 except 吞掉导致 files/citations/widgets 恒为空（刷新后文件卡片消失）。"""
    source = inspect.getsource(chat_module.list_messages)

    # 每个 jsonb 字段读取处都必须先 isinstance 判断（兼容已反序列化的 list/dict）
    for field in ("file_ids", "citations", "widgets", "files"):
        assert f'isinstance(r["{field}"], list)' in source, f"{field} 缺少 psycopg3 兼容"
    assert "json.loads" in source  # 字符串形态（旧数据/其他驱动）仍要支持
