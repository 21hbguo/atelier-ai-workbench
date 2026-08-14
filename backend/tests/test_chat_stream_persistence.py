"""聊天流式增量落库回归测试（任务制改造后：增量落库移到模块级 _append_assistant_delta / run_generation）。"""
import inspect

from backend.routers import chat as chat_module


def test_streamed_assistant_content_is_persisted_before_done():
    # 增量落库：模块级 _append_assistant_delta（占位消息已存在 → 只 UPDATE 追加）
    delta_source = inspect.getsource(chat_module._append_assistant_delta)
    assert "def _append_assistant_delta" in delta_source
    assert "UPDATE chat_messages SET content = content || %s" in delta_source

    # run_generation（原 event_generator）对 chunk/thinking 事件双写：落库 + 广播
    gen_source = inspect.getsource(chat_module.run_generation)
    assert "_append_assistant_delta(ctx.assistant_msg_id, text=str(event[\"text\"] or \"\"))" in gen_source
    assert "_append_assistant_delta(ctx.assistant_msg_id, thinking=str(event[\"text\"] or \"\"))" in gen_source
    # done 终态全量写（含 status='done'）
    assert 'status="done"' in gen_source or "status=\"done\"" in gen_source
    assert "def _save_assistant_message" in inspect.getsource(chat_module._save_assistant_message)


def test_list_messages_tolerates_psycopg3_jsonb_objects():
    """回归：psycopg3 自动把 jsonb 反序列化为 list/dict，直接 json.loads 会抛 TypeError
    被 except 吞掉导致 files/citations/widgets 恒为空（刷新后文件卡片消失）。"""
    source = inspect.getsource(chat_module.list_messages)

    # 每个 jsonb 字段读取处都必须先 isinstance 判断（兼容已反序列化的 list/dict）
    for field in ("file_ids", "citations", "widgets", "files"):
        assert f'isinstance(r["{field}"], list)' in source, f"{field} 缺少 psycopg3 兼容"
    assert "json.loads" in source  # 字符串形态（旧数据/其他驱动）仍要支持


def test_list_messages_exposes_status_and_error():
    """任务制契约：消息列表响应带 status / error 字段。"""
    source = inspect.getsource(chat_module.list_messages)
    assert '"status": r["status"] or "done"' in source
    assert '"error": r["error"]' in source
    assert "status, error" in source  # SELECT 已带上新列
