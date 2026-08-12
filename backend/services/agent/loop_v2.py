"""Agent 主循环 v2（manifest 驱动）。

流程与现有 ``loop.py`` 一致（组装 messages → LLMClient.stream_tools 流式多轮 →
无 tool_calls 返回文本；有 tool_calls 逐个执行 → 回填 role=tool 消息 → 循环），
但改用 v2 的 manifest 注册表与 ToolResult / emit_event 体系：

1. handler 返回 ``ToolResult``（而非 ``str``），回填 LLM 用 ``result.content``。
2. 工具执行事件（start / success / error / files）通过 ``ctx.emit_event`` 推送。
3. 使用 ``registry_v2.get_tools_schema`` 生成 OpenAI function calling 格式，
   并展平为 ``LLMClient.stream_tools`` 所需的 ``[{"name","description","parameters"}]`` 格式。

注意：不实际接入 chat.py，是独立可调用的 async generator。
"""
from __future__ import annotations

import inspect
import logging
import time
import uuid
from typing import AsyncGenerator, Optional

from backend.services.agent.manifest import (
    ToolContext,
    ToolEventType,
    ToolResult,
)
from backend.services.agent.parser import safe_parse_arguments
from backend.services.agent.registry_v2 import get_tool, get_tools_schema
from backend.services.llm_client import LLMClient, LLMError

logger = logging.getLogger(__name__)

DEFAULT_MAX_TOOL_CALLS = 5
DEFAULT_MAX_TOKENS = 2000

# 工具不存在 / 执行出错时的回填文本
_NOT_FOUND_MSG = "工具 {name} 不存在，请换一种方式重试。"
_EXEC_ERROR_MSG = "工具 {name} 执行出错：{error}"
_EMPTY_FINAL_MSG = "抱歉，我暂时无法完成这个任务，请换个说法再试一次。"

# usage 统一 schema 的各分项键（与 llm_client._extract_usage 对齐）
_USAGE_KEYS = ("input_tokens", "output_tokens", "cache_read_tokens",
               "cache_creation_tokens", "reasoning_tokens", "total_tokens")


def _merge_usage(acc: Optional[dict], new: Optional[dict]) -> Optional[dict]:
    """累加多轮 LLM 调用的 usage（agent 模式每轮一份）。任一为 None 时保留另一份。"""
    if new is None:
        return acc
    if acc is None:
        return {k: int(new.get(k) or 0) for k in _USAGE_KEYS}
    for k in _USAGE_KEYS:
        acc[k] = int(acc.get(k) or 0) + int(new.get(k) or 0)
    return acc


async def _emit(ctx: ToolContext, event_type: str, data: dict) -> None:
    """通过 ctx.emit_event 推送 SSE 事件（兼容同步 / 异步回调）。

    Args:
        ctx: 工具执行上下文（emit_event 可能为 None）。
        event_type: 事件类型（ToolEventType 枚举值）。
        data: 事件载荷。
    """
    if ctx.emit_event is None:
        return
    result = ctx.emit_event(event_type, data)
    if inspect.isawaitable(result):
        await result


def _to_flat_tools(openai_tools: list[dict]) -> list[dict]:
    """把 OpenAI function calling 格式展平为 LLMClient.stream_tools 所需格式。

    OpenAI 格式:  {"type": "function", "function": {"name", "description", "parameters"}}
    flat 格式:     {"name", "description", "parameters"}
    """
    out: list[dict] = []
    for t in openai_tools:
        fn = t.get("function") if isinstance(t, dict) else None
        if isinstance(fn, dict) and "name" in fn:
            out.append(fn)
    return out


