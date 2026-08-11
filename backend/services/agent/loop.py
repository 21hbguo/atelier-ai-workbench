"""Agent 主循环（aibitat handleExecution 的轻量 Python 版）。

流程：组装 messages → LLMClient.complete_tools(tools=注册工具 schema) →
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


async def run_agent(
    *,
    system: str = "",
    messages: list,
    tools_names: Optional[list[str]] = None,
    max_tool_calls: int = DEFAULT_MAX_TOOL_CALLS,
    override: Optional[dict] = None,
    ctx: Optional[AgentContext] = None,
) -> str:
    """agent 主循环：多轮 tool_calls 执行，返回最终文本回复。

    Args:
        system: 系统提示词（透传给 LLMClient）。
        messages: 对话消息（role: user/assistant），内部会追加 assistant/tool 消息（不改调用方列表）。
        tools_names: 启用的工具名列表；None 表示全部已注册工具。
        max_tool_calls: 工具调用累计上限，达到后下一轮不再传 tools 强制直接回答。
        override: per-model 覆盖（base_url/api_key/protocol/model），透传 LLMClient。
        ctx: 工具执行上下文（session_id/user_id 等）。

    Returns:
        最终文本回复。

    Raises:
        LLMError: LLM 调用失败（未配置/超时/无返回），由上层（chat.py）处理退款与报错。
        ValueError: messages 为空。
    """
    if not messages:
        raise ValueError("run_agent: messages 不能为空")
    ctx = ctx or AgentContext()
    # 复制消息，避免污染调用方列表（后续要追加 assistant/tool 消息）
    work = [dict(m) for m in messages]

    executed_calls = 0  # 已执行的工具调用累计数
    # 最多 max_tool_calls + 1 轮 LLM 调用：最后一轮不带 tools
    for _round in range(max_tool_calls + 1):
        send_tools = get_tools_schema(tools_names) if executed_calls < max_tool_calls else []
        try:
            resp = await LLMClient.complete_tools(
                system=system,
                messages=work,
                tools=send_tools or None,
                max_tokens=DEFAULT_MAX_TOKENS,
                reasoning_effort="auto",
                temperature=None,
                override=override,
            )
        except LLMError:
            raise

        text = str(resp.get("text") or "")
        calls = resp.get("tool_calls") or []
        logger.info(
            "[agent/loop] round=%d tool_calls=%d text_len=%d tools_enabled=%s",
            _round + 1, len(calls), len(text), bool(send_tools),
        )

        if not calls:
            # 无 tool_calls → 直接返回文本
            if text.strip():
                return text
            if not send_tools:
                # 已不再传 tools 仍无内容（理论上 complete_tools 已兜底），防御退出
                return _EMPTY_FINAL_MSG
            continue  # 防御：空响应再走一轮

        # 有 tool_calls：先回填 assistant 消息（openai 协议要求 id/function 与 tool 消息对应）
        assistant_msg: dict = {"role": "assistant", "content": text or None}
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

            work.append({"role": "tool", "tool_call_id": call_id, "content": result})
        executed_calls += len(calls)

    # 理论上已由「最后一轮不带 tools」保证返回；此处防御兜底
    logger.warning("[agent/loop] 达到最大轮数仍未得到文本回复，返回兜底文案")
    return _EMPTY_FINAL_MSG
