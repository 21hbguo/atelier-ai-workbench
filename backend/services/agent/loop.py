"""Agent 主循环（aibitat handleExecution 的轻量 Python 版）。

流程：组装 messages → LLMClient.stream_tools(tools=注册工具 schema) 流式多轮 →
无 tool_calls 返回文本；有 tool_calls 逐个执行（参数三级容错解析，handler 异常转错误文本）
→ 以 openai 格式 {"role":"tool","tool_call_id","content"} 回填 messages → 循环；
累计工具调用达 max_tool_calls 后下一轮不再传 tools，强制模型直接回答。

注意：回填格式为 openai 协议（assistant.tool_calls + role=tool）；
anthropic 协议下的 tool_result 转换由上层（调用方）负责。
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from backend.services.agent.context import AgentContext
from backend.services.agent.parser import safe_parse_arguments
from backend.services.agent.registry import get_tool, get_tools_schema
from backend.services.llm_client import LLMClient, LLMError

logger = logging.getLogger(__name__)

DEFAULT_MAX_TOOL_CALLS = 10
DEFAULT_MAX_TOKENS = 2000

# 工具不存在 / 执行出错时的回填文本
_NOT_FOUND_MSG = "Function {name} not found. Try again."
_EXEC_ERROR_MSG = "工具 {name} 执行出错，请换一种方式重试或向用户说明错误。"
_EMPTY_FINAL_MSG = "抱歉，我暂时无法完成这个任务，请换个说法再试一次。"

# usage 统一 schema 的各分项键（与 llm_client._extract_usage 对齐）
_USAGE_KEYS = ("input_tokens", "output_tokens", "cache_read_tokens",
               "cache_creation_tokens", "reasoning_tokens", "total_tokens")


def _merge_usage(acc, new):
    """累加多轮 LLM 调用的 usage（agent 模式每轮一份）。任一为 None 时保留另一份。"""
    if new is None:
        return acc
    if acc is None:
        return {k: int(new.get(k) or 0) for k in _USAGE_KEYS}
    for k in _USAGE_KEYS:
        acc[k] = int(acc.get(k) or 0) + int(new.get(k) or 0)
    return acc


async def run_agent_stream(
    *,
    system: str = "",
    messages: list,
    tools_names: Optional[list[str]] = None,
    max_tool_calls: int = DEFAULT_MAX_TOOL_CALLS,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    override: Optional[dict] = None,
    ctx: Optional[AgentContext] = None,
):
    """agent 主循环（流式版）：多轮 tool_calls 执行，边收边吐事件。

    Args:
        system: 系统提示词（透传给 LLMClient）。
        messages: 对话消息（role: user/assistant），内部会追加 assistant/tool 消息（不改调用方列表）。
        tools_names: 启用的工具名列表；None 表示全部已注册工具。
        max_tool_calls: 工具调用累计上限，达到后下一轮不再传 tools 强制直接回答。
        max_tokens: 每轮 LLM 调用输出上限（默认 2000，聊天链路传入档案解析值）。
        override: per-model 覆盖（base_url/api_key/protocol/model），透传 LLMClient。
        ctx: 工具执行上下文（session_id/user_id 等）。

    Yields:
        {"type": "chunk", "text": 增量文本} / {"type": "thinking", "text": 思考增量}：LLM 流式透传
        {"type": "tool_status", "name": 工具名, "status": "executing"}：执行工具前
        {"type": "tool_status", "name": 工具名, "status": "done", "result_len": N}：执行完
        {"type": "citations", "citations": [{"url", "title"}, ...]}：工具执行后新增的来源引用（仅增量）
        {"type": "done", "text": 最终文本回复, "thinking": 各轮思考过程合并}：最终回复

    Raises:
        LLMError: LLM 调用失败（含流式降级非流式重试后仍失败），由上层（chat.py）处理退款与报错。
        ValueError: messages 为空。
    """
    if not messages:
        raise ValueError("run_agent_stream: messages 不能为空")
    ctx = ctx or AgentContext()
    # 复制消息，避免污染调用方列表（后续要追加 assistant/tool 消息）
    work = [dict(m) for m in messages]

    thinking_parts: list[str] = []  # 每轮 LLM 的思考过程（agent 模式合并展示）
    total_usage = None  # 多轮 LLM 调用的 usage 累积（按 token 量扣费用）

    executed_calls = 0  # 已执行的工具调用累计数
    sent_citations = 0  # 已推送的来源引用条数（citations 事件只发增量）
    # 最多 max_tool_calls + 1 轮 LLM 调用：最后一轮不带 tools
    for _round in range(max_tool_calls + 1):
        send_tools = get_tools_schema(tools_names) if executed_calls < max_tool_calls else []
        round_text = ""
        round_thinking = ""
        round_calls: list = []
        round_error: Optional[str] = None
        try:
            async for event in LLMClient.stream_tools(
                system=system,
                messages=work,
                tools=send_tools or None,
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
                    # done 事件携带本轮完整文本/思考/tool_calls（覆盖增量累积值）
                    round_text = str(event.get("text") or "")
                    round_thinking = str(event.get("thinking") or "")
                    round_calls = event.get("tool_calls") or []
                    # 累积本轮 usage（多轮 agent 按 token 扣费需要总和）
                    total_usage = _merge_usage(total_usage, event.get("usage"))
                elif etype == "error":
                    round_error = str(event.get("detail") or "LLM 调用失败")
        except LLMError:
            raise

        if round_error:
            # 流式失败且降级非流式重试也失败 → 抛给上层（退款 + error 事件）
            raise LLMError(round_error)

        text = round_text
        calls = round_calls
        thinking = round_thinking.strip()
        if thinking:
            thinking_parts.append(thinking)
        logger.info(
            "[agent/loop] round=%d tool_calls=%d text_len=%d tools_enabled=%s",
            _round + 1, len(calls), len(text), bool(send_tools),
        )

        if not calls:
            # 无 tool_calls → 直接返回文本
            if text.strip():
                yield {"type": "done", "text": text, "thinking": "\n\n".join(thinking_parts), "usage": total_usage}
                return
            if not send_tools:
                # 已不再传 tools 仍无内容（理论上 stream_tools 已兜底），防御退出
                yield {"type": "done", "text": _EMPTY_FINAL_MSG, "thinking": "\n\n".join(thinking_parts), "usage": total_usage}
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

        for call in calls:
            name = str(call.get("name") or "").strip()
            call_id = str(call.get("id") or "")

            yield {"type": "tool_status", "name": name, "status": "executing"}

            # 参数：优先用 LLMClient 已解析的 dict，否则三级容错解析原始串
            args = call.get("arguments")
            if not isinstance(args, dict):
                args = safe_parse_arguments(call.get("arguments_raw"))
            if not isinstance(args, dict):
                args = {}

            tool = get_tool(name)
            if tool is None:
                result = _NOT_FOUND_MSG.format(name=name)
                logger.warning("[agent/loop] 工具 %r 未注册，回填错误信息", name)
            else:
                started = time.monotonic()
                try:
                    raw_result = await tool["handler"](args, ctx)
                    result = "" if raw_result is None else str(raw_result)
                except Exception:
                    logger.exception("[agent/loop] 工具 %r 执行异常", name)
                    result = _EXEC_ERROR_MSG.format(name=name)
                logger.info(
                    "[agent/loop] tool=%s duration_ms=%d result_len=%d",
                    name, int((time.monotonic() - started) * 1000), len(result),
                )

            yield {"type": "tool_status", "name": name, "status": "done", "result_len": len(result)}
            # 引用上报：工具执行后若 ctx 新增了来源引用，推送 citations 增量事件（每次只发新增部分）
            if len(ctx.citations) > sent_citations:
                yield {"type": "citations", "citations": ctx.citations[sent_citations:]}
                sent_citations = len(ctx.citations)
            work.append({"role": "tool", "tool_call_id": call_id, "content": result})
        executed_calls += len(calls)

    # 理论上已由「最后一轮不带 tools」保证返回；此处防御兜底
    logger.warning("[agent/loop] 达到最大轮数仍未得到文本回复，返回兜底文案")
    yield {"type": "done", "text": _EMPTY_FINAL_MSG, "thinking": "\n\n".join(thinking_parts), "usage": total_usage}


async def run_agent(
    *,
    system: str = "",
    messages: list,
    tools_names: Optional[list[str]] = None,
    max_tool_calls: int = DEFAULT_MAX_TOOL_CALLS,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    override: Optional[dict] = None,
    ctx: Optional[AgentContext] = None,
) -> dict:
    """agent 主循环（非流式薄包装）：收集 run_agent_stream 的全部事件，返回最终回复。

    Args:
        同 run_agent_stream（含 max_tokens）。

    Returns:
        {"text": 最终文本回复, "thinking": 各轮思考过程拼接（无则空串）}。

    Raises:
        LLMError: LLM 调用失败，由上层（chat.py）处理退款与报错。
        ValueError: messages 为空。
    """
    text = ""
    thinking = ""
    async for event in run_agent_stream(
        system=system,
        messages=messages,
        tools_names=tools_names,
        max_tool_calls=max_tool_calls,
        max_tokens=max_tokens,
        override=override,
        ctx=ctx,
    ):
        if event["type"] == "done":
            text = str(event.get("text") or "")
            thinking = str(event.get("thinking") or "")
    return {"text": text, "thinking": thinking}