async def _execute_one(call: dict, ctx: ToolContext) -> ToolResult:
    """执行单个 tool_call（带状态推送、错误兜底）。

    流程：emit start 事件 → 调用 handler → emit success/error 事件。
    单个工具失败不中断整个循环，返回 ``is_error=True`` 的 ToolResult 让 LLM 决定下一步。

    Args:
        call: LLM 返回的 tool_call 字典（含 id / name / arguments / arguments_raw）。
        ctx: 工具执行上下文（执行前设置 tool_call_id）。

    Returns:
        ToolResult（成功 / 失败均返回，失败时 is_error=True）。
    """
    name = str(call.get("name") or "").strip()
    call_id = str(call.get("id") or "") or f"call_{uuid.uuid4().hex[:8]}"
    ctx.tool_call_id = call_id

    # 参数：优先用 LLMClient 已解析的 dict，否则三级容错解析原始串
    args = call.get("arguments")
    if not isinstance(args, dict):
        args = safe_parse_arguments(call.get("arguments_raw"))
    if not isinstance(args, dict):
        args = {}

    await _emit(ctx, ToolEventType.START, {
        "call_id": call_id,
        "name": name,
        "arguments": args,
        "status_text": "执行中…",
    })

    tool = get_tool(name)
    if tool is None:
        content = _NOT_FOUND_MSG.format(name=name)
        logger.warning("[agent/loop_v2] 工具 %r 未注册，回填错误信息", name)
        await _emit(ctx, ToolEventType.ERROR, {
            "call_id": call_id,
            "name": name,
            "error": content,
        })
        return ToolResult(content=content, is_error=True)

    started = time.monotonic()
    try:
        raw_result = await tool.handler(args, ctx)
        if not isinstance(raw_result, ToolResult):
            # 兼容旧式返回 str 的工具
            raw_result = ToolResult(content=str(raw_result or ""))
    except Exception as exc:  # noqa: BLE001 - 工具异常不中断循环
        logger.exception("[agent/loop_v2] 工具 %r 执行异常", name)
        error_msg = _EXEC_ERROR_MSG.format(name=name, error=str(exc))
        await _emit(ctx, ToolEventType.ERROR, {
            "call_id": call_id,
            "name": name,
            "error": error_msg,
            "duration_ms": int((time.monotonic() - started) * 1000),
        })
        return ToolResult(
            content=error_msg,
            is_error=True,
            metadata={"duration_ms": int((time.monotonic() - started) * 1000)},
        )

    duration_ms = int((time.monotonic() - started) * 1000)
    raw_result.metadata.setdefault("duration_ms", duration_ms)

    # 产出文件先推 files 事件，再推 success 事件（前端先渲染文件再标记完成）
    if raw_result.files:
        await _emit(ctx, ToolEventType.FILES, {
            "call_id": call_id,
            "name": name,
            "files": raw_result.files,
        })

    await _emit(ctx, ToolEventType.SUCCESS, {
        "call_id": call_id,
        "name": name,
        "result_len": len(raw_result.content),
        "duration_ms": duration_ms,
        "is_error": raw_result.is_error,
    })

    return raw_result


