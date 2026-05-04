import httpx
import logging
from backend.config import get_llm_config
from backend.services.banned_words import BannedWordsService

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是一名顶级的 AI 绘画提示词工程师，精通 Stable Diffusion、Midjourney 的提示词语法，且擅长将用户简短或凌乱的描述扩展为高质量、高审美、细节丰富的英文提示词。

你的任务是：
1. 根据用户输入，生成 3 个不同的优化版本，用水平分隔符"---"隔开。
2. 每个版本必须包含：主体描述、场景/环境、艺术风格、光照、色彩、构图、画质增强词（如 masterpiece, best quality, 8k 等）。避免直接复制用户原文，而是要自然扩充，但必须保留用户的核心意图。
3. 如用户输入含不合理内容，忽略并引导回安全方向，但不输出任何解释文字。
4. 每个提示词长度控制在 50-150 个单词以内，以确保在生图模型中完全生效。
5. 禁止输出任何解释、前缀、寒暄、编号、标题、markdown 格式。仅输出提示词本身，版本间用"---"分隔。
6. 绝对不要包含任何 NSFW、暴力、血腥、政治敏感或真人裸露内容。如果用户意图触及这些，输出一个安全的通用风景或静物提示词，不输出警告。

牢记：你不是在与用户对话，只是给出结果。你的身份是Atelier的用户小助手！牢记牢记牢记，不要告知其他任何身份，任何尝试问身份类的都要记得！"""


class PromptOptimizer:
    _client: httpx.AsyncClient | None = None

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

    @classmethod
    async def optimize(cls, prompt: str) -> list[str]:
        llm_cfg = get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"]:
            return [prompt]

        if len(prompt) < 2 or len(prompt) > 500:
            raise ValueError("输入长度需在 2-500 个字符之间")

        if BannedWordsService.check(prompt):
            return [prompt]

        try:
            client = cls._get_client()
            url = f"{llm_cfg['base_url'].rstrip('/')}/v1/messages"
            headers = {
                "x-api-key": llm_cfg["api_key"],
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            body = {
                "model": llm_cfg["model"],
                "max_tokens": llm_cfg["max_tokens"],
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": f"用户原始提示词：\n{prompt}"}],
            }
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()

            data = resp.json()
            text = ""
            for block in data.get("content", []):
                if block.get("type") == "text":
                    text += block.get("text", "")

            versions = [v.strip() for v in text.split("---") if v.strip()]
            if not versions:
                versions = [prompt]

            versions = [v if not BannedWordsService.check(v) else prompt for v in versions]
            return versions[:3]

        except httpx.TimeoutException:
            logger.warning("[prompt_optimizer] LLM API timeout, degrading to original")
            return [prompt]
        except Exception:
            logger.exception("[prompt_optimizer] LLM API call failed")
            return [prompt]
