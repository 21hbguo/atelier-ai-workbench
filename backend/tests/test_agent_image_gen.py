"""image_gen agent 工具单元测试（不连数据库/上游，全部 mock）。

覆盖：成功（返回 markdown 图片+任务ID）/ 超时（返回指引文案）/
失败（GenerationError 消息直传 / 任务 failed 文案）/ 套餐模型校验 / 图生图分支。
"""
import asyncio
from unittest.mock import AsyncMock, patch

from backend.services.agent.context import AgentContext
from backend.services.agent.tools.image_gen import image_gen
from backend.services.generation_service import GenerationError
from backend.services.agent.tools import image_gen as image_gen_module


def _run(coro):
    return asyncio.run(coro)


def _ctx(user_id=1, allowed_models=None):
    return AgentContext(
        session_id=10,
        user_id=user_id,
        extra={"entitlements": {"allowed_models": allowed_models or []}},
    )


# ---------- 成功 ----------

def test_image_gen_success_returns_markdown_image():
    ctx = _ctx()
    with patch.object(image_gen_module, "create_generation_task", return_value={"task_id": "t-abc", "status": "processing"}), \
         patch.object(image_gen_module, "wait_generation_task", AsyncMock(return_value={
             "status": "completed",
             "result_urls": ["/data/images/t-abc_0.png"],
             "error": None,
             "timed_out": False,
         })):
        result = _run(image_gen({"prompt": "一只在月球上的猫"}, ctx))
        # patch 仅在 with 块内生效，断言必须放在块内
        assert "![图片]" in result
        assert "/api/images/file/t-abc_0.png" in result
        assert "t-abc" in result
        # 创建任务参数透传
        args_pos, kwargs = image_gen_module.create_generation_task.call_args
        assert (args_pos[1] if args_pos else kwargs.get("task_type")) == "text"
        task_params = args_pos[2] if len(args_pos) >= 3 else kwargs.get("task_params")
        assert task_params["prompt"] == "一只在月球上的猫"
        assert task_params["size"] == "auto"


def test_image_gen_success_multiple_images():
    ctx = _ctx()
    with patch.object(image_gen_module, "create_generation_task", return_value={"task_id": "t-1", "status": "processing"}), \
         patch.object(image_gen_module, "wait_generation_task", AsyncMock(return_value={
             "status": "completed",
             "result_urls": ["/x/t-1_0.png", "/x/t-1_1.png"],
             "error": None,
             "timed_out": False,
         })):
        result = _run(image_gen({"prompt": "p"}, ctx))
    assert "共生成 2 张" in result


# ---------- 超时 ----------

def test_image_gen_timeout_returns_guidance():
    ctx = _ctx()
    with patch.object(image_gen_module, "create_generation_task", return_value={"task_id": "t-slow", "status": "processing"}), \
         patch.object(image_gen_module, "wait_generation_task", AsyncMock(return_value={
             "status": "processing",
             "result_urls": [],
             "error": None,
             "timed_out": True,
         })):
        result = _run(image_gen({"prompt": "海边日落"}, ctx))
    assert "图片正在生成中" in result
    assert "t-slow" in result
    assert "AI 绘画" in result


# ---------- 失败 ----------

def test_image_gen_generation_error_message_passthrough():
    ctx = _ctx()
    with patch.object(image_gen_module, "create_generation_task", side_effect=GenerationError("积分不足，需要 10 积分", 402)):
        result = _run(image_gen({"prompt": "p"}, ctx))
    assert result == "积分不足，需要 10 积分"


def test_image_gen_task_failed_message():
    ctx = _ctx()
    with patch.object(image_gen_module, "create_generation_task", return_value={"task_id": "t-fail", "status": "processing"}), \
         patch.object(image_gen_module, "wait_generation_task", AsyncMock(return_value={
             "status": "failed",
             "result_urls": [],
             "error": "上游生成失败",
             "timed_out": False,
         })):
        result = _run(image_gen({"prompt": "p"}, ctx))
    assert "图片生成失败" in result
    assert "上游生成失败" in result
    assert "积分已自动退还" in result


# ---------- 参数与校验 ----------

def test_image_gen_missing_prompt():
    ctx = _ctx()
    result = _run(image_gen({}, ctx))
    assert "prompt" in result


def test_image_gen_no_user_context():
    ctx = AgentContext()
    result = _run(image_gen({"prompt": "p"}, ctx))
    assert "缺少用户上下文" in result


def test_image_gen_model_not_in_allowed_models():
    ctx = _ctx(allowed_models=["gpt-image-2"])
    with patch.object(image_gen_module, "create_generation_task") as mock_create:
        result = _run(image_gen({"prompt": "p", "model_id": "other-model"}, ctx))
    assert "当前套餐不支持生图模型" in result
    mock_create.assert_not_called()


def test_image_gen_text_image_branch():
    ctx = _ctx()
    with patch.object(image_gen_module, "create_generation_task", return_value={"task_id": "t-2", "status": "processing"}), \
         patch.object(image_gen_module, "wait_generation_task", AsyncMock(return_value={
             "status": "completed",
             "result_urls": ["/x/t-2_0.png"],
             "error": None,
             "timed_out": False,
         })):
        result = _run(image_gen({"prompt": "把这张图变成油画", "image_urls": ["https://example.com/a.png"]}, ctx))
        args_pos, kwargs = image_gen_module.create_generation_task.call_args
        assert (args_pos[1] if args_pos else kwargs.get("task_type")) == "text_image"
        task_params = args_pos[2] if len(args_pos) >= 3 else kwargs.get("task_params")
        assert task_params["image_urls"] == ["https://example.com/a.png"]
        assert "![图片]" in result


def test_image_gen_default_model_id():
    ctx = _ctx()
    with patch.object(image_gen_module, "get_default_model_id", return_value="gpt-image-2"), \
         patch.object(image_gen_module, "create_generation_task", return_value={"task_id": "t-3", "status": "processing"}), \
         patch.object(image_gen_module, "wait_generation_task", AsyncMock(return_value={
             "status": "processing",
             "result_urls": [],
             "error": None,
             "timed_out": True,
         })):
        _run(image_gen({"prompt": "p"}, ctx))
        args_pos, kwargs = image_gen_module.create_generation_task.call_args
        task_params = args_pos[2] if len(args_pos) >= 3 else kwargs.get("task_params")
        assert task_params["model_id"] == "gpt-image-2"