async def run_agent_stream_v2(
    *,
    system: str = "",
    messages: list,
    tools_names: Optional[list[str]] = None,
    max_tool_calls: int = DEFAULT_MAX_TOOL_CALLS,
    override: Optional[dict] = None,
    ctx: Optional[ToolContext] = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> AsyncGenerator[dict, None]:
    """agent 主循环 v2（流式版）：多轮 tool_calls 执行，边收边吐事件。

    与现有 ``loop.run_agent_stream`` 独立，使用 v2 的 manifest 注册表与 ToolResult 体系。
    LLM 流式事件（chunk / thinking / done）通过 yield 返回；
    工具执行事件（start / success / error / files）通过 ``ctx.emit_event`` 推送。

    Args:
        system: 系统提示词（透传给 LLMClient）。
        messages: 对话消息（role: user/assistant），内部会追加 assistant/tool 消息（不改调用方列表）。
        tools_names: 启用的工具名列表；None 表示全部已注册工具。
        max_tool_calls: 工具调用累计上限，达到后下一轮不再传 tools 强制直接回答。默认 5。
        override: per-model 覆盖（base_url/api_key/protocol/model），透传 LLMClient。
        ctx: 工具执行上下文（user/session_id/db/config/emit_event）；None 时创建空上下文。
        max_tokens: 每轮 LLM 调用输出上限（默认 2000）。

    Yields:
        {"type": "chunk", "text": 增量文本}：LLM 流式透传
        {"type": "thinking", "text": 思考增量}：LLM 流式透传
        {"type": "done", "text": 最终文本, "thinking": 各轮思考合并, "usage": token 累计}：最终回复

    Raises:
        LLMError: LLM 调用失败（含流式降级非流式重试后仍失败），由上层处理。
        ValueError: messages 为空。
    """
    if not messages:
        raise ValueError("run_agent_stream_v2: messages 不能为空")
    ctx = ctx or ToolContext()
    # 复制消息，避免污染调用方列表（后续要追加 assistant/tool 消息）
    work: list[dict] = [dict(m) for m in messages]

    thinking_parts: list[str] = []  # 每轮 LLM 的思考过程（agent 模式合并展示）
    total_usage: Optional[dict] = None  # 多轮 LLM 调用的 usage 累积

    executed_calls = 0  # 已执行的工具调用累计数
    # 最多 max_tool_calls + 1 轮 LLM 调用：最后一轮不带 tools
    for _round in range(max_tool_calls + 1):
        send_tools = get_tools_schema(tools_names) if executed_calls < max_tool_calls else []
        # LLMClient.stream_tools 接受 flat 格式 [{"name","description","parameters"}]，
        # get_tools_schema 返回 OpenAI 包装格式，需展平
        flat_tools = _to_flat_tools(send_tools) if send_tools else []
        round_text = ""
        round_thinking = ""
        round_calls: list = []
        round_error: Optional[str] = None
        try:
            async for event in LLMClient.stream_tools(
                system=system,
                messages=work,
                tools=flat_tools or None,
                max_tokens=max_tokens,
                reasoning_effort="auto",
                temperature=None,
                override=override,
            ):
                etype = event["type"]
                if etype == "chunk":
                    round_text += str(event.get("text") or "")
                    yield {"type": "chunk", "text": event["text"]}
                elif etype == "thinking":
                    round_thinking += str(event.get("text") or "")
                    yield {"type": "thinking", "text": event["text"]}
                elif etype == "done":
                    # done 事件携带本轮完整文本 / 思考 / tool_calls（覆盖增量累积值）
                    round_text = str(event.get("text") or "")
                    round_thinking = str(event.get("thinking") or "")
                    round_calls = event.get("tool_calls") or []
                    total_usage = _merge_usage(total_usage, event.get("usage"))
                elif etype == "error":
                    round_error = str(event.get("detail") or "LLM 调用失败")
        except LLMError:
            raise

        if round_error:
            # 流式失败且降级非流式重试也失败 → 抛给上层
            raise LLMError(round_error)

        text = round_text
        calls = round_calls
        thinking = round_thinking.strip()
        if thinking:
            thinking_parts.append(thinking)
        logger.info(
            "[agent/loop_v2] round=%d tool_calls=%d text_len=%d tools_enabled=%s",
            _round + 1, len(calls), len(text), bool(flat_tools),
        )

        if not calls:
            # 无 tool_calls → 直接返回文本
            if text.strip():
                yield {
                    "type": "done",
                    "text": text,
                    "thinking": "\n\n".join(thinking_parts),
                    "usage": total_usage,
                }
                return
            if not flat_tools:
                # 已不再传 tools 仍无内容，防御退出
                yield {
                    "type": "done",
                    "text": _EMPTY_FINAL_MSG,
                    "thinking": "\n\n".join(thinking_parts),
                    "usage": total_usage,
                }
                return
            continue  # 防御：空响应再走一轮

        # 有 tool_calls：先回填 assistant 消息（openai 协议要求 id/function 与 tool 消息对应）
        assistant_msg: dict = {"role": "assistant", "content": text or None}
        if thinking:
            # DeepSeek 带 tools 时要求回传 reasoning_content，否则 API 400
            assistant_msg["reasoning_content"] = thinking
        assistant_msg["tool_calls"] = [
            {
                "id": c.get("id") or "",
                "type": "function",
                "function": {
                    "name": c.get("name") or "",
                    "arguments": str(c.get("arguments_raw") or "{}"),
                },
            }
            for c in calls
        ]
        work.append(assistant_msg)

        # 逐个执行 tool_calls（串行，保持与现有 loop.py 一致）
        for call in calls:
            result = await _execute_one(call, ctx)
            # 把 tool 结果回填到 messages（role=tool, tool_call_id, content）
            # 错误也回填（is_error 时 content 已是错误文案），让 LLM 决定下一步
            work.append({
                "role": "tool",
                "tool_call_id": str(call.get("id") or ""),
                "content": result.content,
            })
        executed_calls += len(calls)

    # 理论上已由「最后一轮不带 tools」保证返回；此处防御兜底
    logger.warning("[agent/loop_v2] 达到最大轮数仍未得到文本回复，返回兜底文案")
    yield {
        "type": "done",
        "text": _EMPTY_FINAL_MSG,
        "thinking": "\n\n".join(thinking_parts),
        "usage": total_usage,
    }
