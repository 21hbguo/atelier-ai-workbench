"""统一的 LLM 调用适配层。

支持两种主流协议，业务代码无需关心 HTTP 细节：
- OpenAI 兼容协议（DeepSeek / OpenAI / 各种中转站）: POST {base_url}/chat/completions, Authorization: Bearer
  - 思考强度：DeepSeek 官方端点发顶层 body["thinking"] = {"type": "enabled"} + 顶层 body["reasoning_effort"] = 档位（官方规范）；
    其余 OpenAI 兼容端点（中转代理等）发顶层 body["reasoning_effort"] = 档位
- Anthropic 协议: POST {base_url}/v1/messages, x-api-key + anthropic-version
  - 思考强度：body["thinking"] = {"type": "enabled", "budget_tokens": N}（按档位映射预算）

协议判定：配置 llm_protocol（openai/anthropic）显式指定；留空则按 base_url 是否含 "anthropic" 推断。

用法：
    text = await LLMClient.complete(system=SYSTEM_PROMPT, messages=[{"role":"user","content":...}], max_tokens=2000)
    async for event in LLMClient.stream(system=..., messages=..., reasoning_effort="high"):
        # event: {"type":"chunk","text":...} ... {"type":"done","text":完整} 或 {"type":"error","detail":...}
"""
import asyncio
import base64
import httpx
import json
import logging
import os
import time

from backend.config import get_llm_config

logger = logging.getLogger(__name__)

# Anthropic 协议下 reasoning_effort 档位 → thinking budget_tokens 映射
_ANTHROPIC_EFFORT_BUDGET = {
    "auto": 2048,
    "low": 1024,
    "medium": 2048,
    "high": 2048,
    "max": 4096,
    "xhigh": 4096,
}

# 图片扩展名 → media_type 推断映射（jpg→image/jpeg；识别不出时默认 image/png）
_IMAGE_EXT_MEDIA_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "bmp": "image/bmp",
}


class LLMError(Exception):
    """LLM 调用失败（非流式 complete 抛此异常；流式 stream 通过 error 事件上报）"""


