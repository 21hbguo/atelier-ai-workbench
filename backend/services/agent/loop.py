"""Agent 主循环（aibitat handleExecution 的轻量 Python 版）。

流程：组装 messages → LLMClient.stream_tools(tools=注册工具 schema) 流式多轮 →
无 tool_calls 返回文本；有 tool_calls 逐个执行（参数三级容错解析，handler 异常转错误文本）
→ 以 openai 格式 {"role":"tool","tool_call_id","content"} 回填 messages → 循环；
累计工具调用达 max_tool_calls 后下一轮不再传 tools，强制模型直接回答
（max_tool_calls=None 表示不限制工具调用次数）。

注意：回填格式为 openai 协议（assistant.tool_calls + role=tool）；
anthropic 协议下的 tool_result 转换由上层（调用方）负责。
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from itertools import count
from typing import Optional

from backend.services.agent.context import AgentContext
from backend.services.agent.parser import safe_parse_arguments, validate_tool_args
from backend.services.agent.registry import get_tool, get_tools_schema, list_tools
from backend.services.agent.sandbox import is_sandboxed, run_sandboxed
from backend.services.llm_client import LLMClient, LLMError

logger = logging.getLogger(__name__)

DEFAULT_MAX_TOOL_CALLS = 10
DEFAULT_MAX_TOKENS = 2000

# 工具结果预算（codex RolloutBudget 思路：总预算统一约束，取代单条硬截断）：
# 当轮工具结果总预算；单条结果超预算才截断兜底；累积超过 50% 注入软提示引导模型收敛
MAX_TOOL_RESULTS_TOTAL_CHARS = 60_000
_BUDGET_WARN_RATIO = 0.5  # 累积超过预算 50% 时注入预算提示（不截断内容）
# 预算已用尽后的兜底：后续工具结果压缩到这个更小的上限并提示收尾
_OVER_BUDGET_TOOL_RESULT_CHARS = 2_000
_BUDGET_EXHAUSTED_MSG = "\n（本轮工具结果预算已用尽，请基于已有信息继续；如需更多内容请明确告知用户。）"


# 工具不存在 / 执行出错时的回填文本
_NOT_FOUND_MSG = "Function {name} not found. Available tools: {available}."
_NOT_ALLOWED_MSG = "Function {name} is not available in the current session. Available tools: {available}."
# 参数校验失败：明确报错字段与原因，引导模型修正后重试（参照 openai-agents/smolagents 的
# 双层校验做法——不静默容错，错误即结果回填让模型自纠）
_ARGS_VALIDATION_MSG = (
    "工具 {name} 参数校验失败：{errors}。"
    "请按工具的 parameters 说明修正参数后重试，不要重复相同的错误。"
)
# 工具执行异常：回显工具名/参数/异常类型与消息（模型自纠的关键信息），并给出重试指引
_EXEC_ERROR_MSG = (
    "工具 {name} 执行失败（参数: {args}）：{err_type}: {err}。"
    "请修正后重试，不要重复相同的错误；若多次失败请换一种方式或向用户说明。"
)
_EMPTY_FINAL_MSG = "抱歉，我暂时无法完成这个任务，请换个说法再试一次。"


def _truncate_tool_result(text: str, limit: int) -> str:
    """截断保留头尾各半（兜底手段，正常路径靠预算软提示引导收敛）。

    参照 smolagents truncate_content；标记说明省略量并引导分页/定位，
    让模型能找回缺失内容，而不是只看到生硬的"被截断"。
    """
    text = "" if text is None else str(text)
    if len(text) <= limit:
        return text
    half = max(0, (limit - 160) // 2)  # 预留标记空间
    omitted = len(text) - half * 2
    mark = (
        f"\n…（结果较长，已省略中间约 {omitted} 字符，开头与结尾完整保留；"
        "需要中间内容请用 file_ops_read 的 offset/limit 分页或 file_ops_grep 定位）…\n"
    )
    return text[:half] + mark + text[-half:]


async def _dispatch_tool(tool: dict, args: dict, ctx) -> str:
    """沙箱名单内的工具走受限子进程执行，其余保持进程内。"""
    if is_sandboxed(tool["name"]):
        return await run_sandboxed(tool["name"], args, ctx)
    return await tool["handler"](args, ctx)


def _budget_hint(used: int) -> str:
    """预算软提示：追加在工具结果末尾，引导模型收敛（不截断内容）。"""
    remain = max(0, MAX_TOOL_RESULTS_TOTAL_CHARS - used)
    return (
        f"\n（预算提示：本轮工具结果累计约 {used} 字符，接近 {MAX_TOOL_RESULTS_TOTAL_CHARS} 上限，"
        f"剩余约 {remain}。后续获取内容请优先缩小范围或分页，避免挤占模型上下文。）"
    )

# usage 统一 schema 的各分项键（与 llm_client._extract_usage 对齐）
_USAGE_KEYS = ("input_tokens", "output_tokens", "cache_read_tokens",
               "cache_creation_tokens", "reasoning_tokens", "total_tokens")

# markdown 图片语法：![alt](url)（url 不含空白字符），用于收集生图工具返回的图片
_IMG_MARK_RE = re.compile(r"!\[[^\]]*\]\([^)\s]+\)")


def _mark_url(mark):
    """提取 markdown 图片标记中的 URL（最后一个圆括号内）。"""
    end = mark.rfind(")")
    if end < 0:
        return None
    start = mark.rfind("(", 0, end)
    if start < 0:
        return None
    return mark[start + 1:end].strip() or None


def _append_tool_images(text, marks):
    """把工具返回的 markdown 图片追加到最终回复文本（LLM 未主动贴图时兜底）。

    按图片 URL 去重：LLM 可能改写 alt 文本或给 URL 加 title，
    只要 URL 已出现在最终文本中就不再追加，避免重复展示。
    """
    if not marks:
        return text
    text = text or ""
    missing = []
    for m in marks:
        url = _mark_url(m)
        if url and url not in text:
            missing.append(m)
    if not missing:
        return text
    sep = "\n\n" if text.strip() else ""
    return text.rstrip() + sep + "\n".join(missing)


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
    max_tool_calls: Optional[int] = DEFAULT_MAX_TOOL_CALLS,
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
            None 表示不限制工具调用次数。
        max_tokens: 每轮 LLM 调用输出上限（默认 2000，聊天链路传入档案解析值）。
        override: per-model 覆盖（base_url/api_key/protocol/model），透传 LLMClient。
        ctx: 工具执行上下文（session_id/user_id 等）。

    Yields:
        {"type": "chunk", "text": 增量文本} / {"type": "thinking", "text": 思考增量}：LLM 流式透传
        {"type": "tool_status", "name": 工具名, "status": "executing"}：执行工具前
        {"type": "tool_status", "name": 工具名, "status": "done", "result_len": N}：执行完
        {"type": "image_task", "task_id": 任务ID, "status": "processing"}：生图任务超时仍在后台生成（只发一次）
        {"type": "heartbeat"}：工具执行超过 10s 未完成时的保活事件（上层可转 SSE 注释行）
        {"type": "citations", "citations": [{"url", "title"}, ...]}：工具执行后新增的来源引用（仅增量）
        {"type": "widget", "widget": {"kind", "title", "code"}}：工具执行后新增的画图 widget（仅增量）
        {"type": "file", "file": {"filename", "url", "size", "description"}}：工具执行后新增的可下载文件（仅增量）
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
    tool_image_marks: list[str] = []  # 生图类工具返回的 markdown 图片（最终回复缺失时自动追加）

    executed_calls = 0  # 已执行的工具调用累计数
    sent_citations = 0  # 已推送的来源引用条数（citations 事件只发增量）
    sent_widgets = 0  # 已推送的画图 widget 条数（widget 事件只发增量）
    sent_files = 0  # 已推送的可下载文件条数（file 事件只发增量）
    tool_results_total = 0  # 当轮已回填工具结果总字符数（预算记账）
    budget_hinted = False  # 预算软提示是否已注入（只注入一次，避免刷屏）

    def _append_tool_result(call_id: str, result: str) -> None:
        """回填 role=tool 消息：总预算记账（codex RolloutBudget 思路）。

        三层策略：
        1. 累积 ≤ 50% 预算：完整回填，不干预；
        2. 累积首超 50%：完整回填 + 注入预算软提示，引导模型收敛（不截断内容）；
        3. 预算已用尽或单条超预算：截断兜底（保留头尾 + 省略量说明），
           并提示模型基于已有信息继续。
        """
        nonlocal tool_results_total, budget_hinted
        result = "" if result is None else str(result)
        content = result
        if tool_results_total >= MAX_TOOL_RESULTS_TOTAL_CHARS:
            # 预算已用尽：压缩后续结果并提示收尾
            content = (
                _truncate_tool_result(result, _OVER_BUDGET_TOOL_RESULT_CHARS)
                + _BUDGET_EXHAUSTED_MSG
            )
        elif len(content) > MAX_TOOL_RESULTS_TOTAL_CHARS:
            # 单条结果超总预算：兜底截断（不做独立单条上限，由总预算统一约束）
            content = _truncate_tool_result(content, MAX_TOOL_RESULTS_TOTAL_CHARS)
        elif (
            not budget_hinted
            and tool_results_total + len(content) > MAX_TOOL_RESULTS_TOTAL_CHARS * _BUDGET_WARN_RATIO
        ):
            # 首次超过 50% 预算：完整回填 + 软提示引导模型收敛
            content += _budget_hint(tool_results_total + len(content))
            budget_hinted = True
        tool_results_total += len(content)
        work.append({"role": "tool", "tool_call_id": call_id, "content": content})
    # 最多 max_tool_calls + 1 轮 LLM 调用：最后一轮不带 tools；max_tool_calls=None 时不限制
    rounds = count() if max_tool_calls is None else range(max_tool_calls + 1)
    for _round in rounds:
        send_tools = get_tools_schema(tools_names) if max_tool_calls is None or executed_calls < max_tool_calls else []
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
                text = _append_tool_images(text, tool_image_marks)
                yield {"type": "done", "text": text, "thinking": "\n\n".join(thinking_parts), "usage": total_usage}
                return
            if not send_tools:
                # 已不再传 tools 仍无内容（理论上 stream_tools 已兜底），防御退出
                text = _append_tool_images(_EMPTY_FINAL_MSG, tool_image_marks)
                yield {"type": "done", "text": text, "thinking": "\n\n".join(thinking_parts), "usage": total_usage}
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
            # 候选工具名单（供"未找到/未开放"错误提示模型可用工具）
            available = tools_names if tools_names is not None else list_tools()
            available_str = ", ".join(available) or "(无)"
            if tool is None:
                result = _NOT_FOUND_MSG.format(name=name, available=available_str)
                logger.warning("[agent/loop] 工具 %r 未注册，回填错误信息", name)
            elif tools_names is not None and name not in tools_names:
                # 纵深防御：即使模型输出了本轮未开放的工签名，也拒绝执行
                result = _NOT_ALLOWED_MSG.format(name=name, available=available_str)
                logger.warning("[agent/loop] 工具 %r 不在本轮允许列表，拒绝执行", name)
            else:
                # 参数 schema 校验（错误即结果：校验失败回填错误文本，让模型自纠）
                arg_errors = validate_tool_args(tool.get("parameters"), args)
                if arg_errors:
                    result = _ARGS_VALIDATION_MSG.format(
                        name=name, errors="；".join(arg_errors[:5])
                    )
                    logger.warning("[agent/loop] 工具 %r 参数校验失败: %s", name, arg_errors)
                    yield {"type": "tool_status", "name": name, "status": "done", "result_len": len(result)}
                    # 校验失败的调用同样要回填 role=tool 消息（与正常路径一致），
                    # 让模型在下一轮看到错误并修正参数；continue 跳过 handler 执行
                    _append_tool_result(call_id, result)
                    continue
                started = time.monotonic()
                try:
                    # 工具执行期间（如生图最长约 100s）以 10s 为粒度轮询完成状态，
                    # 未完成时 yield heartbeat 事件供上层 SSE 保活（前端流不超时）。
                    handler_task = asyncio.ensure_future(_dispatch_tool(tool, args, ctx))
                    try:
                        while True:
                            done, _pending = await asyncio.wait({handler_task}, timeout=10.0)
                            if done:
                                raw_result = handler_task.result()
                                break
                            yield {"type": "heartbeat"}
                    finally:
                        # 生成器被提前关闭（客户端断连等）时取消未完成的工具任务，
                        # 避免 wait_generation_task 等长任务继续空耗事件循环
                        if not handler_task.done():
                            handler_task.cancel()
                    result = "" if raw_result is None else str(raw_result)
                except Exception as e:
                    logger.exception("[agent/loop] 工具 %r 执行异常", name)
                    result = _EXEC_ERROR_MSG.format(
                        name=name,
                        args=repr(args)[:500],
                        err_type=type(e).__name__,
                        err=str(e)[:300] or type(e).__name__,
                    )
                logger.info(
                    "[agent/loop] tool=%s duration_ms=%d result_len=%d",
                    name, int((time.monotonic() - started) * 1000), len(result),
                )

            yield {"type": "tool_status", "name": name, "status": "done", "result_len": len(result)}
            # 生图任务超时上报：image_gen 超时后置 ctx.image_task，推 image_task 事件
            # （前端据 task_id 轮询后台补图），推完即重置，保证只发一次
            if ctx.image_task:
                yield {"type": "image_task", **ctx.image_task}
                ctx.image_task = None
            # 生图类工具（image_gen）返回的 markdown 图片收集：部分 LLM 在「最后一轮不带 tools」
            # 时不会原样粘贴工具返回的图片链接，而是在最终回复前自动追加，保证图片一定展示
            if name == "image_gen" and result:
                for m in _IMG_MARK_RE.finditer(result):
                    mark = m.group(0)
                    if mark not in tool_image_marks:
                        tool_image_marks.append(mark)
            # 引用上报：工具执行后若 ctx 新增了来源引用，推送 citations 增量事件（每次只发新增部分）
            if len(ctx.citations) > sent_citations:
                yield {"type": "citations", "citations": ctx.citations[sent_citations:]}
                sent_citations = len(ctx.citations)
            # widget 上报：工具执行后若 ctx 新增了画图 widget，逐个推送 widget 增量事件
            while len(ctx.widgets) > sent_widgets:
                yield {"type": "widget", "widget": ctx.widgets[sent_widgets]}
                sent_widgets += 1
            # file 上报：工具执行后若 ctx 新增了可下载文件，逐个推送 file 增量事件
            while len(ctx.files) > sent_files:
                yield {"type": "file", "file": ctx.files[sent_files]}
                sent_files += 1
            _append_tool_result(call_id, result)
        executed_calls += len(calls)

    # 理论上已由「最后一轮不带 tools」保证返回；此处防御兜底
    logger.warning("[agent/loop] 达到最大轮数仍未得到文本回复，返回兜底文案")
    final_text = _append_tool_images(_EMPTY_FINAL_MSG, tool_image_marks)
    yield {"type": "done", "text": final_text, "thinking": "\n\n".join(thinking_parts), "usage": total_usage}


async def run_agent(
    *,
    system: str = "",
    messages: list,
    tools_names: Optional[list[str]] = None,
    max_tool_calls: Optional[int] = DEFAULT_MAX_TOOL_CALLS,
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
