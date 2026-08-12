"""工具系统 v2 数据模型（manifest 驱动）。

定义工具元信息（ToolManifest）、执行上下文（ToolContext）、执行结果（ToolResult）、
调用记录（ToolCall / ToolCallStatus）、SSE 事件（ToolExecutionEvent）等 Pydantic 模型。

与现有 registry.py / loop.py 中的 AgentContext 体系并存，不互相影响。
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field, ConfigDict


class ToolCallStatus(str, Enum):
    """工具调用状态（驱动前端 ToolCallCard 渲染）。

    Attributes:
        PENDING: LLM 已返回 tool_call，尚未派发。
        RUNNING: 正在执行（已发 start 事件）。
        SUCCESS: 执行成功。
        ERROR: 执行失败。
    """

    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"


class ToolEventType(str, Enum):
    """工具执行 SSE 事件类型。

    Attributes:
        START: 调用开始（含 call_id / name / arguments）。
        PROGRESS: 进度更新（含 call_id / progress / status_text）。
        SUCCESS: 执行成功（含 call_id / result_len / duration_ms）。
        ERROR: 执行失败（含 call_id / error）。
        FILES: 产出文件（含 call_id / files）。
    """

    START = "start"
    PROGRESS = "progress"
    SUCCESS = "success"
    ERROR = "error"
    FILES = "files"


class ToolManifest(BaseModel):
    """工具元信息：驱动注册、LLM schema 生成、前端渲染。

    生成 OpenAI tool 定义时，仅取 name / description / parameters 三字段；
    其余字段供前端 UI / 启用控制 / 上下文校验使用。

    Attributes:
        name: 工具唯一名（下划线式，如 image_generate / web_search / knowledge_search）。
        description: 给 LLM 看的工具用途说明（决定模型何时调用此工具）。
        parameters: JSON Schema（OpenAI function calling 兼容格式）。
        ui_hints: 结果 UI 渲染提示（前端按此选择 Render 组件），缺省 None 时由前端默认渲染。
        required_context: 工具运行所需的上下文键（如 ['session_id','db']），派发前校验。
        category: 分类（前端分组展示，如 'image' / 'search' / 'knowledge' / 'file' / 'utility'）。
        tags: 标签（前端筛选，如 ['图片','生成']）。
    """

    name: str = Field(
        ...,
        description="工具唯一名（下划线式，如 image_generate / web_search / knowledge_search）",
        max_length=128,
    )
    description: str = Field(
        ...,
        description="给 LLM 看的工具用途说明（决定模型何时调用此工具）",
    )
    parameters: dict = Field(
        default_factory=lambda: {"type": "object", "properties": {}},
        description="JSON Schema（OpenAI function calling 兼容格式）",
    )
    ui_hints: Optional[list[str]] = Field(
        None,
        description="结果 UI 渲染提示（前端按此选择 Render 组件）",
    )
    required_context: list[str] = Field(
        default_factory=list,
        description="工具运行所需的上下文键（如 ['session_id','db']），派发前校验",
    )
    category: str = Field(
        "utility",
        description="分类（前端分组展示）",
    )
    tags: list[str] = Field(
        default_factory=list,
        description="标签（前端筛选）",
    )

    def to_openai_function(self) -> dict:
        """转换为 OpenAI tool 定义（发给 LLM）。

        Returns:
            {"type": "function", "function": {"name", "description", "parameters"}}
        """
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolContext(BaseModel):
    """一次 agent 运行的工具执行上下文。

    扩展自现有 AgentContext 思路，但独立定义，不影响旧体系。
    handler 通过 ctx 访问用户信息、数据库、配置，并主动推送 SSE 事件。

    Attributes:
        user: 当前用户信息字典（如 {'user_id': 1, 'username': '...'}）。
        session_id: 当前会话 id（0 表示无会话上下文）。
        db: 数据库连接工厂（get_db 上下文管理器），None 表示不可用。
        config: 全局配置字典（替代工具内部读 env）。
        emit_event: SSE 事件回调 ``Callable[[str, dict], Any]``，签名 ``(event_type, data)``；
            可为同步或异步，由 loop 统一处理。None 时不推送事件。
        tool_call_id: 当前调用的唯一 id（用于事件关联），由 loop 在派发前设置。
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    user: dict = Field(default_factory=dict, description="当前用户信息字典")
    session_id: int = Field(0, description="当前会话 id（0 表示无会话上下文）")
    db: Optional[Any] = Field(None, description="数据库连接工厂（get_db 上下文管理器）")
    config: dict = Field(default_factory=dict, description="全局配置字典")
    emit_event: Optional[Callable[..., Any]] = Field(
        None,
        description="SSE 事件回调 ``(event_type: str, data: dict) -> Any``，可为同步或异步",
    )
    tool_call_id: Optional[str] = Field(
        None,
        description="当前调用的唯一 id（由 loop 在派发前设置，用于事件关联）",
    )

    @property
    def has_session(self) -> bool:
        """是否拥有有效会话上下文。"""
        return self.session_id != 0


