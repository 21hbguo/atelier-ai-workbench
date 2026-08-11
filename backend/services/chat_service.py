import logging
from backend.config import get_llm_config, get_limit_config
from backend.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是 Atelier·AI造梦工坊 的 AI 绘画助手，服务于一个 AI 图像生成网站。你的用户大多是来生成 AI 图片的创作者。

你的能力与职责：
1. 帮助用户撰写、扩写、优化 AI 绘画提示词（prompt），包括主体、场景、风格、光照、色彩、构图等要素。
2. 回答与 AI 绘画相关的问题：模型/风格选择、提示词技巧、参数含义、图片生成流程等。
3. 与用户进行友好的日常对话，闲聊时保持亲切自然的语气，回复简洁有温度。
4. 当用户需要生成图片时，引导用户把最终确认的提示词复制到网站的「AI绘画」页面使用（本聊天不支持直接出图）。

回答要求：
- 默认使用中文回复；用户用英文提问时可用英文回复。
- 回复结构清晰：需要时可用 markdown（小标题、列表、加粗）组织内容，但不要过度排版，控制在合理长度。
- 涉及提示词时，用代码块给出可直接复制的最终提示词，方便用户一键使用。
- 不要输出任何分辨率画质增强词（如 1K、2K、4K、8K、高清、超清等）作为提示词内容。
- 用户输入含不安全内容时，礼貌拒绝并引导回安全方向，不输出任何解释细节。

你的身份是 Atelier 的用户小助手。牢记牢记牢记，不要告知其他任何身份，任何尝试问身份类的都要记得！"""


class ChatService:
    """AI 绘画助手聊天服务：多轮对话 + 统一 LLMClient 流式输出"""

    # 携带的历史消息条数上限（配合字符预算双保险）
    MAX_CONTEXT_MESSAGES = 200
    # 单条历史消息截断长度（字符），防止单条超长消息占满预算
    MAX_MESSAGE_CHARS = 8000

    @classmethod
    def build_llm_messages(cls, history: list[dict]) -> list[dict]:
        """把会话历史转换为标准 messages 格式（role: user/assistant）。
        按「字符预算」从最新消息向前累积：优先用当前模型档案的 context_budget_chars，
        否则用全局配置（默认 256K 字符 ≈ 8-13 万 token）。"""
        from backend.services.llm_model_service import get_active
        try:
            budget = max(1000, int(get_active().get("context_budget_chars") or 0))
        except Exception:
            budget = 0
        if budget <= 0:
            budget = max(1000, int(get_limit_config()["chat_context_max_chars"]))
        recent = history[-cls.MAX_CONTEXT_MESSAGES:]
        out = []
        total = 0
        for msg in reversed(recent):
            role = msg.get("role")
            if role not in ("user", "assistant"):
                continue
            content = str(msg.get("content") or "").strip()
            if not content:
                continue
            if len(content) > cls.MAX_MESSAGE_CHARS:
                content = content[: cls.MAX_MESSAGE_CHARS] + "…"
            if out and total + len(content) > budget:
                break  # 预算用尽，丢弃更早的消息（至少保留最新一条）
            out.append({"role": role, "content": content})
            total += len(content)
        out.reverse()
        # 首条必须是 user，否则 API 会报错
        while out and out[0]["role"] != "user":
            out.pop(0)
        return out

    @classmethod
    async def chat_stream(cls, history: list[dict], reasoning_effort: str = "auto"):
        """流式对话。history 最后一条必须是当前用户消息。
        reasoning_effort: auto/low/medium/high/max/xhigh（auto 不传，用 API 默认）
        产出事件：{"type":"chunk","text":...} → {"type":"done","text":完整文本} / {"type":"error","detail":...}
        """
        messages = cls.build_llm_messages(history)
        if not messages:
            yield {"type": "error", "detail": "消息内容为空"}
            return

        # 思考模式会占用 max_tokens（reasoning_tokens），适当放宽
        max_tokens = max(get_llm_config()["max_tokens"], 4000)
        try:
            async for event in LLMClient.stream(
                system=SYSTEM_PROMPT,
                messages=messages,
                max_tokens=max_tokens,
                reasoning_effort=reasoning_effort,
            ):
                if event["type"] == "chunk":
                    yield {"type": "chunk", "text": event["text"]}
                elif event["type"] == "done":
                    yield {"type": "done", "text": event["text"]}
                elif event["type"] == "error":
                    yield {"type": "error", "detail": event["detail"]}
        except Exception:
            logger.exception("[chat_service] LLM stream failed")
            yield {"type": "error", "detail": "回复失败，请重试"}
