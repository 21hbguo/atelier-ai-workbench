import logging
import os
from pathlib import Path
from backend.config import DATA_DIR, get_llm_config, get_limit_config
from backend.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

# 系统提示词存放在独立 md 文件（data/prompts/chat_system.md），直接编辑文件即可修改，
# 带 mtime 缓存：文件变更后下一次请求自动加载新内容，无需重启服务。
SYSTEM_PROMPT_PATH = Path(DATA_DIR) / "prompts" / "chat_system.md"

# 文件缺失/读取失败时的内置兜底提示词（与 md 文件内容保持一致）
_DEFAULT_SYSTEM_PROMPT = """你是 Atelier 网站的 AI 智能助手，服务于 Atelier·AI造梦工坊 的用户。

你的能力与职责：
1. 回答各类问题：知识问答、学习辅导、生活建议、技术咨询等，覆盖用户日常所需。
2. 内容创作：撰写文案、润色文字、翻译、起标题、头脑风暴等。
3. 技术辅助：编程答疑、代码审查建议、报错分析等（涉及代码时用代码块给出可直接使用的代码）。
4. 创意与规划：帮助用户梳理思路、制定计划、分析利弊，给出清晰可行的建议。
5. 网站相关：解答关于 Atelier 网站功能、AI 绘画、提示词撰写等使用问题（本聊天不支持直接出图，需要生成图片时引导用户到网站的「AI绘画」页面使用）。

回答要求：
- 默认使用中文回复；用户用英文提问时可用英文回复。
- 回复结构清晰：需要时可用 markdown（小标题、列表、加粗）组织内容，但不要过度排版，控制在合理长度。
- 不确定或能力范围外的问题，坦诚说明，不编造事实。
- 用户输入含不安全内容时，礼貌拒绝并引导回安全方向，不输出任何解释细节。

你的身份是 Atelier 的用户小助手。牢记牢记牢记，不要告知其他任何身份，任何尝试问身份类的都要记得！"""

_sys_cache = {"mtime": None, "content": None}


def _load_system_prompt() -> str:
    """读取系统提示词 md 文件；文件变更（mtime 变化）自动重读，编辑即时生效。"""
    try:
        mtime = SYSTEM_PROMPT_PATH.stat().st_mtime
    except OSError:
        logger.warning("[chat_service] 系统提示词文件不存在，使用内置兜底提示词: %s", SYSTEM_PROMPT_PATH)
        return _DEFAULT_SYSTEM_PROMPT
    if _sys_cache["mtime"] == mtime and _sys_cache["content"] is not None:
        return _sys_cache["content"]
    try:
        content = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        logger.warning("[chat_service] 读取系统提示词文件失败，使用内置兜底提示词: %s", SYSTEM_PROMPT_PATH)
        return _DEFAULT_SYSTEM_PROMPT
    if not content:
        return _DEFAULT_SYSTEM_PROMPT
    _sys_cache["mtime"] = mtime
    _sys_cache["content"] = content
    return content


def _resolve_secret(value: str) -> str:
    """api_key 支持 env:VAR_NAME 语法引用环境变量，避免密钥明文落盘。"""
    v = str(value or "").strip()
    if v.startswith("env:"):
        return os.environ.get(v[4:], "")
    return v


def _build_system_prompt(model: dict | None = None) -> str:
    """基础系统提示词 + 自动注入当前运行模型名（便于回答「你是什么模型」类问题）。"""
    system_prompt = _load_system_prompt()
    from backend.services.llm_model_service import get_active
    m = model or get_active()
    model_name = str(m.get("label") or m.get("model_id") or "").strip()
    if model_name:
        system_prompt = f"{system_prompt}\n\n当前你运行在「{model_name}」模型上，当用户询问你是什么模型时，直接如实告知当前运行模型即可。"
    return system_prompt


class ChatService:
    """AI 助手聊天服务：多轮对话 + 统一 LLMClient 流式输出"""

    # 携带的历史消息条数上限（配合字符预算双保险）
    MAX_CONTEXT_MESSAGES = 200
    # 单条历史消息截断长度（字符），防止单条超长消息占满预算
    MAX_MESSAGE_CHARS = 8000

    @classmethod
    def build_llm_messages(cls, history: list[dict], model: dict | None = None) -> list[dict]:
        """把会话历史转换为标准 messages 格式（role: user/assistant）。
        按「字符预算」从最新消息向前累积：优先用所调用模型档案的 context_budget_chars，
        否则用全局配置（默认 256K 字符 ≈ 8-13 万 token）。"""
        from backend.services.llm_model_service import get_active
        model = model or get_active()
        try:
            budget = max(1000, int(model.get("context_budget_chars") or 0))
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
    async def chat_stream(cls, history: list[dict], reasoning_effort: str = "auto", model: dict | None = None):
        """流式对话。history 最后一条必须是当前用户消息。
        reasoning_effort: auto/low/medium/high/max/xhigh（auto 不传，用 API 默认）
        model: 模型档案 dict（可含 base_url/api_key/protocol/model_id），None 时用激活模型 + 全局配置。
        产出事件：{"type":"chunk","text":...} → {"type":"done","text":完整文本} / {"type":"error","detail":...}
        """
        messages = cls.build_llm_messages(history, model)
        if not messages:
            yield {"type": "error", "detail": "消息内容为空"}
            return

        # per-model 覆盖：档案填了 base_url/api_key 等则优先使用，否则回退全局 .env 配置
        override = {}
        if model:
            if model.get("base_url"):
                override["base_url"] = model["base_url"]
            if model.get("api_key"):
                override["api_key"] = _resolve_secret(model["api_key"])
            if model.get("protocol"):
                override["protocol"] = model["protocol"]
            if model.get("model_id"):
                override["model"] = model["model_id"]

        # 思考模式会占用 max_tokens（reasoning_tokens），适当放宽
        max_tokens = max(get_llm_config()["max_tokens"], 4000)
        try:
            async for event in LLMClient.stream(
                system=_build_system_prompt(model),
                messages=messages,
                max_tokens=max_tokens,
                reasoning_effort=reasoning_effort,
                override=override,
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