class ToolResult(BaseModel):
    """工具执行结果（双通道：LLM 文本 + UI 数据）。

    - content: 给 LLM 的字符串（必须，回填 role=tool 消息）。
    - ui_payload: 给前端的富数据（可选，通过 emit_event 推送）。
    - is_error: 是否为错误结果（LLM 据此决定是否重试 / 换工具）。
    - files: 产出文件（图片等，前端渲染下载 / 预览）。
    - metadata: 附加元数据（耗时、provider 等，落库审计）。

    Attributes:
        content: 给 LLM 的结果文本（必须返回，复杂结果用 json.dumps）。
        files: 产出文件 ``[{"url", "type", "filename", "size"?}]``，前端渲染下载 / 预览。
        metadata: 附加元数据（duration_ms, provider_id, cost_points 等）。
        ui_payload: 给前端的富数据（如 ``{"images":[url1,url2], "progress":100}``）。
        is_error: 是否为错误结果。
    """

    content: str = Field(
        ...,
        description="给 LLM 的结果文本（必须返回，复杂结果用 json.dumps）",
    )
    files: list[dict] = Field(
        default_factory=list,
        description="产出文件 [{url, type, filename, size?}]，前端渲染下载 / 预览",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="附加元数据（duration_ms, provider_id, cost_points 等）",
    )
    ui_payload: Optional[dict] = Field(
        None,
        description="给前端的富数据（如 {images:[url1,url2], progress:100}）",
    )
    is_error: bool = Field(
        False,
        description="是否为错误结果",
    )


class ToolCall(BaseModel):
    """单次工具调用记录（前端状态机 + 落库审计）。

    Attributes:
        id: 唯一调用 id（LLM 返回的 tool_call.id 或服务端生成）。
        name: 工具名。
        arguments: 调用参数。
        status: 当前状态。
        started_at: 开始时间（ISO 字符串），未开始时为 None。
        finished_at: 完成时间（ISO 字符串），未完成时为 None。
        error: 错误信息（失败时填写），成功时为 None。
    """

    id: str = Field(..., description="唯一调用 id（LLM 返回的 tool_call.id 或服务端生成）")
    name: str = Field(..., description="工具名")
    arguments: dict = Field(default_factory=dict, description="调用参数")
    status: ToolCallStatus = Field(
        ToolCallStatus.PENDING,
        description="当前状态",
    )
    started_at: Optional[str] = Field(
        None,
        description="开始时间（ISO 字符串），未开始时为 None",
    )
    finished_at: Optional[str] = Field(
        None,
        description="完成时间（ISO 字符串），未完成时为 None",
    )
    error: Optional[str] = Field(
        None,
        description="错误信息（失败时填写），成功时为 None",
    )


class ToolExecutionEvent(BaseModel):
    """工具执行 SSE 事件载荷。

    通过 ``ctx.emit_event`` 推送给上层（chat.py 转 SSE）。
    type 决定 data 的结构：

    - start:     data = {"call_id", "name", "arguments", "status_text"}
    - progress:  data = {"call_id", "progress", "status_text"}
    - success:   data = {"call_id", "result_len", "duration_ms"}
    - error:     data = {"call_id", "error"}
    - files:     data = {"call_id", "files"}

    Attributes:
        type: 事件类型（start / progress / success / error / files）。
        call_id: 关联的工具调用 id。
        name: 工具名（便于前端展示，缺省空串）。
        data: 事件特有字段（按 type 解析）。
    """

    type: ToolEventType = Field(..., description="事件类型")
    call_id: str = Field(..., description="关联的工具调用 id")
    name: str = Field("", description="工具名")
    data: dict = Field(default_factory=dict, description="事件特有字段（按 type 解析）")
