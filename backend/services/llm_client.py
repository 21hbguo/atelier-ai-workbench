"""统一的 LLM 调用适配层。

支持两种主流协议，业务代码无需关心 HTTP 细节：
- OpenAI 兼容协议（DeepSeek / OpenAI / 各种中转站）: POST {base_url}/chat/completions, Authorization: Bearer
  - 思考强度：body["thinking"] = {"type": "enabled", "reasoning_effort": low|medium|high|max|xhigh}
- Anthropic 协议: POST {base_url}/v1/messages, x-api-key + anthropic-version
  - 思考强度：body["thinking"] = {"type": "enabled", "budget_tokens": N}（按档位映射预算）

协议判定：配置 llm_protocol（openai/anthropic）显式指定；留空则按 base_url 是否含 "anthropic" 推断。

用法：
    text = await LLMClient.complete(system=SYSTEM_PROMPT, messages=[{"role":"user","content":...}], max_tokens=2000)
    async for event in LLMClient.stream(system=..., messages=..., reasoning_effort="high"):
        # event: {"type":"chunk","text":...} ... {"type":"done","text":完整} 或 {"type":"error","detail":...}
"""
import httpx
import json
import logging

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


class LLMError(Exception):
    """LLM 调用失败（非流式 complete 抛此异常；流式 stream 通过 error 事件上报）"""


class LLMClient:
    _client: httpx.AsyncClient | None = None

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

    @classmethod
    def _build_request(cls, llm_cfg: dict, system: str, messages: list, max_tokens: int,
                       reasoning_effort: str, temperature: float | None, extra_body: dict | None):
        """返回 (url, headers, body)。messages 不含 system。"""
        base = str(llm_cfg.get("base_url") or "").rstrip("/")
        api_key = str(llm_cfg.get("api_key") or "")
        proto = cls.protocol(llm_cfg)
        extra_body = dict(extra_body or {})

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
            if reasoning_effort and reasoning_effort != "auto":
                body["thinking"] = {"type": "enabled", "reasoning_effort": reasoning_effort}
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

    # ---------- 统一入口 ----------

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
    async def _stream_impl(cls, *, system, messages, max_tokens, reasoning_effort,
                           temperature, extra_body, stream: bool, override: dict | None = None):
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

        url, headers, body = cls._build_request(
            llm_cfg, system, messages, max_tokens, reasoning_effort, temperature, extra_body,
        )
        if stream:
            body["stream"] = True

        try:
            client = cls._get_client()
            timeout = httpx.Timeout(float(llm_cfg["timeout_seconds"]), connect=5.0)
            if stream:
                full_text = ""
                async with client.stream("POST", url, headers=headers, json=body, timeout=timeout) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:]
                        if data_str.strip() == "[DONE]":
                            break
                        try:
                            event = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        text = cls._extract_delta(event)
                        if text:
                            full_text += text
                            yield {"type": "chunk", "text": text}
                if not full_text.strip():
                    yield {"type": "error", "detail": "LLM 暂无返回内容，请重试"}
                    return
                yield {"type": "done", "text": full_text}
            else:
                resp = await client.post(url, headers=headers, json=body, timeout=timeout)
                resp.raise_for_status()
                text = cls._extract_text(resp.json())
                if not text.strip():
                    yield {"type": "error", "detail": "LLM 暂无返回内容，请重试"}
                    return
                yield {"type": "done", "text": text}
        except httpx.TimeoutException:
            logger.warning("[llm_client] LLM API timeout")
            yield {"type": "error", "detail": "请求超时，请重试"}
        except Exception:
            logger.exception("[llm_client] LLM API call failed")
            yield {"type": "error", "detail": "LLM 调用失败，请重试"}