class LLMClient:
    _client: httpx.AsyncClient | None = None

    # 流式「有效事件」空闲超时（秒）：只对 chunk/thinking/tool_calls 等有效增量重置，
    # SSE keep-alive（空行/注释行）不重置——防止服务端挂起但持续发心跳导致无限等待
    _STREAM_IDLE_TIMEOUT = 120.0

    # ---------- 生命周期 ----------

    @classmethod
    def _get_client(cls) -> httpx.AsyncClient:
        if cls._client is None or cls._client.is_closed:
            llm_cfg = get_llm_config()
            cls._client = httpx.AsyncClient(
                timeout=httpx.Timeout(float(llm_cfg["timeout_seconds"]), connect=5.0),
            )
        return cls._client

    @classmethod
    async def close(cls):
        if cls._client and not cls._client.is_closed:
            await cls._client.aclose()
            cls._client = None

    # ---------- 协议判定与请求构造 ----------

    @classmethod
    def protocol(cls, llm_cfg: dict | None = None) -> str:
        llm_cfg = llm_cfg or get_llm_config()
        p = str(llm_cfg.get("protocol") or "").lower()
        if p in ("openai", "anthropic"):
            return p
        base = str(llm_cfg.get("base_url") or "").lower()
        return "anthropic" if "anthropic" in base else "openai"

    # ---------- 图片消息块归一化 ----------
    # 统一输入格式（调用方构造）：
    #   {"type": "text", "text": "..."}
    #   {"type": "image", "url": "https://..."}             外链，URL 原样透传
    #   {"type": "image", "data": "<base64裸串>", "media_type": "image/png"}   base64 数据
    #   {"type": "image", "path": "/abs/path.png"}          本地文件，内部读文件转 base64
    # media_type 未给时按扩展名推断（jpg→image/jpeg），推断不出默认 image/png。

    @staticmethod
    def _infer_image_media_type(path: str) -> str:
        """按文件扩展名推断 media_type；无法识别时默认 image/png。"""
        ext = os.path.splitext(path)[1].lower().lstrip(".")
        return _IMAGE_EXT_MEDIA_TYPES.get(ext, "image/png")

    @staticmethod
    def _convert_image_block(block: dict, proto: str) -> dict:
        """把统一格式的 image 块转换为目标协议格式。
        - OpenAI: {"type":"image_url","image_url":{"url":...}}（base64 场景为 data: URL）
        - Anthropic: {"type":"image","source":{"type":"base64"|"url",...}}
        本地文件 path 同步读取转 base64（本方法在同步上下文 _build_request 内调用）；
        文件不存在或读取失败抛 LLMError（带明确中文错误信息），不静默忽略。
        """
        url = block.get("url")
        if url:
            if proto == "anthropic":
                return {"type": "image", "source": {"type": "url", "url": url}}
            return {"type": "image_url", "image_url": {"url": url}}

        data = block.get("data")
        if data is not None:
            media_type = block.get("media_type") or "image/png"
            if proto == "anthropic":
                return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}}
            return {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{data}"}}

        path = block.get("path")
        if path:
            try:
                with open(path, "rb") as f:
                    raw = f.read()
            except FileNotFoundError:
                raise LLMError(f"图片文件不存在: {path}") from None
            except OSError as e:
                raise LLMError(f"读取图片文件失败: {path}（{e}）") from e
            b64 = base64.b64encode(raw).decode("ascii")
            media_type = block.get("media_type") or LLMClient._infer_image_media_type(path)
            if proto == "anthropic":
                return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}}
            return {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64}"}}

        raise LLMError(f"image 块缺少 url/data/path 字段: {block}")

    @staticmethod
    def _normalize_messages(messages: list, proto: str) -> list:
        """消息归一化：content 为 str 时原样保留（向后兼容）；content 为 list 时
        把 image 块转换为协议格式，text 块及其它未知块原样透传。"""
        out = []
        for msg in messages or []:
            content = msg.get("content")
            if not isinstance(content, list):
                out.append(msg)
                continue
            new_msg = dict(msg)
            new_content = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "image":
                    new_content.append(LLMClient._convert_image_block(block, proto))
                else:
                    new_content.append(block)
            new_msg["content"] = new_content
            out.append(new_msg)
        return out

    @classmethod
    def _build_request(cls, llm_cfg: dict, system: str, messages: list, max_tokens: int,
                       reasoning_effort: str, temperature: float | None, extra_body: dict | None,
                       tools: list | None = None):
        """返回 (url, headers, body)。messages 不含 system。
        tools: 统一格式 [{"name","description","parameters"(JSON Schema)}]，内部按协议转换：
        - OpenAI: {"type":"function","function":{name,description,parameters}}
        - Anthropic: {name, description, input_schema}"""
        base = str(llm_cfg.get("base_url") or "").rstrip("/")
        api_key = str(llm_cfg.get("api_key") or "")
        proto = cls.protocol(llm_cfg)
        extra_body = dict(extra_body or {})
        # 图片消息块归一化（content 为 str 的消息原样透传）
        messages = cls._normalize_messages(messages, proto)

        if proto == "anthropic":
            url = f"{base}/v1/messages"
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            body = {
                "model": llm_cfg.get("model"),
                "max_tokens": max(int(max_tokens or 0), 1),
                "messages": messages,
            }
            if system:
                body["system"] = system
            if tools:
                body["tools"] = [
                    {
                        "name": t["name"],
                        "description": t.get("description") or "",
                        "input_schema": t.get("parameters") or {"type": "object", "properties": {}},
                    }
                    for t in tools
                ]
            if reasoning_effort and reasoning_effort != "auto":
                body["thinking"] = {
                    "type": "enabled",
                    "budget_tokens": _ANTHROPIC_EFFORT_BUDGET.get(reasoning_effort, 2048),
                }
        else:
            url = f"{base}/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            body = {
                "model": llm_cfg.get("model"),
                "max_tokens": max(int(max_tokens or 0), 1),
                "messages": ([{"role": "system", "content": system}] if system else []) + list(messages),
            }
            if tools:
                body["tools"] = [
                    {
                        "type": "function",
                        "function": {
                            "name": t["name"],
                            "description": t.get("description") or "",
                            "parameters": t.get("parameters") or {"type": "object", "properties": {}},
                        },
                    }
                    for t in tools
                ]
            if reasoning_effort and reasoning_effort != "auto":
                if "deepseek" in base:
                    # DeepSeek 官方 API：顶层 thinking 开关 + 顶层 reasoning_effort 并列（官方规范，
                    # 见 api-docs.deepseek.com/guides/thinking_mode）
                    body["thinking"] = {"type": "enabled"}
                    body["reasoning_effort"] = reasoning_effort
                else:
                    # OpenAI 原生/中转代理：顶层 reasoning_effort（代理可能忽略嵌套 thinking）
                    body["reasoning_effort"] = reasoning_effort
        if temperature is not None:
            body["temperature"] = temperature
        body.update(extra_body)
        return url, headers, body

    # ---------- 响应解析 ----------

    @staticmethod
    def _extract_text(data: dict) -> str:
        """非流式响应取文本（openai: choices[0].message.content；anthropic: content[].text）"""
        choices = data.get("choices") or []
        if choices and choices[0].get("message"):
            return choices[0]["message"].get("content") or ""
        for block in data.get("content", []) or []:
            if block.get("type") == "text":
                return block.get("text") or ""
        return ""

    @staticmethod
    def _extract_delta(event: dict) -> str:
        """流式事件取增量文本（openai: choices[0].delta.content；anthropic: content_block_delta.text_delta）"""
        choices = event.get("choices") or []
        if choices:
            delta = (choices[0] or {}).get("delta") or {}
            return delta.get("content") or ""
        if event.get("type") == "content_block_delta":
            delta = event.get("delta") or {}
            if delta.get("type") == "text_delta":
                return delta.get("text") or ""
        return ""

    @staticmethod
    def _extract_thinking_delta(event: dict) -> str:
        """流式事件取 thinking（思考过程）增量：
        - openai 兼容（DeepSeek 等）: choices[0].delta.reasoning_content
        - anthropic: content_block_delta 中 type=thinking_delta 的 thinking
        """
        choices = event.get("choices") or []
        if choices:
            delta = (choices[0] or {}).get("delta") or {}
            rc = delta.get("reasoning_content")
            if isinstance(rc, str):
                return rc
            # 部分实现用 reasoning 字段
            reasoning = delta.get("reasoning")
            if isinstance(reasoning, str):
                return reasoning
            return ""
        if event.get("type") == "content_block_delta":
            delta = event.get("delta") or {}
            if delta.get("type") == "thinking_delta":
                return delta.get("thinking") or ""
        return ""

    @staticmethod
    def _extract_thinking(data: dict, proto: str) -> str:
        """非流式响应提取 thinking（思考过程）全文：
        - openai 兼容（DeepSeek）: choices[0].message.reasoning_content
        - anthropic: content[] 中 type=="thinking" 的块拼接
        """
        parts = []
        if proto == "anthropic":
            for block in data.get("content", []) or []:
                if block.get("type") == "thinking":
                    parts.append(block.get("thinking") or "")
            return "".join(parts)
        for choice in data.get("choices") or []:
            msg = choice.get("message") or {}
            rc = msg.get("reasoning_content")
            if isinstance(rc, str) and rc:
                parts.append(rc)
        return "".join(parts)

    @staticmethod
    def _extract_tool_call_deltas(event: dict) -> list:
        """流式事件取 delta.tool_calls 增量（openai 兼容协议，如 DeepSeek/Kimi）。

        返回 [{"index": int, "id": str|None, "name": str|None, "arguments": str|None}]：
        - index 区分同一轮多个并行 tool call
        - id/type 仅在对应分片首次出现时携带，name 同样只在首片出现
        - arguments 为 JSON 字符串的逐块增量，需要按 index 拼接成完整串
        anthropic 流式协议（content_block_delta）无此字段，返回 []。
        """
        choices = event.get("choices") or []
        if not choices:
            return []
        delta = (choices[0] or {}).get("delta") or {}
        out = []
        for tc in delta.get("tool_calls") or []:
            fn = tc.get("function") or {}
            out.append({
                "index": tc.get("index"),
                "id": tc.get("id"),
                "name": fn.get("name"),
                "arguments": fn.get("arguments"),
            })
        return out

    @staticmethod
    def _extract_tool_calls(data: dict, proto: str) -> list:
        """非流式响应提取 tool calls，统一格式 [{"id","name","arguments"(dict|None),"arguments_raw"(str)}]。
        - openai: choices[0].message.tool_calls[].function（arguments 为 JSON 字符串，解析失败时 arguments=None）
        - anthropic: content[] 中 type=="tool_use" 的 block（input 已为 dict）"""
        calls = []
        if proto == "anthropic":
            for block in data.get("content", []) or []:
                if block.get("type") != "tool_use":
                    continue
                args = block.get("input")
                if not isinstance(args, dict):
                    args = {}
                calls.append({
                    "id": block.get("id") or "",
                    "name": block.get("name") or "",
                    "arguments": args,
                    "arguments_raw": json.dumps(args, ensure_ascii=False),
                })
            return calls
        for choice in data.get("choices") or []:
            msg = choice.get("message") or {}
            for tc in msg.get("tool_calls") or []:
                fn = tc.get("function") or {}
                raw = fn.get("arguments") or "{}"
                try:
                    parsed = json.loads(raw)
                    if not isinstance(parsed, dict):
                        parsed = None
                except json.JSONDecodeError:
                    parsed = None
                calls.append({
                    "id": tc.get("id") or "",
                    "name": fn.get("name") or "",
                    "arguments": parsed,
                    "arguments_raw": raw,
                })
        return calls

    # ---------- usage 解析 ----------

    @staticmethod
    def _extract_usage_openai(usage_dict: dict | None) -> dict | None:
        """OpenAI 协议 usage 解析为统一 schema。
        OpenAI 的 prompt_tokens 实际包含 cached_tokens，需扣除得到纯输入 token。"""
        if not usage_dict:
            return None
        try:
            prompt_tokens = int(usage_dict.get("prompt_tokens") or 0)
            completion_tokens = int(usage_dict.get("completion_tokens") or 0)
            prompt_details = usage_dict.get("prompt_tokens_details") or {}
            completion_details = usage_dict.get("completion_tokens_details") or {}
            # 缓存读取字段不统一，需多来源兜底：
            # - OpenAI 官方 / Azure：usage.prompt_tokens_details.cached_tokens
            # - DeepSeek / Kimi 等 OpenAI 兼容实现：usage.prompt_cache_hit_tokens（顶层字段）
            cache_read = int(
                prompt_details.get("cached_tokens")
                or usage_dict.get("prompt_cache_hit_tokens")
                or 0
            )
            # 缓存写入：GPT-5.6+ / Azure 新增 prompt_tokens_details.cache_write_tokens
            cache_write = int(prompt_details.get("cache_write_tokens") or 0)
            reasoning = int(completion_details.get("reasoning_tokens") or 0)
            # OpenAI 的 prompt_tokens 包含 cached_tokens，扣除得到纯输入
            # （DeepSeek 的 prompt_tokens = prompt_cache_hit_tokens + prompt_cache_miss_tokens，扣后即未命中部分）
            input_tokens = max(prompt_tokens - cache_read, 0)
            total = int(usage_dict.get("total_tokens") or 0) or (input_tokens + completion_tokens + cache_read + cache_write)
            return {
                "input_tokens": input_tokens,
                "output_tokens": completion_tokens,
                "cache_read_tokens": cache_read,
                "cache_creation_tokens": cache_write,
                "reasoning_tokens": reasoning,
                "total_tokens": total,
            }
        except Exception:
            logger.warning("[llm_client] OpenAI usage 解析失败: %r", usage_dict)
            return None

    @staticmethod
    def _extract_usage_anthropic(usage_dict: dict | None) -> dict | None:
        """Anthropic 协议 usage 解析为统一 schema。
        Anthropic 的 input_tokens 本身不含缓存；缓存读/写分别在
        cache_read_input_tokens / cache_creation_input_tokens。"""
        if not usage_dict:
            return None
        try:
            input_tokens = int(usage_dict.get("input_tokens") or 0)
            # 流式 message_start 阶段 output_tokens 可能尚为 0，message_delta 会覆盖为累积值
            output_tokens = int(usage_dict.get("output_tokens") or 0)
            cache_read = int(usage_dict.get("cache_read_input_tokens") or 0)
            cache_creation = int(usage_dict.get("cache_creation_input_tokens") or 0)
            total = input_tokens + output_tokens + cache_read + cache_creation
            return {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_read_tokens": cache_read,
                "cache_creation_tokens": cache_creation,
                "reasoning_tokens": 0,  # Anthropic 暂无独立 reasoning 字段
                "total_tokens": total,
            }
        except Exception:
            logger.warning("[llm_client] Anthropic usage 解析失败: %r", usage_dict)
            return None

    @classmethod
    def _extract_usage(cls, proto: str, usage_dict: dict | None) -> dict | None:
        """按协议分派 usage 解析，返回统一 schema；上游未返回 usage 时为 None。"""
        if proto == "anthropic":
            return cls._extract_usage_anthropic(usage_dict)
        return cls._extract_usage_openai(usage_dict)

    # ---------- 统一入口 ----------

    @classmethod
    async def complete_tools(cls, *, system: str = "", messages: list | None = None,
                             tools: list | None = None, max_tokens: int = 2000,
                             reasoning_effort: str = "auto", temperature: float | None = None,
                             extra_body: dict | None = None, override: dict | None = None) -> dict:
        """带 tools（function calling）的非流式调用，供 agent 工具系统使用。

        tools: [{"name","description","parameters"(JSON Schema)}]（统一格式，内部按协议转换）
        返回 {"text": str, "tool_calls": [...]}；tool_calls 元素 {"id","name","arguments","arguments_raw"}。
        - arguments: 解析好的 dict；JSON 解析失败时为 None（arguments_raw 保留原始串，由上层容错重试）
        - text: 纯文本回复（无 tool_calls 时），可能与 tool_calls 并存（部分模型会同时输出）
        失败抛 LLMError。
        """
        llm_cfg = dict(get_llm_config())
        if override:
            for k in ("base_url", "api_key", "protocol", "model", "timeout_seconds"):
                if override.get(k):
                    llm_cfg[k] = override[k]
            if override.get("enabled") is not None:
                llm_cfg["enabled"] = override["enabled"]
        if not llm_cfg["enabled"] or not llm_cfg.get("api_key"):
            raise LLMError("LLM 服务未配置或未启用，请联系管理员")
        if not messages:
            raise LLMError("消息内容为空")

        proto = cls.protocol(llm_cfg)
        url, headers, body = cls._build_request(
            llm_cfg, system, messages, max_tokens, reasoning_effort, temperature, extra_body,
            tools=tools,
        )
        try:
            client = cls._get_client()
            timeout = httpx.Timeout(float(llm_cfg["timeout_seconds"]), connect=5.0)
            resp = await client.post(url, headers=headers, json=body, timeout=timeout)
            resp.raise_for_status()
            data = resp.json()
            text = cls._extract_text(data)
            tool_calls = cls._extract_tool_calls(data, proto)
            thinking = cls._extract_thinking(data, proto)
            if not text.strip() and not tool_calls:
                raise LLMError("LLM 暂无返回内容，请重试")
            # usage: 上游未返回则为 None（调用方可用于按量计费/统计，本次不影响按次扣费）
            return {"text": text, "tool_calls": tool_calls, "thinking": thinking,
                    "usage": cls._extract_usage(proto, data.get("usage"))}
        except httpx.TimeoutException:
            logger.warning("[llm_client] LLM API timeout (complete_tools)")
            raise LLMError("请求超时，请重试")
        except LLMError:
            raise
        except Exception:
            logger.exception("[llm_client] LLM API call failed (complete_tools)")
            raise LLMError("LLM 调用失败，请重试")

    @classmethod
    async def complete(cls, *, system: str = "", messages: list | None = None,
                       max_tokens: int = 2000, reasoning_effort: str = "auto",
                       temperature: float | None = None, extra_body: dict | None = None,
                       override: dict | None = None) -> str:
        """非流式调用，返回完整文本。失败抛 LLMError。
        override: 可选 per-model 覆盖（base_url/api_key/protocol/model/timeout_seconds），留空用全局配置。"""
        async for event in cls._stream_impl(system=system, messages=messages or [],
                                            max_tokens=max_tokens, reasoning_effort=reasoning_effort,
                                            temperature=temperature, extra_body=extra_body, stream=False,
                                            override=override):
            if event["type"] == "done":
                return event["text"]
            if event["type"] == "error":
                raise LLMError(event["detail"])
        raise LLMError("LLM 无返回内容")

    @classmethod
    async def stream(cls, *, system: str = "", messages: list | None = None,
                     max_tokens: int = 2000, reasoning_effort: str = "auto",
                     temperature: float | None = None, extra_body: dict | None = None,
                     override: dict | None = None):
        """流式调用，yield {"type":"chunk","text":...} … {"type":"done","text":...} / {"type":"error","detail":...}
        override: 可选 per-model 覆盖（base_url/api_key/protocol/model/timeout_seconds），留空用全局配置。"""
        async for event in cls._stream_impl(system=system, messages=messages or [],
                                            max_tokens=max_tokens, reasoning_effort=reasoning_effort,
                                            temperature=temperature, extra_body=extra_body, stream=True,
                                            override=override):
            yield event

    @classmethod
    async def stream_tools(cls, *, system: str = "", messages: list | None = None,
                           tools: list | None = None, max_tokens: int = 2000,
                           reasoning_effort: str = "auto", temperature: float | None = None,
                           override: dict | None = None):
        """带 tools（function calling）的流式调用，供 agent 工具系统使用。

        tools: [{"name","description","parameters"(JSON Schema)}]（统一格式，与 complete_tools 一致）。
        产出事件：
        - {"type":"chunk","text":增量文本}
        - {"type":"thinking","text":思考增量}
        - {"type":"done","text":完整文本,"thinking":思考(有则带),"tool_calls":[...]}（tool_calls 格式同 complete_tools）
        - {"type":"error","detail":...}

        流式调用失败（异常）时自动降级：同一轮改用 complete_tools 非流式重试一次，
        成功则 yield done；重试仍失败才 yield error（保底逻辑，用户无感）。
        前置校验类错误（未配置/空消息）重试无意义，直接透传 error。
        """
        async for event in cls._stream_impl(system=system, messages=messages or [],
                                            max_tokens=max_tokens, reasoning_effort=reasoning_effort,
                                            temperature=temperature, extra_body=None, stream=True,
                                            tools=tools, override=override):
            if event["type"] != "error":
                yield event
                continue
            detail = str(event.get("detail") or "")
            if "未配置" in detail or "消息内容为空" in detail:
                yield event
                return
            # 流式失败 → 降级非流式重试一次（同一轮、同一 tools）
            try:
                resp = await cls.complete_tools(
                    system=system, messages=messages or [], tools=tools,
                    max_tokens=max_tokens, reasoning_effort=reasoning_effort,
                    temperature=temperature, override=override,
                )
            except LLMError:
                yield event  # 重试也失败 → 透传流式 error
                return
            done = {"type": "done", "text": str(resp.get("text") or ""),
                    "tool_calls": resp.get("tool_calls") or []}
            thinking = str(resp.get("thinking") or "")
            if thinking:
                done["thinking"] = thinking
            # 降级非流式重试时也把 usage 透传出去（保持与流式 done 一致）
            if resp.get("usage") is not None:
                done["usage"] = resp.get("usage")
            yield done
            return

    @classmethod
    async def _stream_impl(cls, *, system, messages, max_tokens, reasoning_effort,
                           temperature, extra_body, stream: bool, override: dict | None = None,
                           tools: list | None = None):
        llm_cfg = dict(get_llm_config())
        # per-model 覆盖：模型档案填了 base_url/api_key/protocol 等则优先使用
        if override:
            for k in ("base_url", "api_key", "protocol", "model", "timeout_seconds"):
                if override.get(k):
                    llm_cfg[k] = override[k]
            if override.get("enabled") is not None:
                llm_cfg["enabled"] = override["enabled"]
        if not llm_cfg["enabled"] or not llm_cfg.get("api_key"):
            yield {"type": "error", "detail": "LLM 服务未配置或未启用，请联系管理员"}
            return
        if not messages:
            yield {"type": "error", "detail": "消息内容为空"}
            return

        proto = cls.protocol(llm_cfg)
        url, headers, body = cls._build_request(
            llm_cfg, system, messages, max_tokens, reasoning_effort, temperature, extra_body,
            tools=tools,
        )
        if stream:
            body["stream"] = True
            # OpenAI 协议下显式要求最后一个 chunk 携带 usage（choices 为空的那一片）
            # Anthropic 不支持此字段，避免污染请求体
            if proto == "openai":
                body["stream_options"] = {"include_usage": True}

        try:
            client = cls._get_client()
            timeout = httpx.Timeout(float(llm_cfg["timeout_seconds"]), connect=5.0)
            if stream:
                full_text = ""
                full_thinking = ""
                # delta.tool_calls 按 index 分片：内部先按 index 累积 id/name/arguments 字符串
                tool_calls_buf: dict[int, dict] = {}
                # usage 原始字段累积：OpenAI 在最后一片 choices=[] 的 chunk 里整体给出；
                # Anthropic 在 message_start 给输入/缓存、message_delta 给累积输出
                usage_raw: dict | None = None
                async with client.stream("POST", url, headers=headers, json=body, timeout=timeout) as resp:
                    resp.raise_for_status()
                    lines = resp.aiter_lines()
                    last_activity = time.monotonic()
                    while True:
                        # 有效事件空闲超时：只对「有效 delta」重置计时，SSE keep-alive
                        # （空行/注释行）不重置——根治服务端挂起但持续发心跳导致的无限等待
                        remaining = cls._STREAM_IDLE_TIMEOUT - (time.monotonic() - last_activity)
                        if remaining <= 0:
                            logger.warning("[llm_client] 流式响应无有效增量超过 %.0fs，主动断开", cls._STREAM_IDLE_TIMEOUT)
                            yield {"type": "error", "detail": "模型长时间无响应，已中断，请重试或降低思考强度"}
                            break
                        try:
                            line = await asyncio.wait_for(lines.__anext__(), timeout=remaining)
                        except StopAsyncIteration:
                            break  # 服务端正常结束流
                        except asyncio.TimeoutError:
                            logger.warning("[llm_client] 流式响应空闲超时（%.0fs 无有效增量）", cls._STREAM_IDLE_TIMEOUT)
                            yield {"type": "error", "detail": "模型长时间无响应，已中断，请重试或降低思考强度"}
                            break
                        if not line.startswith("data: "):
                            continue  # keep-alive/注释行：不重置计时
                        data_str = line[6:]
                        if data_str.strip() == "[DONE]":
                            break
                        try:
                            event = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        # usage 采集：
                        # - OpenAI: 最后一个 chunk choices 为空但带 usage，直接整体覆盖
                        # - Anthropic: message_start.message.usage 含输入/缓存；message_delta.usage.output_tokens 为累积输出
                        if proto == "anthropic":
                            etype = event.get("type")
                            if etype == "message_start":
                                usage_raw = dict((event.get("message") or {}).get("usage") or {})
                            elif etype == "message_delta":
                                u = event.get("usage") or {}
                                if usage_raw is None:
                                    usage_raw = {}
                                if "output_tokens" in u:
                                    usage_raw["output_tokens"] = u["output_tokens"]
                        else:
                            if event.get("usage"):
                                usage_raw = event["usage"]
                        text = cls._extract_delta(event)
                        if text:
                            full_text += text
                            last_activity = time.monotonic()
                            yield {"type": "chunk", "text": text}
                        thinking = cls._extract_thinking_delta(event)
                        if thinking:
                            full_thinking += thinking
                            last_activity = time.monotonic()
                            yield {"type": "thinking", "text": thinking}
                        for d in cls._extract_tool_call_deltas(event):
                            idx = d.get("index")
                            if idx is None:
                                continue
                            buf = tool_calls_buf.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                            if d.get("id"):
                                buf["id"] = d["id"]
                            if d.get("name"):
                                buf["name"] = d["name"]
                            if d.get("arguments"):
                                buf["arguments"] += d["arguments"]
                            last_activity = time.monotonic()
                # 统一格式 [{id,name,arguments(dict|None),arguments_raw}]，复用 _extract_tool_calls 的 JSON 解析容错思路
                full_tool_calls = []
                for idx in sorted(tool_calls_buf):
                    b = tool_calls_buf[idx]
                    raw = b["arguments"] or "{}"
                    try:
                        parsed = json.loads(raw)
                        if not isinstance(parsed, dict):
                            parsed = None
                    except json.JSONDecodeError:
                        parsed = None
                    full_tool_calls.append({
                        "id": b["id"],
                        "name": b["name"],
                        "arguments": parsed,
                        "arguments_raw": raw,
                    })
                # 纯工具调用轮（无文本/思考）不算空返回
                if not full_text.strip() and not full_thinking.strip() and not full_tool_calls:
                    yield {"type": "error", "detail": "LLM 暂无返回内容，请重试"}
                    return
                done_event = {"type": "done", "text": full_text, "tool_calls": full_tool_calls}
                if full_thinking:
                    done_event["thinking"] = full_thinking
                # usage: 上游未返回 usage 则为 None
                done_event["usage"] = cls._extract_usage(proto, usage_raw)
                yield done_event
            else:
                resp = await client.post(url, headers=headers, json=body, timeout=timeout)
                resp.raise_for_status()
                data = resp.json()
                text = cls._extract_text(data)
                if not text.strip():
                    yield {"type": "error", "detail": "LLM 暂无返回内容，请重试"}
                    return
                # 非流式：usage 直接从响应顶层取（OpenAI/Anthropic 均在 data["usage"]）
                yield {"type": "done", "text": text, "usage": cls._extract_usage(proto, data.get("usage"))}
        except httpx.TimeoutException:
            logger.warning("[llm_client] LLM API timeout")
            yield {"type": "error", "detail": "请求超时，请重试"}
        except Exception:
            logger.exception("[llm_client] LLM API call failed")
            yield {"type": "error", "detail": "LLM 调用失败，请重试"}
